const router = require('express').Router();
const { getHistory } = require('../controllers/transaction.controller');
const { authenticate } = require('../middleware/auth');
const wrap = require('../utils/asyncHandler');

router.use(authenticate);
router.get('/', wrap(getHistory));

module.exports = router;
