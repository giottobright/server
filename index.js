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
  origin: process.env.FRONTEND_URL || 'http://localhost:3002',
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
app.post('/api/photos', upload.single('photo'), async (req, res) => {
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
app.get('/api/photos', async (req, res) => {
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

// Инициализация базы данных при запуске
initDb().catch(err => {
  console.error('Ошибка инициализации БД:', err);
});

app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});