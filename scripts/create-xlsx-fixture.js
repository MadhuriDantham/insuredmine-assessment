const path = require('node:path');
const ExcelJS = require('exceljs');

const headers = [
  'agent',
  'userType',
  'policy_mode',
  'producer',
  'policy_number',
  'premium_amount_written',
  'premium_amount',
  'policy_type',
  'company_name',
  'category_name',
  'policy_start_date',
  'policy_end_date',
  'csr',
  'account_name',
  'email',
  'gender',
  'firstname',
  'city',
  'account_type',
  'phone',
  'address',
  'state',
  'zip',
  'dob',
  'primary',
  'Applicant ID',
  'agency_id',
  'hasActive ClientPolicy'
];

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Policies');

  sheet.addRow(headers);
  sheet.addRow([
    'Agent Three',
    'Active Client',
    '12',
    'Fictional Producer',
    'XLSX-004',
    '',
    '150.25',
    'Single',
    'Carrier C',
    'Commercial Auto',
    new Date(2026, 3, 1),
    new Date(2027, 3, 1),
    'Fictional CSR',
    'Excel Account',
    'excel@example.test',
    '',
    'Excel Example',
    'Sample City',
    'Commercial',
    '000-555-0104',
    '',
    'NC',
    '00045',
    new Date(1995, 4, 6),
    '',
    '',
    '',
    ''
  ]);

  sheet.getColumn(11).numFmt = 'yyyy-mm-dd';
  sheet.getColumn(12).numFmt = 'yyyy-mm-dd';
  sheet.getColumn(24).numFmt = 'yyyy-mm-dd';

  const outputPath = path.join(__dirname, '..', 'fixtures', 'fictional-policies.xlsx');
  await workbook.xlsx.writeFile(outputPath);
  console.log(`Wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
