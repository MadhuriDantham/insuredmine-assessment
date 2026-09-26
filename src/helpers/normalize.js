function cleanString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function normalizeName(value) {
  return cleanString(value).replace(/\s+/g, ' ').toLowerCase();
}

function normalizeEmail(value) {
  return cleanString(value).toLowerCase();
}

function makeUserIdentityKey(firstname, email, dobText) {
  return [normalizeName(firstname), normalizeEmail(email), cleanString(dobText)].join('|');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  cleanString,
  normalizeName,
  normalizeEmail,
  makeUserIdentityKey,
  escapeRegex
};
