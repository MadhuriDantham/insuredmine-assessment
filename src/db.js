const { MongoClient } = require('mongodb');

const COLLECTIONS = {
  agents: 'agents',
  users: 'users',
  userAccounts: 'user_accounts',
  lobs: 'lobs',
  carriers: 'carriers',
  policies: 'policies',
  scheduledMessages: 'scheduled_messages',
  messages: 'messages'
};

let client;
let db;

async function connectToDatabase(mongoUri) {
  if (db) {
    return db;
  }

  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db();
  return db;
}

function getDb() {
  if (!db) {
    throw new Error('MongoDB is not connected yet.');
  }
  return db;
}

function collection(name) {
  const collectionName = COLLECTIONS[name] || name;
  return getDb().collection(collectionName);
}

async function ensureIndexes() {
  await collection('agents').createIndex({ normalized_name: 1 }, { unique: true });
  await collection('users').createIndex({ identity_key: 1 }, { unique: true });
  await collection('users').createIndex({ normalized_firstname: 1 });
  await collection('userAccounts').createIndex({ user_id: 1, normalized_account_name: 1 }, { unique: true });
  await collection('lobs').createIndex({ normalized_name: 1 }, { unique: true });
  await collection('carriers').createIndex({ normalized_name: 1 }, { unique: true });
  await collection('policies').createIndex({ policy_number: 1 }, { unique: true });
  await collection('policies').createIndex({ user_id: 1 });
  await collection('scheduledMessages').createIndex({ status: 1, scheduled_for: 1 });
}

async function closeDatabase() {
  if (client) {
    await client.close();
  }
  client = null;
  db = null;
}

module.exports = {
  COLLECTIONS,
  closeDatabase,
  collection,
  connectToDatabase,
  ensureIndexes,
  getDb
};
