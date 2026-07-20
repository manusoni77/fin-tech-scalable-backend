const router = require('express').Router();
const { register, login } = require('../controllers/auth.controller');
const { loginLimiter } = require('../middleware/rateLimiter');
const wrap = require('../utils/asyncHandler');

router.post('/register', wrap(register));
router.post('/login', loginLimiter, wrap(login));

module.exports = router;
