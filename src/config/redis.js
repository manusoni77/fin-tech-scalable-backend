const Redis = require('ioredis');
// Import the logger object cleanly at the top of the file
const { logger } = require('../middleware/logger');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

// Use the imported logger inside the event listener safely
redis.on('error', (err) => {
  logger.error({ msg: 'Redis error occurred', error: err.message });
});

module.exports = redis;
