// index.js на сервере
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// CORS configuration
const corsOptions = {
  origin: 'https://giottobright-love-album-97bc.twc1.net',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  credentials: true,
  optionsSuccessStatus: 200,
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Сервер работает!',
    serverName: 'giottobright-server'
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(),
    server: 'giottobright-server-5fdb.twc1.net'
  });
});

// Test endpoint for connection verification
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Тестовое соединение успешно',
    timestamp: new Date(),
    clientOrigin: req.headers.origin
  });
});

// Error handling for CORS preflight
app.options('*', cors(corsOptions));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ 
    error: 'Что-то пошло не так!',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Маршрут не найден',
    path: req.path
  });
});

// Start server
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
  console.log('CORS разрешен для:', corsOptions.origin);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});