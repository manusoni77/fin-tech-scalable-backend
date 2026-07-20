const pool = require('../config/db');

const getHistory = async (req, res) => {
  const {
    page = 1,
    limit = 20,
    type,
    from,
    to,
    sort = 'desc',
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const order = sort === 'asc' ? 'ASC' : 'DESC';

  const [wallets] = await pool.query(
    'SELECT id FROM wallets WHERE user_id = ? AND deleted_at IS NULL',
    [req.user.id]
  );
  if (!wallets.length) return res.status(404).json({ error: 'Wallet not found' });

  const walletId = wallets[0].id;
  const params = [walletId];
  let where = 'WHERE t.wallet_id = ? AND t.deleted_at IS NULL';

  if (type) {
    where += ' AND t.type = ?';
    params.push(type);
  }
  if (from) {
    where += ' AND t.created_at >= ?';
    params.push(from);
  }
  if (to) {
    where += ' AND t.created_at <= ?';
    params.push(to);
  }

  const [rows] = await pool.query(
    `SELECT t.id, t.type, t.amount, t.reference_id, t.status, t.description, t.created_at
     FROM transactions t
     ${where}
     ORDER BY t.created_at ${order}
     LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), offset]
  );

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) as total FROM transactions t ${where}`,
    params
  );

  res.json({
    data: rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    },
  });
};

module.exports = { getHistory };
