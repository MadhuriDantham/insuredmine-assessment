# InsuredMine Assessment

Small CommonJS Node.js API for the InsuredMine technical assessment. It uses Express, MongoDB's native Node.js driver, Multer, `csv-parse`, ExcelJS, worker threads, PM2, and Node's built-in test runner.

## Setup on Windows Git Bash

```bash
cd /d/InsuredMine/insuredmine-assessment
npm install
cp .env.example .env
```

Edit `.env` if needed:

```bash
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/insuredmine_assessment
CPU_THRESHOLD=70
CPU_CHECK_INTERVAL_MS=5000
```

Run normally:

```bash
npm start
```

Run under PM2 supervision:

```bash
npm run pm2:start
npm run pm2:logs
npm run pm2:stop
```

Ordinary `npm start` is not supervised. CPU-triggered exits are restarted only when the app is running under PM2 or another process manager.

## Structure

- `src/`: all backend application code.
- `src/app.js`: creates the Express app and connects the API routes.
- `src/server.js`: starts the server, connects MongoDB, starts CPU monitoring, and starts the message scheduler.
- `src/config.js`: reads values from `.env`.
- `src/db.js`: MongoDB connection, collection names, and indexes.
- `src/routes/`: API route files.
- `src/services/`: main business logic, like file import, CPU check, and message scheduling.
- `src/workers/importWorker.js`: worker thread used by `POST /api/upload`.
- `src/helpers/`: small shared helper functions for dates and text cleanup.
- `fixtures/`: small fictional CSV fixture only. It does not contain assessment records.
- `scripts/create-xlsx-fixture.js`: creates a genuine fictional XLSX fixture.
- `test/`: Node test runner tests.

The old `models`, `routes`, `services`, `utils`, and `workers` folders were moved under `src/` so the project root stays clean.

## Simple Explanation for HR

This is a backend API project. There is no frontend screen. The API receives insurance files, reads the data, validates it, saves it in MongoDB, and gives JSON responses.

Flow:

1. Start the app with `npm start`.
2. The app connects to MongoDB.
3. User uploads a CSV or XLSX file.
4. The upload route receives the file.
5. A worker thread reads the file in the background.
6. Each row is checked.
7. Valid rows are saved in MongoDB.
8. Duplicate rows are updated instead of inserted again.
9. Search and aggregation APIs read the saved policy data.
10. The scheduler API saves future messages and inserts them when the time comes.

## Collections and Relationships

The import creates six assessment collections: `agents`, `users`, `user_accounts`, `lobs`, `carriers`, and `policies`.

`policies` stores real ObjectId references to:

- `category_id -> lobs`
- `company_id -> carriers`
- `user_id -> users`
- `agent_id -> agents`
- `account_id -> user_accounts`

The message service also uses `scheduled_messages` and `messages`.

## Duplicate Handling Assumptions

The CSV has no populated stable user ID and no username column. For this assessment, a user identity is treated as:

```text
normalized firstname + normalized email + DOB
```

That is an assessment assumption, not a safe real-world identity system. The original display value remains stored in `firstname`.

Other idempotency rules:

- `Agent`, `LOB`, and `Carrier` are reused by normalized names.
- Accounts are identified by `user_id + normalized account_name`.
- `policy_number` is treated as unique for this assessment.
- Reuploading the same file updates/reuses records and should not increase counts.

## Upload Import

`POST /api/upload`

- Multipart form field: `file`
- Supports `.csv` and `.xlsx`
- Limit: 10 MB
- Parsing, validation, and import run inside a real worker thread.
- The worker opens and closes its own MongoDB connection.
- Only one import is allowed at a time.
- Invalid rows are reported by row number and short reasons; full personal-data rows are not returned.
- An interrupted import may be partial. Because upserts are idempotent, retrying the same file is safe. A database-wide transaction is intentionally not used.

Example:

```bash
curl -X POST http://localhost:3000/api/upload \
  -F "file=@fixtures/fictional-policies.csv"
```

Generate and upload the fictional XLSX fixture:

```bash
npm run fixture:xlsx
curl -X POST http://localhost:3000/api/upload \
  -F "file=@fixtures/fictional-policies.xlsx"
```

For the supplied assessment CSV, a fresh successful import is expected to contain 1,198 policies, 3 agents, 19 LOB records, and 46 carriers. These numbers are not hardcoded. Verify them after importing with `mongosh`:

```bash
mongosh "$MONGO_URI" --eval "db.policies.countDocuments(); db.agents.countDocuments(); db.lobs.countDocuments(); db.carriers.countDocuments();"
```

## Policy APIs

The assessment asks for `username`, but the file has no username column. This API interprets `username` as the full value stored in `firstname`.

Search by exact firstname, case-insensitive:

```bash
curl "http://localhost:3000/api/policies/search?username=Jamie%20Stone"
```

Aggregate users and policy counts using MongoDB aggregation:

```bash
curl http://localhost:3000/api/policies/aggregate
```

The aggregation starts from `users`, includes users with zero policies, and keeps separate user IDs separate even if names or emails match.

## Scheduled Messages

`day` is a specific `YYYY-MM-DD` date, `time` is 24-hour `HH:mm`, and input is interpreted in IST (`UTC+05:30`). The stored `scheduled_for` value is UTC.

Schedule a message:

```bash
curl -X POST http://localhost:3000/api/messages/schedule \
  -H "Content-Type: application/json" \
  -d '{"message":"Assessment reminder","day":"2026-09-27","time":"18:30"}'
```

Choose a future date and time when testing. The final `Message` is not inserted at request time.

List inserted final messages:

```bash
curl http://localhost:3000/api/messages
```

The scheduler polls the database about once per second. Insertion happens at or after the scheduled time, usually near the next polling cycle, and later if the app or database is unavailable. Pending schedules are processed on startup, so this survives PM2 restarts.

## CPU Monitoring and Restart

The app samples `process.cpuUsage()` every `CPU_CHECK_INTERVAL_MS` milliseconds. The calculation compares CPU microseconds used by the Node process with actual monotonic elapsed time from `process.hrtime.bigint()`.

For this assessment, `100%` means one logical CPU core of process CPU usage. Values can exceed `100%` when worker threads are active. This measures the Node process, not whole-machine CPU.

When a sample reaches `CPU_THRESHOLD`:

- new work is rejected,
- monitoring and scheduling timers are cleared,
- the HTTP server stops accepting connections,
- MongoDB is closed after active work gets a bounded chance to finish,
- the process exits so PM2 can restart it.

Safe verification without a CPU-burning endpoint:

```bash
CPU_THRESHOLD=0 npm run pm2:start
npm run pm2:logs
npm run pm2:stop
```

## Health

```bash
curl http://localhost:3000/health
```

## Tests

Tests use a normal MongoDB connection. By default, tests connect to:

```text
mongodb://127.0.0.1:27017/insuredmine_assessment_test
```

You can override it with `MONGO_TEST_URI`. The test database name must include `test`, because the test setup clears that database before and after running.

```bash
npm test
```

Covered behavior includes CSV/XLSX import, missing/invalid uploads, blank optional fields, leading-zero strings, idempotent reupload, shared emails, multiple policies per user, search, aggregation, CPU percentage/threshold behavior, invalid/past schedule times, no early final message, delivery after a simulated restart, and duplicate-safe delivery retry.

## Limitations

- The user identity key is only an assessment rule.
- `policy_number` uniqueness is assumed for this task.
- Imports are safe to retry but not wrapped in a database-wide transaction.
- XLSX numeric cells cannot recover leading zeros if Excel stored them as numbers; text-formatted cells preserve them.
- The scheduler is simple polling, not exact-time delivery.
