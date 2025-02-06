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

  export async function savePhotoRecord(photoUrl, comment, photoDate, location, accountId) {
    const connection = await getDbConnection();
    try {
      const query = `
        INSERT INTO photos (s3_url, comment, photo_date, location, account_id)
        VALUES (?, ?, ?, ?, ?)
      `;
      
      await connection.execute(query, [photoUrl, comment, photoDate, location, accountId]);
    } finally {
      await connection.end();
    }
  }
  
  export async function getPhotos(monthKey, accountId) {
    const connection = await getDbConnection();
    try {
      const query = `
        SELECT * FROM photos 
        WHERE DATE_FORMAT(photo_date, '%Y-%m') = ? 
        AND account_id = ?
      `;
      const [rows] = await connection.execute(query, [monthKey, accountId]);
      return rows;
    } finally {
      await connection.end();
    }
  }
