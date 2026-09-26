const express = require('express');
const { ObjectId } = require('mongodb');

const { collection } = require('../db');
const { parseScheduledAtIST } = require('../helpers/scheduleTime');
const { cleanString } = require('../helpers/normalize');

const router = express.Router();

router.post('/schedule', async (req, res, next) => {
  try {
    const message = cleanString(req.body && req.body.message);
    const day = req.body && req.body.day;
    const time = req.body && req.body.time;

    if (!message) {
      return res.status(400).json({ error: 'message is required.' });
    }

    const parsed = parseScheduledAtIST(day, time);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const schedule = {
      _id: new ObjectId(),
      message,
      scheduled_for: parsed.scheduledFor,
      status: 'pending',
      last_error: '',
      created_at: new Date(),
      updated_at: new Date()
    };

    await collection('scheduledMessages').insertOne(schedule);

    return res.status(202).json({
      scheduleId: schedule._id.toString(),
      scheduledFor: schedule.scheduled_for.toISOString(),
      status: schedule.status
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const messages = await collection('messages').find().sort({ inserted_at: 1 }).toArray();
    return res.json({ count: messages.length, messages });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
