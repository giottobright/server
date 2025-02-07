import jwt from 'jsonwebtoken';
import { getDbConnection } from './db.js';
import crypto from 'crypto';

const JWT_SECRET = process.env.NODE_ENV === 'production' 
    ? process.env.JWT_SECRET 
    : process.env.TEST_JWT_SECRET;
const INVITE_CODE_EXPIRY = 24 * 60 * 60 * 1000; // 24 часа

/**
 * Проверка, существует ли пользователь в базе данных.
 * @param {string} telegramId - Telegram ID пользователя.
 * @returns {Promise<boolean>} - true, если пользователь есть, false, если нет.
 */
export async function checkUserExists(telegramId) {
    const connection = await getDbConnection();
    try {
        const [users] = await connection.execute(
            'SELECT id FROM users WHERE telegram_id = ?',
            [telegramId]
        );
        return users.length > 0;
    } finally {
        await connection.end();
    }
}

/**
 * Аутентификация пользователя (без автоматического создания).
 * @param {string} telegramId - Telegram ID пользователя.
 * @returns {Promise<object>} - { exists: true/false, token, user }
 */
export async function authenticateUser(telegramId) {
    const connection = await getDbConnection();
    try {
        const [users] = await connection.execute(
            'SELECT * FROM users WHERE telegram_id = ?',
            [telegramId]
        );

        if (users.length === 0) {
            return { exists: false };  // ✅ Не создаем пользователя автоматически
        }

        const user = users[0];
        const token = generateToken(user);

        return { exists: true, token, user };
    } finally {
        await connection.end();
    }
}

/**
 * Создание нового пользователя.
 * @param {string} telegramId - Telegram ID пользователя.
 * @returns {Promise<object>} - Новый пользователь + токен.
 */
export async function createNewAccount(telegramId) {
    const connection = await getDbConnection();
    try {
        const [accountResult] = await connection.execute(
            'INSERT INTO accounts (name) VALUES (?)',
            [`Account ${telegramId}`]
        );

        const accountId = accountResult.insertId;

        const [userResult] = await connection.execute(
            'INSERT INTO users (telegram_id, account_id) VALUES (?, ?)',
            [telegramId, accountId]
        );

        const newUser = {
            id: userResult.insertId,
            telegram_id: telegramId,
            account_id: accountId
        };

        const token = generateToken(newUser);

        return { token, user: newUser };
    } finally {
        await connection.end();
    }
}

/**
 * Генерация инвайт-кода.
 * @param {number} userId - ID пользователя.
 * @returns {Promise<string>} - Код приглашения.
 */
export async function generateInviteCode(userId) {
    const connection = await getDbConnection();
    try {
        const [users] = await connection.execute(
            'SELECT * FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            throw new Error('User not found');
        }

        const user = users[0];
        const inviteCode = crypto.randomBytes(16).toString('hex');

        await connection.execute(
            'INSERT INTO invite_codes (code, account_id, expires_at) VALUES (?, ?, ?)',
            [inviteCode, user.account_id, new Date(Date.now() + INVITE_CODE_EXPIRY)]
        );

        return inviteCode;
    } finally {
        await connection.end();
    }
}

/**
 * Присоединение к аккаунту с помощью инвайт-кода.
 * @param {string} telegramId - Telegram ID пользователя.
 * @param {string} inviteCode - Код приглашения.
 * @returns {Promise<object>} - Данные нового пользователя.
 */
export async function joinWithInviteCode(telegramId, inviteCode) {
    const connection = await getDbConnection();
    try {
        const [codes] = await connection.execute(
            'SELECT * FROM invite_codes WHERE code = ? AND expires_at > NOW() AND used = 0',
            [inviteCode]
        );

        if (codes.length === 0) {
            throw new Error('Invalid or expired invite code');
        }

        const code = codes[0];

        const [existingUsers] = await connection.execute(
            'SELECT * FROM users WHERE telegram_id = ?',
            [telegramId]
        );

        if (existingUsers.length > 0) {
            throw new Error('User already exists');
        }

        const [userResult] = await connection.execute(
            'INSERT INTO users (telegram_id, account_id) VALUES (?, ?)',
            [telegramId, code.account_id]
        );

        await connection.execute(
            'UPDATE invite_codes SET used = 1 WHERE code = ?',
            [inviteCode]
        );

        const user = {
            id: userResult.insertId,
            telegram_id: telegramId,
            account_id: code.account_id
        };

        const token = generateToken(user);
        return { token, user };
    } finally {
        await connection.end();
    }
}

/**
 * Генерация JWT-токена.
 * @param {object} user - Данные пользователя.
 * @returns {string} - JWT-токен.
 */
function generateToken(user) {
    return jwt.sign(
        {
            userId: user.id,
            telegramId: user.telegram_id,
            accountId: user.account_id
        },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

/**
 * Middleware для проверки аутентификации.
 */
export function authenticateMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
}
