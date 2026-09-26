const config = require('../config');

function calculateCpuPercent(previousSample, currentSample) {
  const cpuMicros =
    currentSample.cpu.user -
    previousSample.cpu.user +
    currentSample.cpu.system -
    previousSample.cpu.system;
  const elapsedMicros = Number(currentSample.time - previousSample.time) / 1000;

  if (elapsedMicros <= 0) {
    return 0;
  }

  // process.cpuUsage is CPU microseconds. Dividing by monotonic elapsed time gives
  // one-core process CPU percent, so multiple active threads can exceed 100%.
  return (cpuMicros / elapsedMicros) * 100;
}

function takeSample() {
  return {
    cpu: process.cpuUsage(),
    time: process.hrtime.bigint()
  };
}

function startCpuMonitor(options = {}) {
  const threshold = options.threshold ?? config.cpuThreshold;
  const intervalMs = options.intervalMs ?? config.cpuCheckIntervalMs;
  const logger = options.logger || console;
  const onThreshold = options.onThreshold || (() => {});
  let previousSample = options.initialSample || takeSample();
  let thresholdAlreadyHit = false;

  const timer = setInterval(() => {
    const currentSample = takeSample();
    const percent = calculateCpuPercent(previousSample, currentSample);
    previousSample = currentSample;

    const sample = { percent, threshold, intervalMs };
    logger.log(`CPU sample: ${percent.toFixed(2)}% of one logical core (threshold ${threshold}%).`);

    if (!thresholdAlreadyHit && percent >= threshold) {
      thresholdAlreadyHit = true;
      logger.warn(`CPU threshold reached. Exiting under PM2 supervision: ${percent.toFixed(2)}% >= ${threshold}%.`);
      onThreshold(sample);
    }
  }, intervalMs);

  return {
    stop() {
      clearInterval(timer);
    }
  };
}

module.exports = {
  calculateCpuPercent,
  startCpuMonitor
};
