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
if (!inputPath || !outputPath) throw new Error('Usage: node bom-validator-new-format.cjs input.xlsx output.xlsx');

(async () => {
  const workbook = await BomWorkbookIO.loadWorkbook(fs.readFileSync(inputPath));
  const worksheet = workbook.getWorksheet('BOM格式');
  const before = {
    merges: Object.keys(worksheet._merges),
    formulaP3: worksheet.getCell('S3').value,
    pnO3: worksheet.getCell('O3').value
  };
  const result = BomEngine.processWorkbook(workbook);
  await fs.promises.writeFile(outputPath, Buffer.from(await BomWorkbookIO.writeWorkbook(workbook)));
  const metadata = result.metadata.find(item => item.sheetName === 'BOM格式');
  const assertions = {
    bomFormatIncluded: metadata && metadata.excluded === false && metadata.role === 'bom',
    headerDetected: metadata && metadata.headerRow === 2,
    columnsDetected: metadata && metadata.pnColumn === 15 && metadata.statusColumn === 14 && metadata.enColumn === 16 && metadata.zfColumn === 17 && metadata.zhColumn === 18 && metadata.viColumn === 19 && metadata.specColumn === 20,
    dataProcessed: result.itemCount >= 2,
    firstLevelRuleReported: result.issues.some(issue => issue.sheet === 'BOM格式' && issue.excelRow === 3 && issue.field === 'Item Level (階層)' && issue.currentValue === 'Level 2'),
    firstLevelCellMarked: worksheet.getCell('D3').fill?.fgColor?.argb === 'FFC7CE',
    lookupSheetsExcluded: ['Class code', 'Basic Name'].every(name => result.metadata.find(item => item.sheetName === name)?.excluded === true),
    originalMergesPreserved: JSON.stringify(before.merges) === JSON.stringify(Object.keys(worksheet._merges)),
    formulaPreserved: JSON.stringify(before.formulaP3) === JSON.stringify(worksheet.getCell('S3').value),
    pnPreserved: before.pnO3 === worksheet.getCell('O3').value,
    reportCreated: !!workbook.getWorksheet('【異常檢測報告】'),
    outputWritten: fs.existsSync(outputPath)
  };
  console.log(JSON.stringify({ assertions, levelCellFill: worksheet.getCell('D3').fill, metadata, counts: { itemCount: result.itemCount, newCount: result.newCount, blockerCount: result.blockerCount, warningCount: result.warningCount } }, null, 2));
  if (Object.values(assertions).some(value => !value)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exit(1); });
