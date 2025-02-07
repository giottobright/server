import jwt from 'jsonwebtoken';
import { getDbConnection } from './db.js';
import crypto from 'crypto';

const JWT_SECRET = process.env.NODE_ENV === 'production' 
    ? process.env.JWT_SECRET 
    : process.env.TEST_JWT_SECRET;
const INVITE_CODE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

export async function createTestUser() {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Test authentication not available in production');
    }

    const connection = await getDbConnection();
    try {
        const [users] = await connection.execute(
            'SELECT * FROM users WHERE telegram_id = ?',
            [process.env.TEST_TELEGRAM_ID]
        );

        if (users.length > 0) {
            return users[0];
        }

        const [accountResult] = await connection.execute(
            'INSERT INTO accounts (name) VALUES (?)',
            ['Test Account']
        );
        const accountId = accountResult.insertId;

        const [userResult] = await connection.execute(
            'INSERT INTO users (telegram_id, account_id) VALUES (?, ?)',
            [process.env.TEST_TELEGRAM_ID, accountId]
        );

        return {
            id: userResult.insertId,
            telegram_id: process.env.TEST_TELEGRAM_ID,
            account_id: accountId
        };
    } finally {
        await connection.end();
    }
}

export async function authenticateUser(telegramId) {
    const connection = await getDbConnection();
    
    try {
        if (process.env.NODE_ENV !== 'production' && telegramId === process.env.TEST_TELEGRAM_ID) {
            const testUser = await createTestUser();
            const token = jwt.sign(
                {
                    userId: testUser.id,
                    telegramId: testUser.telegram_id,
                    accountId: testUser.account_id
                },
                JWT_SECRET,
                { expiresIn: '7d' }
            );
            return { token, user: testUser };
        }

        const [users] = await connection.execute(
            'SELECT * FROM users WHERE telegram_id = ?',
            [telegramId]
        );

        if (users.length === 0) {
            const [accountResult] = await connection.execute(
                'INSERT INTO accounts (name) VALUES (?)',
                [`Telegram User ${telegramId}`]
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
            
            const token = jwt.sign(
                { userId: newUser.id, telegramId, accountId },
                JWT_SECRET,
                { expiresIn: '7d' }
            );
            
            return { token, user: newUser };
        }

        const user = users[0];
        const token = jwt.sign(
            { userId: user.id, telegramId, accountId: user.account_id },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        return { token, user };
    } finally {
        await connection.end();
    }
}

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