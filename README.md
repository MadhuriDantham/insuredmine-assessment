# InsuredMine Assessment

This is a Node.js backend API for importing insurance policy data from CSV or Excel files into MongoDB.

The project uses:

- Node.js and Express for APIs
- MongoDB native Node.js driver for database work
- Multer for file upload
- `csv-parse` for CSV reading
- ExcelJS for XLSX reading
- Worker Threads for background import work
- PM2 for supervised restart
- Node's built-in test runner

There is no frontend page in this project. API testing can be done with Postman or curl.

## Prerequisites

Install these before running the project:

- Node.js
- npm
- MongoDB server running locally
- Postman, optional but useful for API testing

Default MongoDB connection:

```text
mongodb://127.0.0.1:27017/insuredmine_assessment
```

## Setup

Run these commands in Git Bash:

```bash
cd /d/InsuredMine/insuredmine-assessment
npm install
cp .env.example .env
npm start
```

The server starts on:

```text
http://localhost:3000
```

Health check:

```text
GET http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "uptimeSeconds": 10
}
```

If `http://localhost:3000` shows `Route not found`, that is normal. This project exposes API routes, not a homepage.

## Environment Values

`.env.example` contains:

```env
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/insuredmine_assessment
CPU_THRESHOLD=70
CPU_CHECK_INTERVAL_MS=5000
```

Do not commit the real `.env` file. Commit only `.env.example`.

## Folder Structure

```text
insuredmine-assessment/
  src/
    app.js
    server.js
    config.js
    db.js
    routes/
    services/
    helpers/
    workers/
  fixtures/
  scripts/
  test/
  .env.example
  ecosystem.config.js
  package.json
  README.md
```

Important files:

- `src/server.js`: starts the server, connects MongoDB, starts CPU monitoring, and starts the scheduler
- `src/app.js`: creates the Express app and connects API routes
- `src/config.js`: reads environment variables
- `src/db.js`: connects to MongoDB and creates indexes
- `src/routes/uploadRoutes.js`: upload API
- `src/routes/policyRoutes.js`: search and aggregation APIs
- `src/routes/messageRoutes.js`: scheduled message APIs
- `src/services/importService.js`: CSV/XLSX parsing, validation, and database import
- `src/services/cpuMonitor.js`: CPU percentage calculation and restart trigger
- `src/services/messageScheduler.js`: checks pending scheduled messages
- `src/workers/importWorker.js`: runs the file import in a worker thread
- `fixtures/fictional-policies.csv`: fake sample CSV for testing only
- `test/assessment.test.js`: automated tests

## Input File

The real assessment CSV should be placed here:

```text
input/assessment.csv
```

The `input/` folder is ignored by Git because the assessment CSV may contain real or private data.

The upload API expects these important columns:

```text
agent
userType
policy_number
company_name
category_name
policy_start_date
policy_end_date
account_name
email
firstname
gender
phone
address
state
zip
dob
```

Extra columns are allowed and ignored if they are not needed.

## Database Collections

The import stores data in these MongoDB collections:

```text
agents
users
user_accounts
lobs
carriers
policies
scheduled_messages
messages
```

The `policies` collection stores ObjectId references to the other collections:

```text
policy.category_id -> lobs
policy.company_id  -> carriers
policy.user_id     -> users
policy.agent_id    -> agents
policy.account_id  -> user_accounts
```

Simple meaning:

```text
One policy is connected to one user, one agent, one account, one company, and one category.
```

## Duplicate Handling

Uploading the same file again should not create duplicate records.

The project uses these rules:

```text
Agent   = normalized agent name
LOB     = normalized category name
Carrier = normalized company name
User    = normalized firstname + normalized email + DOB
Account = user_id + normalized account name
Policy  = policy_number
```

The CSV does not have a stable user ID or username column. For this assessment, user identity is assumed from:

```text
firstname + email + dob
```

This is only an assessment assumption. In a real production system, a proper user ID should be used.

## API Testing With Postman

Start the server first:

```bash
npm start
```

Use this base URL:

```text
http://localhost:3000
```

### 1. Health API

```text
Method: GET
URL: http://localhost:3000/health
```

### 2. Upload CSV or XLSX

```text
Method: POST
URL: http://localhost:3000/api/upload
Body: form-data
Key: file
Type: File
Value: choose input/assessment.csv
```

Important:

```text
The form-data key must be exactly file.
```

Expected first upload for the assessment CSV:

```json
{
  "success": true,
  "processed": 1198,
  "inserted": 1198,
  "existingOrUpdated": 0,
  "rejected": 0,
  "rejectedRows": [],
  "message": "Import completed successfully."
}
```

Expected second upload of the same file:

```json
{
  "success": true,
  "processed": 1198,
  "inserted": 0,
  "existingOrUpdated": 1198,
  "rejected": 0,
  "rejectedRows": [],
  "message": "Import completed successfully."
}
```

### 3. Search Policies

```text
Method: GET
URL: http://localhost:3000/api/policies/search?username=Lura%20Lucca
```

The assessment asks for `username`, but the CSV does not contain a username column. This API treats `username` as the full value stored in `firstname`.

The search is case-insensitive exact match.

### 4. Aggregate Policies

```text
Method: GET
URL: http://localhost:3000/api/policies/aggregate
```

This returns every user with:

```text
userId
firstname
email
totalPolicies
policies
```

The aggregation starts from `users`, so users with zero policies are also included.

### 5. Schedule Message

```text
Method: POST
URL: http://localhost:3000/api/messages/schedule
Body: raw JSON
```

Example body:

```json
{
  "message": "Assessment reminder",
  "day": "2026-09-27",
  "time": "18:30"
}
```

Use a future date and time while testing.

Rules:

- `day` must be `YYYY-MM-DD`
- `time` must be 24-hour `HH:mm`
- input time is treated as IST
- stored time is UTC
- final message is not inserted immediately

Expected response:

```json
{
  "scheduleId": "68d79...",
  "scheduledFor": "2026-09-27T13:00:00.000Z",
  "status": "pending"
}
```

### 6. Get Inserted Messages

```text
Method: GET
URL: http://localhost:3000/api/messages
```

If the scheduled time has passed, the final message appears here. If the scheduled time is still in the future, the list may be empty.

## curl Examples

Health:

```bash
curl http://localhost:3000/health
```

Upload:

```bash
curl -X POST http://localhost:3000/api/upload \
  -F "file=@input/assessment.csv"
```

Search:

```bash
curl "http://localhost:3000/api/policies/search?username=Lura%20Lucca"
```

Aggregation:

```bash
curl http://localhost:3000/api/policies/aggregate
```

Schedule message:

```bash
curl -X POST http://localhost:3000/api/messages/schedule \
  -H "Content-Type: application/json" \
  -d '{"message":"Assessment reminder","day":"2026-09-27","time":"18:30"}'
```

List messages:

```bash
curl http://localhost:3000/api/messages
```

## CPU Monitoring And PM2 Restart

The app checks its own Node.js process CPU usage every few seconds.

Default values:

```text
CPU_THRESHOLD=70
CPU_CHECK_INTERVAL_MS=5000
```

How the calculation works:

1. The app takes one CPU reading using `process.cpuUsage()`.
2. It waits for the configured interval.
3. It takes another CPU reading.
4. It checks how much CPU time was used between the two readings.
5. It compares that CPU time with real elapsed time from `process.hrtime.bigint()`.
6. The result is a CPU percentage.

For this assessment:

```text
100% means one logical CPU core is fully used by this Node.js process.
```

This measures only the Node.js app, not the full machine CPU.

When CPU reaches or crosses the threshold:

```text
1. The app stops accepting new work.
2. CPU monitoring stops.
3. Message scheduler stops.
4. HTTP server stops accepting requests.
5. MongoDB connection closes.
6. Node process exits.
7. PM2 restarts the app.
```

Important:

```text
process.exit() alone is not the restart feature.
PM2 is the tool that restarts the app after it exits.
```

Run with PM2:

```bash
npm run pm2:start
npm run pm2:logs
npm run pm2:stop
```

Safe CPU restart check:

```bash
CPU_THRESHOLD=0 npm run pm2:start
npm run pm2:logs
npm run pm2:stop
```

## Scheduled Message Flow

The schedule API uses MongoDB, not only memory.

Flow:

```text
1. User sends message, day, and time.
2. API validates input.
3. API stores the schedule in scheduled_messages.
4. A polling loop checks pending schedules about every second.
5. When scheduled time is reached, final message is inserted into messages.
6. The schedule is marked completed.
```

The final message uses the same `_id` as the schedule and uses upsert. This prevents duplicate final messages if the scheduler retries.

Timing limitation:

```text
The message is inserted at or after the scheduled time, usually near the next polling cycle.
It can be later if the app or database is unavailable.
```

## Tests

Tests use a separate normal MongoDB database:

```text
mongodb://127.0.0.1:27017/insuredmine_assessment_test
```

Run tests:

```bash
npm test
```

The test database name must include `test`, because tests clear that database before and after running.

Covered test cases:

- CSV upload
- XLSX upload
- missing file upload
- invalid file upload
- blank optional fields
- leading-zero values
- duplicate upload handling
- users sharing same email
- one user with multiple policies
- search API
- aggregation API
- CPU percentage calculation
- CPU threshold handling
- invalid schedule time
- past schedule time
- no message before due time
- scheduled message delivery
- duplicate-safe message retry

## Expected Assessment Counts

After uploading the supplied assessment CSV into a fresh database:

```text
policies: 1198
agents:   3
lobs:     19
carriers: 46
```

These numbers are expected results, not hardcoded application logic.

## Git Notes

Commit these:

```text
src/
test/
fixtures/
scripts/
.env.example
.gitignore
README.md
package.json
package-lock.json
ecosystem.config.js
```

Do not commit these:

```text
.env
input/
node_modules/
uploads/
```

## Simple Project Summary

This project imports insurance policy data into MongoDB and provides APIs to search, aggregate, schedule messages, and handle CPU-based restart behavior.

In simple words:

```text
Upload file -> read rows -> validate data -> save to MongoDB -> search and report data through APIs
```

Manager-friendly explanation:

```text
I built a Node.js Express backend API using the official MongoDB client. It accepts CSV and Excel policy files, validates each row, stores the data in separate MongoDB collections, and connects policies with users, agents, carriers, LOBs, and accounts using ObjectId references. Duplicate uploads are handled using unique indexes and upsert. The project also includes policy search, user-policy aggregation, CPU monitoring with PM2 restart support, scheduled messages, documentation, and automated tests.
```

## Limitations

- User identity is assumed from `firstname + email + dob` because the CSV has no stable user ID.
- `policy_number` is treated as unique for this assessment.
- Imports are safe to retry but are not wrapped in a database-wide transaction.
- XLSX numeric cells cannot recover leading zeros if Excel stored them as numbers.
- Scheduled message delivery is polling-based, so it is not exact to the millisecond.
