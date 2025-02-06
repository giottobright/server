// db.js
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

export async function getDbConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
  });
}

export async function initDb() {
    const connection = await getDbConnection();
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS photos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        s3_url VARCHAR(512) NOT NULL,
        comment TEXT,
        photo_date DATE,
        location VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await connection.execute(createTableQuery);
    await connection.end();
  }

export async function savePhotoRecord(photoUrl, comment, photoDate, location) {
  const connection = await getDbConnection();
  const query = `
    INSERT INTO photos (s3_url, comment, photo_date, location)
    VALUES (?, ?, ?, ?)
  `;
  await connection.execute(query, [photoUrl, comment, photoDate, location]);
  await connection.end();
}
