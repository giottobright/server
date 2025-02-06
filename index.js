// index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import s3 from './yandexS3.js';  // клиент для Yandex S3
import { savePhotoRecord, initDb } from './db.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

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

// Новый роут для загрузки фото
app.post('/api/photos', upload.single('photo'), async (req, res) => {
  try {
    const { comment, date, location } = req.body;
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Файл не найден' });
    }
    // Загружаем файл в Yandex S3
    const photoUrl = await uploadFileToYandexS3(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    // Сохраняем запись в базе данных
    await savePhotoRecord(photoUrl, comment, date, location);
    res.status(201).json({ success: true, photoUrl });
  } catch (error) {
    console.error('Ошибка загрузки фото:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Пример роутов для раздачи статики (если требуется)
app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Порт ${port} уже используется. Попробуйте другой порт.`);
    process.exit(1);
  }
});
