const { parse } = require('csv-parse');
const { Readable } = require('stream');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const { logger } = require('../middleware/logger');

const CHUNK_SIZE = 500;

const getUsers = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const [rows] = await pool.query(
    'SELECT id, name, email, role, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [parseInt(limit), offset]
  );
  const [[{ total }]] = await pool.query(
    'SELECT COUNT(*) as total FROM users WHERE deleted_at IS NULL'
  );

  res.json({ data: rows, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
};

const getWallets = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const [rows] = await pool.query(
    `SELECT w.id, w.balance, w.created_at, u.name, u.email
     FROM wallets w
     JOIN users u ON u.id = w.user_id
     WHERE w.deleted_at IS NULL
     ORDER BY w.created_at DESC
     LIMIT ? OFFSET ?`,
    [parseInt(limit), offset]
  );
  const [[{ total }]] = await pool.query(
    'SELECT COUNT(*) as total FROM wallets WHERE deleted_at IS NULL'
  );

  res.json({ data: rows, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
};

const getTransactions = async (req, res) => {
  const { page = 1, limit = 20, type, from, to } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [];
  let where = 'WHERE t.deleted_at IS NULL';

  if (type) { where += ' AND t.type = ?'; params.push(type); }
  if (from) { where += ' AND t.created_at >= ?'; params.push(from); }
  if (to) { where += ' AND t.created_at <= ?'; params.push(to); }

  const [rows] = await pool.query(
    `SELECT t.id, t.wallet_id, t.type, t.amount, t.reference_id, t.status, t.description, t.created_at
     FROM transactions t
     ${where}
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) as total FROM transactions t ${where}`,
    params
  );

  res.json({ data: rows, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
};

const deleteUser = async (req, res) => {
  const { id } = req.params;
  const [result] = await pool.query(
    'UPDATE users SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [id]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'User archived' });
};

const bulkUpload = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file required' });

  const results = { inserted: 0, failed: 0, errors: [] };
  const batch = [];

  const processChunk = async (chunk) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const walletIds = [...new Set(chunk.map(r => r.wallet_id))];
      const placeholders = walletIds.map(() => '?').join(',');
      const [wallets] = await conn.query(
        `SELECT id, balance FROM wallets WHERE id IN (${placeholders}) AND deleted_at IS NULL FOR UPDATE`,
        walletIds
      );

      const walletMap = {};
      wallets.forEach(w => { walletMap[w.id] = parseFloat(w.balance); });

      const ledgerValues = [];
      const validValues = [];

      for (const row of chunk) {
        const wId = parseInt(row.wallet_id);
        const amt = parseFloat(row.amount);

        if (!walletMap.hasOwnProperty(wId)) {
          results.failed++;
          results.errors.push(`wallet ${wId} not found`);
          continue;
        }

        const before = walletMap[wId];
        if ((row.type === 'withdrawal' || row.type === 'transfer_out') && before < amt) {
          results.failed++;
          results.errors.push(`wallet ${wId} insufficient balance for row`);
          continue;
        }

        const after = (row.type === 'deposit' || row.type === 'transfer_in')
          ? before + amt
          : before - amt;

        walletMap[wId] = after;
        validValues.push([wId, row.type, amt, row.reference_id || uuidv4(), row.description || null]);
        ledgerValues.push({ wId, before, after, amt, type: row.type });
      }

      if (validValues.length) {
        const [txResult] = await conn.query(
          'INSERT INTO transactions (wallet_id, type, amount, reference_id, description) VALUES ?',
          [validValues]
        );

        const firstId = txResult.insertId;
        const ledgerRows = ledgerValues.map((l, i) => [
          firstId + i,
          l.wId,
          ['withdrawal', 'transfer_out'].includes(l.type) ? l.amt : 0,
          ['deposit', 'transfer_in'].includes(l.type) ? l.amt : 0,
          l.before,
          l.after,
        ]);

        await conn.query(
          'INSERT INTO ledger (transaction_id, wallet_id, debit, credit, balance_before, balance_after) VALUES ?',
          [ledgerRows]
        );

        for (const [wId] of validValues) {
          await conn.query('UPDATE wallets SET balance = ? WHERE id = ?', [walletMap[wId], wId]);
        }

        results.inserted += validValues.length;
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      results.failed += chunk.length;
      logger.error({ msg: 'Bulk upload chunk failed', err: err.message });
    } finally {
      conn.release();
    }
  };

  await new Promise((resolve, reject) => {
    const stream = Readable.from(req.file.buffer);
    const parser = stream.pipe(
      parse({ columns: true, skip_empty_lines: true, trim: true })
    );

    parser.on('data', async (row) => {
      batch.push(row);
      if (batch.length >= CHUNK_SIZE) {
        parser.pause();
        const chunk = batch.splice(0, CHUNK_SIZE);
        await processChunk(chunk).catch(err => logger.error(err));
        parser.resume();
      }
    });

    parser.on('end', async () => {
      if (batch.length) await processChunk(batch).catch(err => logger.error(err));
      resolve();
    });

    parser.on('error', reject);
  });

  res.json(results);
};

module.exports = { getUsers, getWallets, getTransactions, deleteUser, bulkUpload };
