const fs = require('fs');
const path = require('path');
const vm = require('vm');
global.ExcelJS = require('exceljs');
global.JSZip = require('jszip');
global.window = global;
for (const file of ['vendor/opencc-js/cn2t.js', 'bom-rules.js', 'workbook-io.js', 'bom-engine.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'modules', 'bom-validator', ...file.split('/')), 'utf8'), { filename: file });
}
const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) throw new Error('Usage: node bom-validator-m90apro-regression.cjs input.xlsx output.xlsx');
(async () => {
  const workbook = await BomWorkbookIO.loadWorkbook(fs.readFileSync(inputPath));
  const sheetName = 'M90aProG7_SDV_GPU_QHD_NT_SKU1';
  const worksheet = workbook.getWorksheet(sheetName);
  const before = { q38: BomRules.cellText(worksheet.getCell('Q38')), q39: BomRules.cellText(worksheet.getCell('Q39')), t38: BomRules.cellText(worksheet.getCell('T38')), t39: BomRules.cellText(worksheet.getCell('T39')) };
  const result = BomEngine.processWorkbook(workbook);
  const metadata = result.metadata.find(item => item.sheetName === sheetName);
  const output = Buffer.from(await BomWorkbookIO.writeWorkbook(workbook));
  fs.writeFileSync(outputPath, output);
  const relatedIssues = result.issues.filter(issue => issue.sheet === sheetName && [38, 39].includes(issue.excelRow));
  const after = { q38: BomRules.cellText(worksheet.getCell('Q38')), q39: BomRules.cellText(worksheet.getCell('Q39')), t38: BomRules.cellText(worksheet.getCell('T38')), t39: BomRules.cellText(worksheet.getCell('T39')) };
  const expected = { q38: '背包後蓋', q39: '背包上擋牆' };
  const specBlockers = relatedIssues.filter(issue => issue.field.includes('規格') && issue.severity === 'BLOCKER' && issue.reason.includes('超過30'));
  const failures = [];
  if (after.q38 !== expected.q38) failures.push(`Q38 預期 ${expected.q38}，實際 ${after.q38}`);
  if (after.q39 !== expected.q39) failures.push(`Q39 預期 ${expected.q39}，實際 ${after.q39}`);
  if (BomRules.toTraditionalChinese('ADC12 压铸 (钝化处理)') !== 'ADC12 壓鑄 (鈍化處理)') failures.push('OpenCC 完整簡轉繁未生效');
  if (!specBlockers.some(issue => issue.excelRow === 38)) failures.push('T38 未產生超過30字 BLOCKER');
  if (!specBlockers.some(issue => issue.excelRow === 39)) failures.push('T39 未產生超過30字 BLOCKER');
  console.log(JSON.stringify({ before, after, metadata, relatedIssues, counts: { itemCount: result.itemCount, newCount: result.newCount, blockerCount: result.blockerCount, warningCount: result.warningCount }, regression: failures.length ? 'FAIL' : 'PASS', failures }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exit(1); });
