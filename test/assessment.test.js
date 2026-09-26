const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const ExcelJS = require('exceljs');
const { ObjectId } = require('mongodb');
const request = require('supertest');

const {
  closeDatabase,
  collection,
  connectToDatabase,
  ensureIndexes,
  getDb
} = require('../src/db');
const { processDueMessages } = require('../src/services/messageScheduler');
const { makeUserIdentityKey, normalizeName, normalizeEmail } = require('../src/helpers/normalize');

const fixtureCsv = path.join(__dirname, '..', 'fixtures', 'fictional-policies.csv');
let tempDir;
let app;
let calculateCpuPercent;
let startCpuMonitor;
const testMongoUri = process.env.MONGO_TEST_URI || 'mongodb://127.0.0.1:27017/insuredmine_assessment_test';

const headers = [
  'agent',
  'userType',
  'policy_mode',
  'producer',
  'policy_number',
  'premium_amount_written',
  'premium_amount',
  'policy_type',
  'company_name',
  'category_name',
  'policy_start_date',
  'policy_end_date',
  'csr',
  'account_name',
  'email',
  'gender',
  'firstname',
  'city',
  'account_type',
  'phone',
  'address',
  'state',
  'zip',
  'dob',
  'primary',
  'Applicant ID',
  'agency_id',
  'hasActive ClientPolicy'
];

async function uploadFile(filePath) {
  return request(app).post('/api/upload').attach('file', filePath);
}

function toIstInput(date) {
  const shifted = new Date(date.getTime() + 330 * 60 * 1000);
  const day = shifted.toISOString().slice(0, 10);
  const time = shifted.toISOString().slice(11, 16);
  return { day, time };
}

async function createXlsxFixture(filePath) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Policies');
  sheet.addRow(headers);
  sheet.addRow([
    'Agent Three',
    'Active Client',
    '12',
    'Fictional Producer',
    'XLSX-004',
    '',
    '150.25',
    'Single',
    'Carrier C',
    'Commercial Auto',
    new Date(2026, 3, 1),
    new Date(2027, 3, 1),
    'Fictional CSR',
    'Excel Account',
    'excel@example.test',
    '',
    'Excel Example',
    'Sample City',
    'Commercial',
    '000-555-0104',
    '',
    'NC',
    '00045',
    new Date(1995, 4, 6),
    '',
    '',
    '',
    ''
  ]);
  await workbook.xlsx.writeFile(filePath);
}

function getDatabaseName(uri) {
  const parsed = new URL(uri);
  return parsed.pathname.replace('/', '').split('?')[0];
}

test.before(async () => {
  const databaseName = getDatabaseName(testMongoUri);
  if (!databaseName || !databaseName.toLowerCase().includes('test')) {
    throw new Error('MONGO_TEST_URI database name must include "test" so tests cannot clear development data.');
  }

  process.env.MONGO_URI = testMongoUri;
  app = require('../src/app');
  ({ calculateCpuPercent, startCpuMonitor } = require('../src/services/cpuMonitor'));
  const db = await connectToDatabase(process.env.MONGO_URI);
  await db.dropDatabase();
  await ensureIndexes();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'insuredmine-test-'));
});

test.after(async () => {
  await getDb().dropDatabase();
  await closeDatabase();
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('upload rejects missing, unsupported, and unreadable files', async () => {
  const missing = await request(app).post('/api/upload');
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /Missing file/);

  const txtPath = path.join(tempDir, 'bad.txt');
  await fs.writeFile(txtPath, 'not a policy file');
  const unsupported = await uploadFile(txtPath);
  assert.equal(unsupported.status, 400);
  assert.match(unsupported.body.error, /Unsupported file type/);

  const badXlsxPath = path.join(tempDir, 'bad.xlsx');
  await fs.writeFile(badXlsxPath, 'not really xlsx');
  const unreadable = await uploadFile(badXlsxPath);
  assert.equal(unreadable.status, 400);
  assert.match(unreadable.body.error, /Unable to read XLSX/);
});

test('CSV upload imports rows, preserves strings, and reupload does not duplicate records', async () => {
  const firstImport = await uploadFile(fixtureCsv);
  assert.equal(firstImport.status, 200);
  assert.equal(firstImport.body.processed, 3);
  assert.equal(firstImport.body.inserted, 3);
  assert.equal(firstImport.body.existingOrUpdated, 0);
  assert.equal(firstImport.body.rejected, 0);

  assert.equal(await collection('policies').countDocuments(), 3);
  assert.equal(await collection('users').countDocuments({ email: 'shared@example.test' }), 2);
  assert.equal(await collection('agents').countDocuments(), 2);
  assert.equal(await collection('lobs').countDocuments(), 2);
  assert.equal(await collection('carriers').countDocuments(), 2);

  const leadingZeroPolicy = await collection('policies').findOne({ policy_number: '000ABC123' });
  const leadingZeroUser = await collection('users').findOne({ _id: leadingZeroPolicy.user_id });
  assert.ok(leadingZeroPolicy);
  assert.equal(leadingZeroUser.phone, '001-555-0001 ext 09');
  assert.equal(leadingZeroUser.zip, '01234');

  const robin = await collection('users').findOne({ firstname: 'Robin Vale' });
  assert.equal(robin.gender, '');

  const secondImport = await uploadFile(fixtureCsv);
  assert.equal(secondImport.status, 200);
  assert.equal(secondImport.body.inserted, 0);
  assert.equal(secondImport.body.existingOrUpdated, 3);
  assert.equal(secondImport.body.rejected, 0);
  assert.equal(await collection('policies').countDocuments(), 3);
});

test('XLSX upload imports Excel date cells', async () => {
  const xlsxPath = path.join(tempDir, 'fixture.xlsx');
  await createXlsxFixture(xlsxPath);

  const response = await uploadFile(xlsxPath);
  assert.equal(response.status, 200);
  assert.equal(response.body.inserted, 1);
  assert.equal(response.body.rejected, 0);

  const policy = await collection('policies').findOne({ policy_number: 'XLSX-004' });
  const policyUser = await collection('users').findOne({ _id: policy.user_id });
  assert.ok(policy);
  assert.equal(policy.policy_start_date.toISOString().slice(0, 10), '2026-04-01');
  assert.equal(policyUser.dob.toISOString().slice(0, 10), '1995-05-06');
});

test('search uses full firstname literally and aggregation keeps user IDs separate', async () => {
  const search = await request(app).get('/api/policies/search').query({ username: 'jamie stone' });
  assert.equal(search.status, 200);
  assert.equal(search.body.count, 2);
  assert.ok(search.body.policies.every((policy) => policy.user.firstname === 'Jamie Stone'));
  assert.ok(search.body.policies.every((policy) => policy.category.category_name));
  assert.ok(search.body.policies.every((policy) => policy.carrier.company_name));

  const none = await request(app).get('/api/policies/search').query({ username: 'Nobody Example' });
  assert.equal(none.status, 200);
  assert.deepEqual(none.body.policies, []);

  await collection('users').insertOne({
    firstname: 'Zero Policies',
    dob: new Date(Date.UTC(1999, 0, 1)),
    email: 'zero@example.test',
    normalized_firstname: normalizeName('Zero Policies'),
    normalized_email: normalizeEmail('zero@example.test'),
    identity_key: makeUserIdentityKey('Zero Policies', 'zero@example.test', '1999-01-01')
  });

  const aggregate = await request(app).get('/api/policies/aggregate');
  assert.equal(aggregate.status, 200);
  const jamie = aggregate.body.users.find((user) => user.firstname === 'Jamie Stone');
  const robin = aggregate.body.users.find((user) => user.firstname === 'Robin Vale');
  const zero = aggregate.body.users.find((user) => user.firstname === 'Zero Policies');
  assert.equal(jamie.totalPolicies, 2);
  assert.equal(robin.totalPolicies, 1);
  assert.equal(zero.totalPolicies, 0);
});

test('CPU percentage calculation and threshold callback work', async () => {
  const percent = calculateCpuPercent(
    { cpu: { user: 100000, system: 50000 }, time: 1000000000n },
    { cpu: { user: 400000, system: 150000 }, time: 2000000000n }
  );
  assert.equal(percent, 40);

  let thresholdHits = 0;
  await new Promise((resolve) => {
    const monitor = startCpuMonitor({
      threshold: 0,
      intervalMs: 5,
      logger: { log() {}, warn() {} },
      onThreshold() {
        thresholdHits += 1;
        monitor.stop();
        resolve();
      }
    });
  });
  assert.equal(thresholdHits, 1);
});

test('scheduled messages validate time, wait until due, survive retry, and avoid duplicates', async () => {
  const invalid = await request(app)
    .post('/api/messages/schedule')
    .send({ message: 'Bad time', day: '2026-09-27', time: '25:00' });
  assert.equal(invalid.status, 400);

  const past = await request(app)
    .post('/api/messages/schedule')
    .send({ message: 'Past time', day: '2000-01-01', time: '10:00' });
  assert.equal(past.status, 400);

  const futureInput = toIstInput(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const scheduled = await request(app)
    .post('/api/messages/schedule')
    .send({ message: 'Assessment reminder', ...futureInput });
  assert.equal(scheduled.status, 202);

  await processDueMessages(new Date());
  const scheduleId = new ObjectId(scheduled.body.scheduleId);
  assert.equal(await collection('messages').countDocuments({ _id: scheduleId }), 0);

  await collection('scheduledMessages').updateOne(
    { _id: scheduleId },
    { $set: { scheduled_for: new Date(Date.now() - 1000) } }
  );

  const firstPoll = await processDueMessages(new Date());
  assert.equal(firstPoll.processed, 1);
  assert.equal(await collection('messages').countDocuments({ _id: scheduleId }), 1);

  const secondPoll = await processDueMessages(new Date());
  assert.equal(secondPoll.processed, 0);
  assert.equal(await collection('messages').countDocuments({ _id: scheduleId }), 1);

  const schedule = await collection('scheduledMessages').findOne({ _id: scheduleId });
  assert.equal(schedule.status, 'completed');
});
