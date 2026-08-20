const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ExcelJS = require('exceljs');
global.ExcelJS = ExcelJS;
global.JSZip = require('jszip');

global.window = global;
for (const file of ['vendor/opencc-js/cn2t.js', 'bom-rules.js', 'workbook-io.js', 'bom-engine.js']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'bom-validator', ...file.split('/')), 'utf8');
  vm.runInThisContext(source, { filename: file });
}

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) throw new Error('Usage: node bom-validator-golden.cjs input.xlsx output.xlsx');

(async () => {
  const workbook = await BomWorkbookIO.loadWorkbook(fs.readFileSync(inputPath));
  const before = {
    sheetNames: workbook.worksheets.map(ws => ws.name),
    bomRequestMerges: Object.keys(workbook.getWorksheet('BOM申請單 ')._merges),
    row2SheetMerges: Object.keys(workbook.getWorksheet('TINY8 P360防尘罩-For NA')._merges),
    formulaS8: workbook.getWorksheet('TINY8 P360防尘罩-For NA').getCell('S8').value
  };
  const result = BomEngine.processWorkbook(workbook);
  fs.writeFileSync(outputPath, Buffer.from(await BomWorkbookIO.writeWorkbook(workbook)));
  const after = {
    sheetNames: workbook.worksheets.map(ws => ws.name),
    bomRequestMerges: Object.keys(workbook.getWorksheet('BOM申請單 ')._merges),
    row2SheetMerges: Object.keys(workbook.getWorksheet('TINY8 P360防尘罩-For NA')._merges),
    formulaS8: workbook.getWorksheet('TINY8 P360防尘罩-For NA').getCell('S8').value,
    metadata: result.metadata.map(m => ({ sheetName: m.sheetName, excluded: m.excluded, headerRow: m.headerRow, pnColumn: m.pnColumn, statusColumn: m.statusColumn, statusDetectionMethod: m.statusDetectionMethod, enColumn:m.enColumn,zfColumn:m.zfColumn,zhColumn:m.zhColumn,viColumn:m.viColumn,specColumn:m.specColumn,levelColumns:m.levelColumns,checkColumns:m.checkColumns })),
    counts: { itemCount: result.itemCount, newCount: result.newCount, blockerCount: result.blockerCount, warningCount: result.warningCount },
    issues: result.issues
  };
  const assertions = {
    bomRequestExcluded: result.metadata.find(m => m.sheetName === 'BOM申請單 ').excluded === true,
    populatedBomFormatIncluded: result.metadata.find(m => m.sheetName === 'BOM格式').excluded === false,
    bomRequestPreserved: JSON.stringify(before.bomRequestMerges) === JSON.stringify(after.bomRequestMerges),
    row2MergesPreserved: JSON.stringify(before.row2SheetMerges) === JSON.stringify(after.row2SheetMerges),
    formulaPreserved: JSON.stringify(before.formulaS8) === JSON.stringify(after.formulaS8),
    row3HeaderDetected: result.metadata.filter(m => m.sheetName.startsWith('Tiny8 ') && !m.excluded).every(m => m.headerRow === 3),
    row2HeaderDetected: result.metadata.filter(m => m.sheetName.startsWith('TINY8 ') && !m.excluded).every(m => m.headerRow === 2),
    codeMappingApplied: workbook.getWorksheet('TINY8 P360防尘罩-For NA').getCell('U3').value === '1',
    nonGreenLegacySheetsExcluded: result.metadata.filter(m => m.sheetName.startsWith('Tiny8 ') && !m.sheetName.startsWith('TINY8 ')).every(m => m.excluded),
    zhTraditionalPreserved: !String(workbook.getWorksheet('TINY8 P360(OEM)防尘罩-For NA ').getCell('R4').value).includes('尘'),
    architectureDifferencesReported: result.blockerCount === 4 && result.warningCount === 3,
    reportCreated: !!workbook.getWorksheet('【異常檢測報告】'),
    outputWritten: fs.existsSync(outputPath)
  };
  console.log(JSON.stringify({ assertions, after }, null, 2));
  if (Object.values(assertions).some(value => !value)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exit(1); });
