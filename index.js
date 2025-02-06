import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import s3 from './yandexS3.js';  // клиент для Yandex S3
import { getDbConnection, savePhotoRecord, initDb } from './db.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { authenticateMiddleware } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const port = process.env.PORT || 3013;  // Используем порт 3013

initDb().then(() => {
  console.log('База данных и таблица photos инициализированы');
}).catch(err => {
  console.error('Ошибка инициализации базы данных:', err);
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Инициализируем multer для хранения файла в памяти
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Функция загрузки файла в Yandex S3
async function uploadFileToYandexS3(fileBuffer, originalName, mimetype) {
  const fileName = `photos/${Date.now()}-${originalName}`; // создаём уникальное имя
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: fileName,
    Body: fileBuffer,
    ContentType: mimetype,
    ACL: 'public-read', // если нужно сделать файл общедоступным
  };

  const result = await s3.upload(params).promise();
  return result.Location; // URL загруженного файла
}

// Новый роут для проверки "здоровья" сервера
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: Date.now() 
  });
});

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
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Новый роут для загрузки фото
// Обновляем существующий маршрут загрузки фото
app.post('/api/photos', upload.single('photo'), async (req, res) => {
  try {
    const { comment, date, location } = req.body;
    const accountId = req.user.accountId; // Получаем из токена

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

// Защищаем все маршруты API middleware аутентификации
app.use('/api', authenticateMiddleware);

// Пример роутов для раздачи статики (если требуется)
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send('Сервер работает!');
});

app.get('/api/photos', async (req, res) => {
  try {
    const { month } = req.query;
    const connection = await getDbConnection();
    let query = "SELECT * FROM photos";
    let params = [];
    if (month) {
      // Фильтруем по месяцу (предполагается формат "YYYY-MM")
      query = "SELECT * FROM photos WHERE DATE_FORMAT(photo_date, '%Y-%m') = ?";
      params = [month];
    }
    const [rows] = await connection.execute(query, params);
    await connection.end();
    res.json({ success: true, photos: rows });
  } catch (error) {
    console.error("Ошибка получения фотографий:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/accounts/link', authenticateMiddleware, async (req, res) => {
  try {
    const { targetTelegramId } = req.body;
    const sourceAccountId = req.user.accountId;

    const connection = await getDbConnection();
    await connection.execute(
      'UPDATE users SET account_id = ? WHERE telegram_id = ?',
      [sourceAccountId, targetTelegramId]
    );
    
    await connection.end();
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка связывания аккаунтов:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Порт ${port} уже используется. Попробуйте другой порт.`);
    process.exit(1);
  }
});