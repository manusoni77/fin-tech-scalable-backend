const router = require('express').Router();
const multer = require('multer');
const { getUsers, getWallets, getTransactions, deleteUser, bulkUpload } = require('../controllers/admin.controller');
const { authenticate, isAdmin } = require('../middleware/auth');
const wrap = require('../utils/asyncHandler');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files allowed'));
    }
  },
});

router.use(authenticate, isAdmin);

router.get('/users', wrap(getUsers));
router.delete('/users/:id', wrap(deleteUser));
router.get('/wallets', wrap(getWallets));
router.get('/transactions', wrap(getTransactions));
router.post('/transactions/bulk', upload.single('file'), wrap(bulkUpload));

module.exports = router;
