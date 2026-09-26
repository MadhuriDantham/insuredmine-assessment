const app = require('./app');
const config = require('./config');
const { closeDatabase, connectToDatabase, ensureIndexes } = require('./db');
const { startCpuMonitor } = require('./services/cpuMonitor');
const { startMessageScheduler } = require('./services/messageScheduler');

let server;
let cpuMonitor;
let messageScheduler;
let shuttingDown = false;

function requestShutdown(reason) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.locals.shuttingDown = true;
  console.warn(`Shutdown requested: ${reason}`);

  if (cpuMonitor) {
    cpuMonitor.stop();
  }
  if (messageScheduler) {
    messageScheduler.stop();
  }

  const forcedExit = setTimeout(() => {
    console.error(`Shutdown timed out after ${config.shutdownTimeoutMs}ms. Exiting for PM2 restart.`);
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forcedExit.unref();

  const finish = async () => {
    try {
      await closeDatabase();
      clearTimeout(forcedExit);
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  if (server) {
    server.close(finish);
  } else {
    finish();
  }
}

async function start() {
  await connectToDatabase(config.mongoUri);
  await ensureIndexes();

  messageScheduler = startMessageScheduler();

  server = app.listen(config.port, () => {
    console.log(`InsuredMine assessment API listening on port ${config.port}`);
  });

  cpuMonitor = startCpuMonitor({
    threshold: config.cpuThreshold,
    intervalMs: config.cpuCheckIntervalMs,
    onThreshold: (sample) => {
      requestShutdown(`CPU sample ${sample.percent.toFixed(2)}% reached threshold ${sample.threshold}%`);
    }
  });
}

process.on('SIGINT', () => requestShutdown('SIGINT received'));
process.on('SIGTERM', () => requestShutdown('SIGTERM received'));

if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { start, requestShutdown };
