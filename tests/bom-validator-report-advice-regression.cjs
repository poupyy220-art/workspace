// 回歸案例：異常檢測報告新增「建議處理方式」（H 欄）與第 9 列摘要；簡繁對照補「拨杆／撥杆→撥桿」。
// 報告表頭仍在第 10 列、篩選範圍延伸到 H 欄；寫出後以獨立解析器（JSZip 讀 XML）重開核對。全部使用內建合成資料。
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
  // 欄位：A 狀態、B Item Level、C 料號、D 英文品名、E 繁中品名、F 規格、G 客戶料號
  buildSheet(wb, 'BOM格式', ['狀態', 'Item Level', '料號', '英文品名', '繁中品名', '規格', '客戶料號'], [
    ['NEW', 1, 'TESTPN01', 'TEST PART', '攝像頭拨杆', 'SPEC', 'CUST-1'],                       // 拨杆 → 撥桿
    ['NEW', 3, 'TESTPN02', 'TEST PART B', '測試零件', 'SPEC', 'CUST-2'],                        // 1→3 跳階
    ['NEW', 2, 'TESTPN03', 'THIS ENGLISH NAME IS DEFINITELY LONGER THAN THIRTY', '撥杆', 'SPEC', '']  // 長度、撥杆、客戶料號空白
  ]);
  const clean = new ExcelJS.Workbook();
  buildSheet(clean, 'BOM格式', ['狀態', 'Item Level', '料號', '英文品名', '繁中品名', '規格', '客戶料號'], [['NEW', 1, 'TESTPN09', 'OK PART', '零件', 'SPEC', 'CUST-9']]);

  const result = BomEngine.processWorkbook(wb);
  const cleanResult = BomEngine.processWorkbook(clean);
  const sheet = wb.getWorksheet('BOM格式');
  const report = wb.getWorksheet('【異常檢測報告】');
  const cleanReport = clean.getWorksheet('【異常檢測報告】');
  const text = cell => String(cell.value ?? '');

  const detailRows = [];
  for (let row = 11; row <= report.rowCount; row += 1) detailRows.push({ field: text(report.getCell(row, 3)), severity: text(report.getCell(row, 4)), advice: text(report.getCell(row, 8)) });
  const blockers = result.issues.filter(x => x.severity === 'BLOCKER').length, warnings = result.issues.filter(x => x.severity === 'WARNING').length;

  // 以獨立解析器重開：寫出 xlsx 後用 JSZip 讀報告頁 XML，確認 H10 表頭、篩選範圍與合併儲存格
  const buffer = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const rid = (wbXml.match(/<sheet [^>]*name="【異常檢測報告】"[^>]*r:id="(rId\d+)"/) || [])[1];
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const target = (rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`)) || [])[1];
  const reportXml = target ? await zip.file('xl/' + target.replace(/^\/?xl\//, '')).async('string') : '';

  const assertions = {
    simplifiedBoGanConverted: text(sheet.getCell(3, 5)) === '攝像頭撥桿',
    traditionalVariantConverted: text(sheet.getCell(5, 5)) === '撥桿',
    headerStillRow10: text(report.getCell(10, 1)) === '分頁名稱' && text(report.getCell(10, 8)) === '建議處理方式',
    everyDetailHasAdvice: detailRows.length === result.issues.length && detailRows.every(r => r.advice.length > 5),
    levelAdvice: detailRows.some(r => /階層/.test(r.field) && /Level 1/.test(r.advice)),
    lengthAdvice: detailRows.some(r => /30 字元/.test(r.advice)),
    customerPnAdvice: detailRows.some(r => r.field === '客戶料號' && /必填/.test(r.advice) && /不擋交 IT/.test(r.advice)),
    summaryCounts: text(report.getCell(9, 1)).includes(`BLOCKER ${blockers} 筆`) && text(report.getCell(9, 1)).includes(`WARNING ${warnings} 筆`) && text(report.getCell(9, 1)).includes('BOM格式'),
    cleanSummaryAndPass: /全表無卡關問題/.test(text(cleanReport.getCell(9, 1))) && text(cleanReport.getCell(11, 4)) === 'PASS' && text(cleanReport.getCell(11, 8)) === '-' && cleanResult.blockerCount === 0,
    reopenHeaderH10: /<c r="H10"[^>]*t="s"|<c r="H10"[^>]*>/.test(reportXml),
    reopenAutoFilterToH: /<autoFilter ref="A10:H\d*"/.test(reportXml) || /<autoFilter ref="A10:H10"/.test(reportXml),
    reopenSummaryMerged: /<mergeCell ref="A9:H9"\/>/.test(reportXml) && /<mergeCell ref="A7:H7"\/>/.test(reportXml)
  };
  console.log(JSON.stringify({ assertions, blockers, warnings, detailCount: detailRows.length }, null, 2));
  const failed = Object.entries(assertions).filter(([, ok]) => !ok).map(([name]) => name);
  console.log(`${Object.keys(assertions).length - failed.length} PASS / ${failed.length} FAIL${failed.length ? ' → ' + failed.join(', ') : ''}`);
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exit(1); });
