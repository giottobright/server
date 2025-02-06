import jwt from 'jsonwebtoken';
import { getDbConnection } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export async function authenticateUser(telegramId) {
  const connection = await getDbConnection();
  try {
    // Проверяем, существует ли пользователь
    const [users] = await connection.execute(
      'SELECT * FROM users WHERE telegram_id = ?',
      [telegramId]
    );

    let user;
    if (users.length === 0) {
      // Создаём новый аккаунт
      const [accountResult] = await connection.execute(
        'INSERT INTO accounts (name) VALUES (?)',
        [`Account for ${telegramId}`]
      );
      const accountId = accountResult.insertId;

      // Создаём пользователя
      const [userResult] = await connection.execute(
        'INSERT INTO users (telegram_id, account_id) VALUES (?, ?)',
        [telegramId, accountId]
      );
      user = {
        id: userResult.insertId,
        telegram_id: telegramId,
        account_id: accountId
      };
    } else {
      user = users[0];
    }

    // Создаём JWT токен с информацией о пользователе и accountId (идентификатор пары)
    const token = jwt.sign(
      { 
        userId: user.id,
        telegramId: user.telegram_id,
        accountId: user.account_id 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return { token, user };
  } finally {
    await connection.end();
  }
}

export function authenticateMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}