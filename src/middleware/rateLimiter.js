const redis = require('../config/redis');

const rateLimiter = (key, max, windowSecs) => async (req, res, next) => {
  try {
    const identifier = key === 'transfer' ? req.user?.id : req.ip;
    const redisKey = `rate:${key}:${identifier}`;

    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, windowSecs);

    if (count > max) {
      res.set('Retry-After', windowSecs);
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: windowSecs,
      });
    }
    next();
  } catch {
    next();
  }
};

module.exports = {
  loginLimiter: rateLimiter('login', 5, 60),
  transferLimiter: rateLimiter('transfer', 20, 60),
  publicLimiter: rateLimiter('public', 100, 60),
};
