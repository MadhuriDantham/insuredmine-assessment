const IST_OFFSET_MINUTES = 5 * 60 + 30;

function parseScheduledAtIST(day, time, now = new Date()) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { error: 'day must be a valid YYYY-MM-DD date.' };
  }

  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
    return { error: 'time must be a valid 24-hour HH:mm value.' };
  }

  const [yearText, monthText, dayText] = day.split('-');
  const [hourText, minuteText] = time.split(':');
  const year = Number(yearText);
  const month = Number(monthText);
  const dateOfMonth = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  const localMidnight = new Date(Date.UTC(year, month - 1, dateOfMonth));
  if (
    localMidnight.getUTCFullYear() !== year ||
    localMidnight.getUTCMonth() !== month - 1 ||
    localMidnight.getUTCDate() !== dateOfMonth
  ) {
    return { error: 'day is not a real calendar date.' };
  }

  const utcMillis = Date.UTC(year, month - 1, dateOfMonth, hour, minute) - IST_OFFSET_MINUTES * 60 * 1000;
  const scheduledFor = new Date(utcMillis);

  if (scheduledFor <= now) {
    return { error: 'scheduled time must be in the future.' };
  }

  return { scheduledFor };
}

module.exports = {
  IST_OFFSET_MINUTES,
  parseScheduledAtIST
};
