const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const express = require('express');
const multer = require('multer');

const config = require('../config');

const router = express.Router();
let importBusy = false;

fs.mkdirSync(config.uploadDir, { recursive: true });

const upload = multer({
  dest: config.uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv' && ext !== '.xlsx') {
      return cb(new Error('Unsupported file type. Upload a .csv or .xlsx file.'));
    }
    return cb(null, true);
  }
});

function fileTypeFromName(fileName) {
  return path.extname(fileName).toLowerCase() === '.xlsx' ? 'xlsx' : 'csv';
}

function removeUploadedFile(filePath) {
  if (!filePath) {
    return Promise.resolve();
  }
  return fs.promises.rm(filePath, { force: true }).catch((err) => {
    console.error(`Unable to remove upload ${filePath}:`, err.message);
  });
}

function runImportWorker(file) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, '..', 'workers', 'importWorker.js');
    const worker = new Worker(workerPath, {
      workerData: {
        filePath: file.path,
        fileType: fileTypeFromName(file.originalname),
        mongoUri: config.mongoUri
      }
    });

    let settled = false;

    function settle(callback, value) {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
    }

    worker.once('message', (message) => {
      if (message.ok) {
        settle(resolve, message.result);
      } else {
        const err = new Error(message.error.message);
        err.statusCode = message.error.statusCode;
        settle(reject, err);
      }
    });

    worker.once('error', (err) => {
      settle(reject, err);
    });

    worker.once('exit', (code) => {
      if (code !== 0) {
        const err = new Error(`Import worker exited unexpectedly with code ${code}.`);
        err.statusCode = 500;
        settle(reject, err);
      }
    });
  });
}

router.post('/', (req, res) => {
  if (importBusy) {
    return res.status(409).json({ error: 'Another import is already running. Please try again later.' });
  }

  importBusy = true;

  return upload.single('file')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        const status = uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ error: uploadErr.message });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Missing file field named file.' });
      }

      const result = await runImportWorker(req.file);
      const status = result.rejected > 0 ? 207 : 200;
      return res.status(status).json(result);
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
      importBusy = false;
      await removeUploadedFile(req.file && req.file.path);
    }
  });
});

module.exports = router;
