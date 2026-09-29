// 回歸案例：NEW 料的「客戶料號」空白時，異常報告要列 WARNING（客戶料號必填，但不擋交 IT）。
// OLD 料、已填客戶料號、「客戶料號版本」欄、沒有客戶料號欄的分頁都不可誤報。全部使用內建合成資料。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.ExcelJS = require('exceljs');
global.JSZip = require('jszip');
global.window = global;

for (const file of ['vendor/opencc-js/cn2t.js', 'bom-rules.js', 'workbook-io.js', 'bom-engine.js']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'bom-validator', ...file.split('/')), 'utf8');
  vm.runInThisContext(source, { filename: file });
}

function buildSheet(wb, name, headers, rows) {
  const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: 'FF00B050' } } });
  ws.getRow(2).values = headers;
  rows.forEach((values, i) => { ws.getRow(3 + i).values = values; });
  return ws;
}

(async () => {
  const wb = new ExcelJS.Workbook();
  // 欄位：A 狀態、B Level、C 料號、D 英文品名、E 客戶料號、F 客戶料號版本
  buildSheet(wb, 'BOM格式', ['狀態', 'Item Level', '料號', '英文品名', '客戶料號', '客戶料號版本'], [
    ['NEW', 1, 'TESTPN01', 'en1', '', ''],
    ['NEW', 2, 'TESTPN02', 'en2', 'CUST-0002', ''],
    ['OLD', 2, 'TESTPN03', 'en3', '', ''],
    ['NEW', 2, 'TESTPN04', 'en4', '   ', 'A1']
  ]);
  const noCustomer = new ExcelJS.Workbook();
  buildSheet(noCustomer, 'BOM格式', ['狀態', 'Item Level', '料號', '英文品名'], [['NEW', 1, 'TESTPN05', 'en5']]);

  const result = BomEngine.processWorkbook(wb);
  const other = BomEngine.processWorkbook(noCustomer);
  const customerIssues = result.issues.filter(issue => issue.field === '客戶料號');
  const rowsWarned = customerIssues.map(issue => issue.excelRow).sort();

  const assertions = {
    customerColumnDetected: result.metadata.find(item => item.sheetName === 'BOM格式')?.customerPnColumn === 5,
    newBlankWarned: rowsWarned.includes(3),
    whitespaceCountsAsBlank: rowsWarned.includes(6),
    filledNotWarned: !rowsWarned.includes(4),
    oldNotWarned: !rowsWarned.includes(5),
    onlyWarningSeverity: customerIssues.length === 2 && customerIssues.every(issue => issue.severity === 'WARNING'),
    versionColumnIgnored: !result.issues.some(issue => issue.field === '客戶料號版本'),
    noCustomerColumnNoWarning: !other.issues.some(issue => issue.field === '客戶料號')
  };
  console.log(JSON.stringify({ assertions, customerIssues }, null, 2));
  const failed = Object.entries(assertions).filter(([, ok]) => !ok).map(([name]) => name);
  console.log(`${Object.keys(assertions).length - failed.length} PASS / ${failed.length} FAIL${failed.length ? ' → ' + failed.join(', ') : ''}`);
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exit(1); });
