// yandexS3.js
import AWS from 'aws-sdk';
import dotenv from 'dotenv';
dotenv.config();

const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT || 'https://storage.yandexcloud.net', // Yandex Object Storage endpoint
  accessKeyId: process.env.S3_ACCESS_KEY,
  secretAccessKey: process.env.S3_SECRET_KEY,
  region: process.env.S3_REGION || 'ru-central1', // укажите нужный регион
  s3ForcePathStyle: true, // обязательно для S3-совместимых сервисов от Yandex
});

export default s3;
