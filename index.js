require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const fs = require('fs');

const { requestLogger, logger } = require('./src/middleware/logger');
const { publicLimiter } = require('./src/middleware/rateLimiter');
const pool = require('./src/config/db');
const redis = require('./src/config/redis');

if (!fs.existsSync('logs')) fs.mkdirSync('logs');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);
app.use(publicLimiter);

app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/wallet', require('./src/routes/wallet.routes'));
app.use('/api/transactions', require('./src/routes/transaction.routes'));
app.use('/api/admin', require('./src/routes/admin.routes'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  logger.error({ msg: err.message, stack: err.stack, url: req.originalUrl });
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Duplicate entry' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

const start = async () => {
  await redis.connect();
  await pool.query('SELECT 1');
  app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));
};

start().catch(err => {
  logger.error({ msg: 'Startup failed', err: err.message });
  process.exit(1);
});
