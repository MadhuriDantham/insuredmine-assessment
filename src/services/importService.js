const fs = require('node:fs/promises');
const { parse } = require('csv-parse/sync');
const ExcelJS = require('exceljs');

const { collection, ensureIndexes } = require('../db');
const { cleanString, normalizeName, normalizeEmail, makeUserIdentityKey } = require('../helpers/normalize');
const { formatDateOnly, formatLocalDateOnly, parseDateOnly } = require('../helpers/dateUtils');

const REQUIRED_HEADERS = [
  'agent',
  'policy_number',
  'company_name',
  'category_name',
  'policy_start_date',
  'policy_end_date',
  'account_name',
  'email',
  'firstname',
  'dob'
];

function assertRequiredHeaders(headers) {
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    const err = new Error(`Missing required headers: ${missing.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }
}

async function parseCsvFile(filePath) {
  let headers = [];
  const content = await fs.readFile(filePath, 'utf8');

  try {
    const rows = parse(content, {
      bom: true,
      columns: (rawHeaders) => {
        headers = rawHeaders.map(cleanString);
        return headers;
      },
      skip_empty_lines: true,
      relax_column_count: true
    });

    assertRequiredHeaders(headers);
    return rows.map((row, index) => ({ row, rowNumber: index + 2 }));
  } catch (err) {
    if (!err.statusCode) {
      err.publicMessage = `Unable to read CSV file: ${err.message}`;
      err.statusCode = 400;
    }
    throw err;
  }
}

function cellToString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return formatLocalDateOnly(value);
  }
  if (typeof value === 'object') {
    if (value.text) {
      return cleanString(value.text);
    }
    if (value.richText) {
      return value.richText.map((part) => part.text || '').join('');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'result')) {
      return cellToString(value.result);
    }
    if (value.hyperlink && value.text) {
      return cleanString(value.text);
    }
  }
  return cleanString(value);
}

async function parseXlsxFile(filePath) {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.readFile(filePath);
  } catch (err) {
    err.publicMessage = `Unable to read XLSX file: ${err.message}`;
    err.statusCode = 400;
    throw err;
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    const err = new Error('XLSX file does not contain a worksheet.');
    err.statusCode = 400;
    throw err;
  }

  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cleanString(cell.value);
  });

  assertRequiredHeaders(headers);

  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const worksheetRow = worksheet.getRow(rowNumber);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cellToString(worksheetRow.getCell(index + 1).value);
    });

    const hasAnyValue = Object.values(row).some((value) => cleanString(value) !== '');
    if (hasAnyValue) {
      rows.push({ row, rowNumber });
    }
  }

  return rows;
}

function validateRow(row) {
  const data = {
    agentName: cleanString(row.agent),
    policyNumber: cleanString(row.policy_number),
    companyName: cleanString(row.company_name),
    categoryName: cleanString(row.category_name),
    accountName: cleanString(row.account_name),
    email: cleanString(row.email),
    firstname: cleanString(row.firstname),
    gender: cleanString(row.gender),
    address: cleanString(row.address),
    phone: cleanString(row.phone),
    state: cleanString(row.state),
    zip: cleanString(row.zip),
    userType: cleanString(row.userType)
  };

  const errors = [];
  [
    ['agent', data.agentName],
    ['policy_number', data.policyNumber],
    ['company_name', data.companyName],
    ['category_name', data.categoryName],
    ['account_name', data.accountName],
    ['email', data.email],
    ['firstname', data.firstname]
  ].forEach(([field, value]) => {
    if (!value) {
      errors.push(`${field} is required`);
    }
  });

  const dob = parseDateOnly(row.dob);
  const policyStartDate = parseDateOnly(row.policy_start_date);
  const policyEndDate = parseDateOnly(row.policy_end_date);

  if (!dob) {
    errors.push('dob must be YYYY-MM-DD');
  }
  if (!policyStartDate) {
    errors.push('policy_start_date must be YYYY-MM-DD');
  }
  if (!policyEndDate) {
    errors.push('policy_end_date must be YYYY-MM-DD');
  }
  if (policyStartDate && policyEndDate && policyEndDate < policyStartDate) {
    errors.push('policy_end_date cannot be before policy_start_date');
  }

  if (errors.length > 0) {
    return { errors };
  }

  const dobText = formatDateOnly(dob);
  return {
    data: {
      ...data,
      dob,
      dobText,
      policyStartDate,
      policyEndDate,
      normalizedAgentName: normalizeName(data.agentName),
      normalizedCompanyName: normalizeName(data.companyName),
      normalizedCategoryName: normalizeName(data.categoryName),
      normalizedAccountName: normalizeName(data.accountName),
      normalizedFirstname: normalizeName(data.firstname),
      normalizedEmail: normalizeEmail(data.email),
      identityKey: makeUserIdentityKey(data.firstname, data.email, dobText)
    }
  };
}

async function upsertLookupRecord(collectionName, query, insertValues) {
  const now = new Date();
  const valuesToInsert = Object.assign({}, insertValues, {
    created_at: now
  });

  return collection(collectionName).findOneAndUpdate(
    query,
    {
      $setOnInsert: valuesToInsert,
      $set: {
        updated_at: now
      }
    },
    { upsert: true, returnDocument: 'after' }
  );
}

async function importValidatedRow(data) {
  const agent = await upsertLookupRecord(
    'agents',
    { normalized_name: data.normalizedAgentName },
    { agent_name: data.agentName, normalized_name: data.normalizedAgentName }
  );

  const lob = await upsertLookupRecord(
    'lobs',
    { normalized_name: data.normalizedCategoryName },
    { category_name: data.categoryName, normalized_name: data.normalizedCategoryName }
  );

  const carrier = await upsertLookupRecord(
    'carriers',
    { normalized_name: data.normalizedCompanyName },
    { company_name: data.companyName, normalized_name: data.normalizedCompanyName }
  );

  const now = new Date();
  const user = await collection('users').findOneAndUpdate(
    { identity_key: data.identityKey },
    {
      $set: {
        firstname: data.firstname,
        dob: data.dob,
        address: data.address,
        phone: data.phone,
        state: data.state,
        zip: data.zip,
        email: data.email,
        gender: data.gender,
        userType: data.userType,
        normalized_firstname: data.normalizedFirstname,
        normalized_email: data.normalizedEmail,
        updated_at: now
      },
      $setOnInsert: {
        identity_key: data.identityKey,
        created_at: now
      }
    },
    { upsert: true, returnDocument: 'after' }
  );

  const account = await collection('userAccounts').findOneAndUpdate(
    { user_id: user._id, normalized_account_name: data.normalizedAccountName },
    {
      $set: {
        account_name: data.accountName,
        updated_at: now
      },
      $setOnInsert: {
        user_id: user._id,
        normalized_account_name: data.normalizedAccountName,
        created_at: now
      }
    },
    { upsert: true, returnDocument: 'after' }
  );

  const policyResult = await collection('policies').updateOne(
    { policy_number: data.policyNumber },
    {
      $set: {
        policy_number: data.policyNumber,
        policy_start_date: data.policyStartDate,
        policy_end_date: data.policyEndDate,
        category_id: lob._id,
        company_id: carrier._id,
        user_id: user._id,
        agent_id: agent._id,
        account_id: account._id,
        updated_at: now
      },
      $setOnInsert: {
        created_at: now
      }
    },
    { upsert: true }
  );

  return policyResult.upsertedCount > 0 ? 'inserted' : 'existingOrUpdated';
}

async function importFile({ filePath, fileType }) {
  await ensureIndexes();

  const parsedRows = fileType === 'xlsx' ? await parseXlsxFile(filePath) : await parseCsvFile(filePath);
  const result = {
    success: true,
    processed: parsedRows.length,
    inserted: 0,
    existingOrUpdated: 0,
    rejected: 0,
    rejectedRows: []
  };

  for (const { row, rowNumber } of parsedRows) {
    const validation = validateRow(row);
    if (validation.errors) {
      result.rejected += 1;
      result.rejectedRows.push({ rowNumber, reasons: validation.errors });
      continue;
    }

    try {
      const writeResult = await importValidatedRow(validation.data);
      result[writeResult] += 1;
    } catch (err) {
      result.rejected += 1;
      result.rejectedRows.push({
        rowNumber,
        reasons: [`database write failed: ${err.message}`]
      });
    }
  }

  if (result.rejected > 0) {
    result.success = false;
    result.message = 'Import completed with rejected rows.';
  } else {
    result.message = 'Import completed successfully.';
  }

  return result;
}

module.exports = {
  REQUIRED_HEADERS,
  assertRequiredHeaders,
  importFile,
  parseCsvFile,
  parseXlsxFile,
  validateRow
};
