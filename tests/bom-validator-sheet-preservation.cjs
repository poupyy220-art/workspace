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
if (!inputPath || !outputPath) throw new Error('Usage: node bom-validator-sheet-preservation.cjs input.xlsx output.xlsx');
(async () => {
  const originalBuffer = fs.readFileSync(inputPath);
  const workbook = await BomWorkbookIO.loadWorkbook(originalBuffer);
  const loadedNames = workbook.worksheets.map(BomWorkbookIO.displayName);
  const result = BomEngine.processWorkbook(workbook);
  const outputBuffer = Buffer.from(await BomWorkbookIO.writeWorkbook(workbook));
  fs.writeFileSync(outputPath, outputBuffer);
  const reopened = await BomWorkbookIO.loadWorkbook(outputBuffer);
  const outputNames = reopened.worksheets.map(BomWorkbookIO.displayName);
  const report = reopened.getWorksheet('【異常檢測報告】');
  const expectedNames = [...loadedNames, '【異常檢測報告】'];
  const assertions = {
    allInputSheetsLoaded: loadedNames.length === 10,
    allSheetsPreserved: JSON.stringify(outputNames) === JSON.stringify(expectedNames),
    targetSheetsPresent: ['170W电源适配器單出 （加州）', '170W电源适配器單出', '分群碼&來源碼填寫規則'].every(name => outputNames.includes(name)),
    reportCreated: outputNames.includes('【異常檢測報告】'),
    reportGridLinesVisible: report.views[0]?.showGridLines !== false,
    legendBordersComplete: ['A3', 'F3', 'A4', 'F4', 'A5', 'F5'].every(address => report.getCell(address).border?.top?.style === 'thin'),
    issueTableBordersComplete: ['A9', 'G9', 'A10', 'G10'].every(address => report.getCell(address).border?.top?.style === 'thin')
  };
  console.log(JSON.stringify({ assertions, loadedNames, outputNames, counts: { itemCount: result.itemCount, blockerCount: result.blockerCount, warningCount: result.warningCount } }, null, 2));
  if (Object.values(assertions).some(value => !value)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exit(1); });
