const path = require('node:path');

require('dotenv').config();

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

module.exports = {
  port: numberFromEnv('PORT', 3000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/insuredmine_assessment',
  cpuThreshold: nonNegativeNumberFromEnv('CPU_THRESHOLD', 70),
  cpuCheckIntervalMs: numberFromEnv('CPU_CHECK_INTERVAL_MS', 5000),
  shutdownTimeoutMs: numberFromEnv('SHUTDOWN_TIMEOUT_MS', 15000),
  uploadDir: path.join(__dirname, '..', 'uploads')
};
