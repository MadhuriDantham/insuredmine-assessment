const express = require('express');

const uploadRoutes = require('./routes/uploadRoutes');
const policyRoutes = require('./routes/policyRoutes');
const messageRoutes = require('./routes/messageRoutes');

const app = express();

app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({
    status: app.locals.shuttingDown ? 'shutting_down' : 'ok',
    uptimeSeconds: Math.round(process.uptime())
  });
});

app.use((req, res, next) => {
  if (app.locals.shuttingDown) {
    return res.status(503).json({ error: 'Server is shutting down and is not accepting new work.' });
  }
  return next();
});

app.use('/api/upload', uploadRoutes);
app.use('/api/policies', policyRoutes);
app.use('/api/messages', messageRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  console.error(err);
  return res.status(err.statusCode || 500).json({
    error: err.publicMessage || 'Unexpected server error.'
  });
});

module.exports = app;
