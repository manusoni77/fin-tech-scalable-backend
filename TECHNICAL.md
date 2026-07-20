# Technical Design Notes

## Race Condition Handling

The most critical challenge in a wallet system is preventing concurrent transactions from corrupting balances.

**Approach: `SELECT ... FOR UPDATE` inside a MySQL transaction**

When a deposit, withdraw, or transfer is initiated:
1. `BEGIN TRANSACTION`
2. `SELECT balance FROM wallets WHERE id = ? FOR UPDATE` — this acquires a row-level exclusive lock
3. Any other transaction trying to touch the same wallet row will block until this one commits or rolls back
4. Balance check + UPDATE + ledger insert all happen atomically
5. `COMMIT` releases the lock

This completely prevents the classic race condition where two concurrent withdrawals both see a positive balance and both succeed, pushing balance negative.

**Transfer deadlock prevention:**
When transferring between wallet A and wallet B, both rows need to be locked. If request 1 locks A then B, and request 2 locks B then A simultaneously, you get a deadlock. The fix is to always lock wallets in a consistent order (by ID, lower ID first). Both requests will then wait in the same order and one will proceed after the other commits.

## 10k+ Request Handling

- **Connection pooling:** `mysql2/promise` pool with 50 connections. Each query borrows a connection and returns it — no connection-per-request overhead.
- **Non-blocking I/O:** Node's event loop handles thousands of concurrent connections without threads. Heavy work (bcrypt hashing) is pushed to the libuv thread pool automatically.
- **Redis for rate limiting:** Rate limit checks are O(1) Redis operations, no DB hit for throttling.
- **No synchronous blocking code** anywhere in the request path.

For production scale-out: run multiple Node processes behind a load balancer (nginx / AWS ALB). The pool and Redis are shared infrastructure.

## Rate Limiting

Custom Redis-based sliding counter approach:
- `INCR rate:{scope}:{identifier}` — atomically increment
- On first increment, `EXPIRE` sets TTL to the window (60s)
- If count exceeds limit, return 429 with `retryAfter`
- Scoped by IP for public/login, by user ID for transfer

Why not `express-rate-limit`? Works fine but using Redis directly gives us a single source of truth across multiple server instances.

## File Streaming & Chunk Processing

Large CSV uploads are handled without loading the entire file into a parsed array:
1. `multer` accepts the file into memory (limit 50MB)
2. `Readable.from(buffer)` creates a stream from the buffer
3. `csv-parse` transforms it row by row — only one row lives in memory at a time
4. When the batch reaches 500 rows, the parser is **paused**, the chunk is processed (bulk insert), then **resumed**

This means a 100k-row file never allocates a 100k-row array. Memory stays flat.

The bulk insert uses MySQL's multi-row `INSERT INTO ... VALUES ?, ?, ?` syntax — one query per 500 rows instead of 500 queries. This is orders of magnitude faster.

## Soft Delete / Archive Strategy

All user-facing tables have `deleted_at TIMESTAMP NULL`. Deletion sets this column instead of removing the row.

Benefits:
- Financial audit trail is never destroyed
- Accidental deletions are recoverable
- All queries filter with `WHERE deleted_at IS NULL`

The ledger table has no soft delete — ledger entries are immutable by design.

## Logging & Monitoring

Winston is configured with:
- Console transport (structured JSON for log aggregators)
- File transport: `error.log` for errors, `combined.log` for everything

`requestLogger` middleware fires on `res.on('finish')` — captures method, URL, status code, response time, user ID, and IP after every response.

## Security Decisions

**bcrypt cost factor 12:** ~300ms per hash on modern hardware. Expensive enough to make brute-force infeasible, fast enough for a login endpoint.

**JWT HS256 with 24h expiry:** HS256 is sufficient when the secret is kept private (server-side only, min 64 chars). For multi-service architectures, RS256 (asymmetric) would be better.

**Helmet:** Sets security headers (X-Content-Type-Options, X-Frame-Options, HSTS, CSP, etc.) with one middleware call.

**CORS:** Configurable via `CORS_ORIGIN` env var. Defaults to `*` for development; set to specific domains in production.

**Parameterized queries everywhere:** `mysql2` with `?` placeholders prevents SQL injection at the driver level. No string concatenation in any query.

## Database Design

**`transactions` table:** One row per financial event. The `reference_id` is a UUID with a `UNIQUE` constraint — this is the idempotency key. A retry with the same reference_id will fail with a 409 rather than creating a duplicate transaction.

**`ledger` table:** Immutable double-entry record. Every transaction produces a ledger entry with `balance_before` and `balance_after`. This is your audit trail — you can reconstruct any wallet's balance at any point in time by replaying ledger entries.

**Transfer creates two transaction rows:** `transfer_out` on the sender, `transfer_in` on the receiver. Both share a reference UUID (receiver gets `{uuid}-in`). This keeps wallet-scoped queries simple while linking both legs.

**Indexes:** On `transactions(wallet_id)`, `transactions(created_at)`, `transactions(type)` to support the paginated filtered history query without full table scans.

## Error Handling

- Controllers throw; the global Express error handler catches everything
- `ER_DUP_ENTRY` (MySQL error code for unique constraint violation) maps to 409 — used for duplicate reference_id on retry
- DB transaction rollback in every `catch` block — no partial state left in the DB
- Connection always released in `finally` — no connection leaks

## What Would Change at Scale

1. **Message queue for transfers:** At very high volume, put transfers on a queue (BullMQ/Kafka) and process async. Return a job ID immediately, poll for status. Eliminates long-held DB locks under load.
2. **Read replicas:** Point GET queries (history, admin views) to a read replica. Writes go to primary.
3. **Redis for balance caching:** Cache wallet balance in Redis, invalidate on write. Reduces DB load for balance reads.
4. **Rate limiter with Lua scripts:** The current INCR+EXPIRE has a tiny race on the very first request. A Redis Lua script makes it atomic. Low priority for the current scale.
5. **Separate admin service:** Admin bulk operations (especially bulk upload) can block DB connections for long periods. Run them in a separate process with its own pool.
