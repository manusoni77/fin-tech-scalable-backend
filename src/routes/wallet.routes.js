const router = require('express').Router();
const { getMyWallet, deposit, withdraw, transfer } = require('../controllers/wallet.controller');
const { authenticate } = require('../middleware/auth');
const { transferLimiter } = require('../middleware/rateLimiter');
const wrap = require('../utils/asyncHandler');

router.use(authenticate);

router.get('/', wrap(getMyWallet));
router.post('/deposit', wrap(deposit));
router.post('/withdraw', wrap(withdraw));
router.post('/transfer', transferLimiter, wrap(transfer));

module.exports = router;
