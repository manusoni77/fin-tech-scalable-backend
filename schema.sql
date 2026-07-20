CREATE DATABASE IF NOT EXISTS fintech_wallet;
USE fintech_wallet;

CREATE TABLE users (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(100) NOT NULL,
  password    VARCHAR(255) NOT NULL,
  role        ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_email (email)
);

CREATE TABLE wallets (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  balance     DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE transactions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  wallet_id    INT NOT NULL,
  type         ENUM('deposit', 'withdrawal', 'transfer_in', 'transfer_out') NOT NULL,
  amount       DECIMAL(15, 2) NOT NULL,
  reference_id VARCHAR(40) NOT NULL,
  status       ENUM('pending', 'completed', 'failed') NOT NULL DEFAULT 'completed',
  description  VARCHAR(255) NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at   TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_reference (reference_id),
  CONSTRAINT fk_tx_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id)
);

CREATE TABLE ledger (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id  INT NOT NULL,
  wallet_id       INT NOT NULL,
  debit           DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  credit          DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  balance_before  DECIMAL(15, 2) NOT NULL,
  balance_after   DECIMAL(15, 2) NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ledger_tx     FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  CONSTRAINT fk_ledger_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id)
);

CREATE INDEX idx_tx_wallet_id   ON transactions(wallet_id);
CREATE INDEX idx_tx_type        ON transactions(type);
CREATE INDEX idx_tx_created_at  ON transactions(created_at);
CREATE INDEX idx_tx_deleted_at  ON transactions(deleted_at);
CREATE INDEX idx_ledger_wallet  ON ledger(wallet_id);
CREATE INDEX idx_ledger_tx      ON ledger(transaction_id);
CREATE INDEX idx_users_deleted  ON users(deleted_at);
CREATE INDEX idx_wallets_user   ON wallets(user_id);

-- Seed an admin user (password: Admin@1234)
INSERT INTO users (name, email, password, role)
VALUES ('Admin', 'admin@fintech.com', '$2a$12$9hCVbAb7.Lr9HJb8oEXeEOR2L6rOJEBfSLdgEh5lbB9sxvZraNmxi', 'admin');

INSERT INTO wallets (user_id) VALUES (1);
