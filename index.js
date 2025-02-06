import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import s3 from './yandexS3.js';  // клиент для Yandex S3
import { savePhotoRecord, initDb } from './db.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const port = process.env.PORT || 3014;  // Используем порт 3013

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

// Новый роут для загрузки фото
// Обработчик загрузки фото с расширенным логированием
app.post('/api/photos', upload.single('photo'), async (req, res) => {
  console.log("Запрос POST /api/photos получен.");
  console.log("Тело запроса (req.body):", req.body);
  console.log("Файл из запроса (req.file):", req.file);

  if (!req.file) {
    console.error("Ошибка: файл не найден в запросе.");
    return res.status(400).json({ success: false, error: 'Файл не найден' });
  }

  try {
    // Подготовка параметров для загрузки в Yandex S3
    const { buffer, originalname, mimetype } = req.file;
    console.log("Параметры файла:", {
      originalname,
      mimetype,
      size: req.file.size
    });

    console.log("Начинается загрузка файла в Yandex S3...");
    const photoUrl = await uploadFileToYandexS3(buffer, originalname, mimetype);
    console.log("Файл успешно загружен в S3. Полученный URL:", photoUrl);

    // Логирование данных для записи в БД
    const { comment, date, location } = req.body;
    console.log("Подготовка данных для сохранения в БД:", {
      photoUrl,
      comment,
      date,
      location
    });

    await savePhotoRecord(photoUrl, comment, date, location);
    console.log("Запись успешно сохранена в базе данных.");

    res.status(201).json({ success: true, photoUrl });
  } catch (error) {
    console.error("Ошибка при загрузке фото:", error);
    res.status(500).json({ success: false, error: error.message });
  }
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

// Пример роутов для раздачи статики (если требуется)
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send('Сервер работает!');
});

app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Порт ${port} уже используется. Попробуйте другой порт.`);
    process.exit(1);
  }
});