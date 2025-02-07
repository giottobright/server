import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import s3 from './yandexS3.js';
import { getDbConnection, savePhotoRecord, initDb } from './db.js';
import { authenticateMiddleware, authenticateUser } from './auth.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3021;

// Настройка CORS для разработки: разрешаем запросы с фронтенда (обычно Create React App работает на localhost:3000)
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Настройка multer для хранения файлов в памяти
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Функция загрузки файла в S3 (Yandex Object Storage)
async function uploadFileToYandexS3(fileBuffer, originalName, mimetype) {
  const fileName = `photos/${Date.now()}-${originalName}`;
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: fileName,
    Body: fileBuffer,
    ContentType: mimetype,
    ACL: 'public-read'
  };

  try {
    const result = await s3.upload(params).promise();
    return result.Location;
  } catch (error) {
    console.error('Ошибка загрузки в S3:', error);
    throw new Error('Ошибка загрузки файла');
  }
}

if (process.env.NODE_ENV !== 'production') {
  app.post('/api/auth/test-login', async (req, res) => {
      try {
          const { token, user } = await authenticateUser(process.env.TEST_TELEGRAM_ID);
          res.json({ 
              token, 
              accountId: user.account_id,
              testMode: true
          });
      } catch (error) {
          console.error('Test authentication error:', error);
          res.status(500).json({ error: error.message });
      }
  });
}

if (process.env.NODE_ENV !== 'production') {
  app.get('/api/auth/test-token', async (req, res) => {
    try {
      const { token, user } = await authenticateUser('test_user');
      res.json({ token, accountId: user.account_id });
    } catch (error) {
      console.error('Ошибка получения тестового токена:', error);
      res.status(500).json({ error: 'Ошибка получения тестового токена' });
    }
  });
}

// Проверка работоспособности сервера
app.get('/', (req, res) => {
  res.json({ status: 'API работает' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Роут для авторизации через Telegram
app.post('/api/auth/telegram', async (req, res) => {
  try {
    const { telegramId } = req.body;
    if (!telegramId) {
      return res.status(400).json({ error: 'Требуется telegram_id' });
    }
    const { token, user } = await authenticateUser(telegramId);
    res.json({ token, accountId: user.account_id });
  } catch (error) {
    console.error('Ошибка аутентификации:', error);
    res.status(500).json({ error: 'Ошибка сервера при аутентификации' });
  }
});

// Тестовый токен (только для разработки)
app.get('/api/auth/test-token', async (req, res) => {
  try {
    const { token, user } = await authenticateUser('test_user');
    res.json({ token, accountId: user.account_id });
  } catch (error) {
    console.error('Ошибка получения тестового токена:', error);
    res.status(500).json({ error: 'Ошибка получения тестового токена' });
  }
});

// Применяем middleware аутентификации для защищенных маршрутов
app.use('/api/photos', authenticateMiddleware);

// Загрузка фото
app.post('/api/photos', authenticateMiddleware, upload.single('photo'), async (req, res) => {
  try {
    const { comment, date, location } = req.body;
    const accountId = req.user.accountId;

    if (!req.file) {
      return res.status(400).json({ error: 'Файл не найден' });
    }

    const photoUrl = await uploadFileToYandexS3(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    await savePhotoRecord(photoUrl, comment, date, location, accountId);
    res.status(201).json({ success: true, photoUrl });
  } catch (error) {
    console.error('Ошибка загрузки фото:', error);
    res.status(500).json({ error: error.message });
  }
});

// Получение фотографий
app.get('/api/photos', authenticateMiddleware, async (req, res) => {
  try {
    const { monthKey } = req.query;
    const accountId = req.user.accountId;
    
    const connection = await getDbConnection();
    const [photos] = await connection.execute(
      'SELECT * FROM photos WHERE account_id = ? AND DATE_FORMAT(photo_date, "%Y-%m") = ? ORDER BY photo_date DESC',
      [accountId, monthKey]
    );
    await connection.end();
    
    res.json({ photos });
  } catch (error) {
    console.error('Ошибка получения фото:', error);
    res.status(500).json({ error: 'Ошибка получения фотографий' });
  }
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Что-то пошло не так!' });
});

// Generate invite code
app.post('/api/auth/invite-code', authenticateMiddleware, async (req, res) => {
  try {
      const inviteCode = await generateInviteCode(req.user.userId);
      res.json({ inviteCode });
  } catch (error) {
      console.error('Error generating invite code:', error);
      res.status(500).json({ error: error.message });
  }
});

// Join with invite code
app.post('/api/auth/join', async (req, res) => {
  try {
      const { telegramId, inviteCode } = req.body;
      
      if (!telegramId || !inviteCode) {
          return res.status(400).json({ error: 'Telegram ID and invite code required' });
      }

      const result = await joinWithInviteCode(telegramId, inviteCode);
      res.json(result);
  } catch (error) {
      console.error('Error joining with invite code:', error);
      res.status(400).json({ error: error.message });
  }
});

// Проверка существования пользователя
app.post('/api/auth/check-user', async (req, res) => {
  try {
    const { telegramId } = req.body;
    const connection = await getDbConnection();
    const [users] = await connection.execute(
      'SELECT id FROM users WHERE telegram_id = ?',
      [telegramId]
    );
    await connection.end();
    res.json({ exists: users.length > 0 });
  } catch (error) {
    console.error('Error checking user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Создание нового аккаунта
app.post('/api/auth/create-account', async (req, res) => {
  try {
    const { telegramId } = req.body;
    const connection = await getDbConnection();
    
    const [accountResult] = await connection.execute(
      'INSERT INTO accounts (name) VALUES (?)',
      [`Account ${telegramId}`]
    );
    
    const accountId = accountResult.insertId;
    
    const [userResult] = await connection.execute(
      'INSERT INTO users (telegram_id, account_id) VALUES (?, ?)',
      [telegramId, accountId]
    );
    
    const user = {
      id: userResult.insertId,
      telegram_id: telegramId,
      account_id: accountId
    };
    
    const token = jwt.sign(
      { userId: user.id, telegramId, accountId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    await connection.end();
    res.json({ token, user });
  } catch (error) {
    console.error('Error creating account:', error);
    res.status(500).json({ error: error.message });
  }
});
// Инициализация базы данных при запуске
initDb().catch(err => {
  console.error('Ошибка инициализации БД:', err);
});

app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});