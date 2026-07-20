# Fintech Wallet API

Node.js + Express + MySQL + Redis wallet management system.

## Prerequisites

- Node.js 20+
- MySQL 8+
- Redis 7+

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill values
cp .env.example .env

# 3. Run schema
mysql -u root -p < schema.sql

# 4. Start server
npm start
```

## Environment Variables

| Variable | Description |
|---|---|
| `DB_HOST` | MySQL host |
| `DB_USER` | MySQL user |
| `DB_PASSWORD` | MySQL password |
| `DB_NAME` | Database name |
| `REDIS_HOST` | Redis host |
| `JWT_SECRET` | Secret for JWT signing (min 64 chars) |
| `JWT_EXPIRES_IN` | Token expiry e.g. `24h` |

## API Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Register user |
| POST | `/api/auth/login` | Login (5 req/min/IP) |

### Wallet (requires JWT)
| Method | Path | Description |
|---|---|---|
| GET | `/api/wallet` | Get my wallet |
| POST | `/api/wallet/deposit` | Deposit funds |
| POST | `/api/wallet/withdraw` | Withdraw funds |
| POST | `/api/wallet/transfer` | Transfer to another wallet (20 req/min/user) |

### Transactions (requires JWT)
| Method | Path | Description |
|---|---|---|
| GET | `/api/transactions` | Transaction history |

Query params: `page`, `limit`, `type`, `from`, `to`, `sort`

### Admin (requires admin JWT)
| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/users` | List users |
| DELETE | `/api/admin/users/:id` | Soft delete user |
| GET | `/api/admin/wallets` | List wallets |
| GET | `/api/admin/transactions` | List all transactions |
| POST | `/api/admin/transactions/bulk` | Bulk upload CSV |

## Testing

### 1. Register
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"john@test.com","password":"Pass@1234"}'
```

### 2. Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@test.com","password":"Pass@1234"}'
```
Save the token from response.

### 3. Deposit
```bash
curl -X POST http://localhost:3000/api/wallet/deposit \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":1000}'
```

### 4. Transfer
```bash
curl -X POST http://localhost:3000/api/wallet/transfer \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"to_wallet_id":2,"amount":100}'
```

### 5. Transaction history with filters
```bash
curl "http://localhost:3000/api/transactions?type=deposit&from=2024-01-01&page=1&limit=10&sort=desc" \
  -H "Authorization: Bearer <token>"
```

### 6. Admin login (password: Admin@1234)
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@fintech.com","password":"Admin@1234"}'
```

### 7. Bulk upload CSV
CSV format: `wallet_id,type,amount,description`

```bash
curl -X POST http://localhost:3000/api/admin/transactions/bulk \
  -H "Authorization: Bearer <admin_token>" \
  -F "file=@transactions.csv"
```

Sample CSV:
```
wallet_id,type,amount,description
1,deposit,500.00,Bulk credit
2,deposit,200.00,Bulk credit
```

## Rate Limits

| Endpoint | Limit |
|---|---|
| POST `/api/auth/login` | 5 req/min per IP |
| POST `/api/wallet/transfer` | 20 req/min per user |
| All other endpoints | 100 req/min per IP |

Returns `429` when limit exceeded.

## Logs

Logs written to `logs/combined.log` and `logs/error.log`.
