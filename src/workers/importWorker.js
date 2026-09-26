const { parentPort, workerData } = require('node:worker_threads');

const { closeDatabase, connectToDatabase } = require('../db');
const { importFile } = require('../services/importService');

async function run() {
  await connectToDatabase(workerData.mongoUri);
  let result;

  try {
    result = await importFile({
      filePath: workerData.filePath,
      fileType: workerData.fileType
    });
  } finally {
    await closeDatabase();
  }

  parentPort.postMessage({ ok: true, result });
}

run().catch(async (err) => {
  try {
    await closeDatabase();
  } catch (disconnectErr) {
    console.error('Worker failed to disconnect cleanly:', disconnectErr);
  }

  parentPort.postMessage({
    ok: false,
    error: {
      message: err.publicMessage || err.message,
      statusCode: err.statusCode || 500
    }
  });
});
