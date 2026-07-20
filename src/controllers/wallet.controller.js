const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');

const getMyWallet = async (req, res) => {
  const [rows] = await pool.query(
    'SELECT w.id, w.balance, w.created_at FROM wallets w WHERE w.user_id = ? AND w.deleted_at IS NULL',
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Wallet not found' });
  res.json(rows[0]);
};

const deposit = async (req, res) => {
  const { amount, description } = req.body;
  const amt = parseFloat(amount);
  if (!amount || isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [wallets] = await conn.query(
      'SELECT id, balance FROM wallets WHERE user_id = ? AND deleted_at IS NULL FOR UPDATE',
      [req.user.id]
    );
    if (!wallets.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const wallet = wallets[0];
    const balanceBefore = parseFloat(wallet.balance);
    const balanceAfter = balanceBefore + amt;
    const refId = uuidv4();

    await conn.query('UPDATE wallets SET balance = ? WHERE id = ?', [balanceAfter, wallet.id]);

    const [txResult] = await conn.query(
      'INSERT INTO transactions (wallet_id, type, amount, reference_id, description) VALUES (?, ?, ?, ?, ?)',
      [wallet.id, 'deposit', amt, refId, description || null]
    );

    await conn.query(
      'INSERT INTO ledger (transaction_id, wallet_id, credit, debit, balance_before, balance_after) VALUES (?, ?, ?, 0, ?, ?)',
      [txResult.insertId, wallet.id, amount, balanceBefore, balanceAfter]
    );

    await conn.commit();
    res.json({ balance: balanceAfter, reference_id: refId });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const withdraw = async (req, res) => {
  const { amount, description } = req.body;
  const amt = parseFloat(amount);
  if (!amount || isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [wallets] = await conn.query(
      'SELECT id, balance FROM wallets WHERE user_id = ? AND deleted_at IS NULL FOR UPDATE',
      [req.user.id]
    );
    if (!wallets.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const wallet = wallets[0];
    const balanceBefore = parseFloat(wallet.balance);
    if (balanceBefore < amt) {
      await conn.rollback();
      return res.status(422).json({ error: 'Insufficient balance' });
    }

    const balanceAfter = balanceBefore - amt;
    const refId = uuidv4();

    await conn.query('UPDATE wallets SET balance = ? WHERE id = ?', [balanceAfter, wallet.id]);

    const [txResult] = await conn.query(
      'INSERT INTO transactions (wallet_id, type, amount, reference_id, description) VALUES (?, ?, ?, ?, ?)',
      [wallet.id, 'withdrawal', amt, refId, description || null]
    );

    await conn.query(
      'INSERT INTO ledger (transaction_id, wallet_id, debit, credit, balance_before, balance_after) VALUES (?, ?, ?, 0, ?, ?)',
      [txResult.insertId, wallet.id, amount, balanceBefore, balanceAfter]
    );

    await conn.commit();
    res.json({ balance: balanceAfter, reference_id: refId });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const transfer = async (req, res) => {
  const { to_wallet_id, amount, description } = req.body;
  const amt = parseFloat(amount);
  if (!to_wallet_id || !amount || isNaN(amt) || amt <= 0) {
    return res.status(400).json({ error: 'to_wallet_id and valid amount required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [senderWallets] = await conn.query(
      'SELECT id, balance FROM wallets WHERE user_id = ? AND deleted_at IS NULL',
      [req.user.id]
    );
    if (!senderWallets.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Sender wallet not found' });
    }

    const [receiverWallets] = await conn.query(
      'SELECT id, balance FROM wallets WHERE id = ? AND deleted_at IS NULL',
      [to_wallet_id]
    );
    if (!receiverWallets.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Recipient wallet not found' });
    }

    const sender = senderWallets[0];
    const receiver = receiverWallets[0];

    if (sender.id === receiver.id) {
      await conn.rollback();
      return res.status(400).json({ error: 'Cannot transfer to same wallet' });
    }

    // Lock both wallets in consistent order to prevent deadlock
    const [first, second] = sender.id < receiver.id
      ? [sender.id, receiver.id]
      : [receiver.id, sender.id];

    await conn.query('SELECT id FROM wallets WHERE id = ? FOR UPDATE', [first]);
    await conn.query('SELECT id FROM wallets WHERE id = ? FOR UPDATE', [second]);

    const [locked] = await conn.query(
      'SELECT id, balance FROM wallets WHERE id IN (?, ?)',
      [sender.id, receiver.id]
    );

    const lockedSender = locked.find(w => w.id === sender.id);
    const lockedReceiver = locked.find(w => w.id === receiver.id);

    const senderBefore = parseFloat(lockedSender.balance);
    if (senderBefore < amt) {
      await conn.rollback();
      return res.status(422).json({ error: 'Insufficient balance' });
    }

    const receiverBefore = parseFloat(lockedReceiver.balance);
    const senderAfter = senderBefore - amt;
    const receiverAfter = receiverBefore + amt;
    const refId = uuidv4();

    await conn.query('UPDATE wallets SET balance = ? WHERE id = ?', [senderAfter, sender.id]);
    await conn.query('UPDATE wallets SET balance = ? WHERE id = ?', [receiverAfter, receiver.id]);

    const [outTx] = await conn.query(
      'INSERT INTO transactions (wallet_id, type, amount, reference_id, description) VALUES (?, ?, ?, ?, ?)',
      [sender.id, 'transfer_out', amt, refId, description || null]
    );

    const [inTx] = await conn.query(
      'INSERT INTO transactions (wallet_id, type, amount, reference_id, description) VALUES (?, ?, ?, ?, ?)',
      [receiver.id, 'transfer_in', amt, `${refId}-in`, description || null]
    );

    await conn.query(
      'INSERT INTO ledger (transaction_id, wallet_id, debit, credit, balance_before, balance_after) VALUES (?, ?, ?, 0, ?, ?)',
      [outTx.insertId, sender.id, amount, senderBefore, senderAfter]
    );

    await conn.query(
      'INSERT INTO ledger (transaction_id, wallet_id, debit, credit, balance_before, balance_after) VALUES (?, ?, 0, ?, ?, ?)',
      [inTx.insertId, receiver.id, amount, receiverBefore, receiverAfter]
    );

    await conn.commit();
    res.json({ balance: senderAfter, reference_id: refId });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

module.exports = { getMyWallet, deposit, withdraw, transfer };
