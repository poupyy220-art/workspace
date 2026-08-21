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

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) throw new Error('Usage: node bom-validator-code-mapping-regression.cjs input.xlsx output.xlsx');

(async () => {
  const workbook = await BomWorkbookIO.loadWorkbook(fs.readFileSync(inputPath));
  const worksheet = workbook.getWorksheet('BOM格式');
  if (!worksheet) throw new Error('找不到 BOM格式 分頁');

  BomEngine.processWorkbook(workbook);
  await fs.promises.writeFile(outputPath, Buffer.from(await BomWorkbookIO.writeWorkbook(workbook)));

  const assertions = {
    descriptionOnlyRule: BomRules.convertCode('成品階') === '1',
    fullwidthColonRule: BomRules.convertCode('M：自製') === 'M',
    missingColonRule: BomRules.convertCode('3材料階') === '3',
    invalidPrefixPreserved: BomRules.convertCode('ABC:一般') === 'ABC:一般',
    unknownDescriptionPreserved: BomRules.convertCode('M:未知說明') === 'M:未知說明',
    pureDescriptionMapped: worksheet.getCell('U27').value === '1',
    fullwidthColonMapped: worksheet.getCell('V27').value === 'M',
    rowAfterBlankMapped: worksheet.getCell('U30').value === '3',
    trailingRowsMapped: ['U31', 'U32', 'U33', 'U34'].every(address => worksheet.getCell(address).value === '3'),
    trailingSourceMapped: ['V31', 'V32', 'V33', 'V34'].every(address => worksheet.getCell(address).value === 'X'),
    trailingUnitMapped: ['Z30', 'Z31', 'Z32', 'Z33', 'Z34'].every(address => worksheet.getCell(address).value === 'PCS'),
    trailingPropertyMapped: ['AA30', 'AA31', 'AA32', 'AA33', 'AA34'].every(address => worksheet.getCell(address).value === 'GE'),
    reportCreated: !!workbook.getWorksheet('【異常檢測報告】'),
    outputWritten: fs.existsSync(outputPath)
  };

  console.log(JSON.stringify({ assertions }, null, 2));
  if (Object.values(assertions).some(value => !value)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exit(1); });
