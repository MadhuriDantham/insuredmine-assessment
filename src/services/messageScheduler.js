const { collection } = require('../db');

let schedulerTimer;
let polling = false;

async function processDueMessages(now = new Date()) {
  if (polling) {
    return { skipped: true, processed: 0 };
  }

  polling = true;
  let processed = 0;

  try {
    const dueSchedules = await collection('scheduledMessages')
      .find({
        status: 'pending',
        scheduled_for: { $lte: now }
      })
      .sort({ scheduled_for: 1 })
      .limit(50)
      .toArray();

    for (const schedule of dueSchedules) {
      try {
        await collection('messages').updateOne(
          { _id: schedule._id },
          {
            $setOnInsert: {
              _id: schedule._id,
              message: schedule.message,
              scheduled_for: schedule.scheduled_for,
              inserted_at: new Date(),
              created_at: new Date()
            }
          },
          { upsert: true }
        );

        await collection('scheduledMessages').updateOne(
          { _id: schedule._id, status: 'pending' },
          {
            $set: {
              status: 'completed',
              completed_at: new Date(),
              updated_at: new Date()
            },
            $unset: {
              last_error: ''
            }
          }
        );
        processed += 1;
      } catch (err) {
        console.error(`Message delivery failed for schedule ${schedule._id}:`, err);
        await collection('scheduledMessages').updateOne(
          { _id: schedule._id, status: 'pending' },
          { $set: { last_error: err.message, updated_at: new Date() } }
        ).catch((updateErr) => {
          console.error('Unable to store message delivery error:', updateErr);
        });
      }
    }
  } catch (err) {
    console.error('Scheduled message polling failed:', err);
  } finally {
    polling = false;
  }

  return { skipped: false, processed };
}

function startMessageScheduler(intervalMs = 1000) {
  processDueMessages().catch((err) => {
    console.error('Startup scheduled message poll failed:', err);
  });

  schedulerTimer = setInterval(() => {
    processDueMessages().catch((err) => {
      console.error('Scheduled message poll failed:', err);
    });
  }, intervalMs);

  return {
    stop() {
      clearInterval(schedulerTimer);
    }
  };
}

module.exports = {
  processDueMessages,
  startMessageScheduler
};
