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
if (!inputPath || !outputPath) throw new Error('Usage: node bom-validator-web-uat-260805.cjs input.xlsx output.xlsx');
(async () => {
  const source = fs.readFileSync(inputPath);
  const workbook = await BomWorkbookIO.loadWorkbook(source);
  const result = BomEngine.processWorkbook(workbook);
  const output = Buffer.from(await BomWorkbookIO.writeWorkbook(workbook));
  fs.writeFileSync(outputPath, output);
  const reopened = await BomWorkbookIO.loadWorkbook(output);
  const metadata = result.metadata;
  const assertions = {
    uncoloredWorksheetExcluded: metadata.find(x => x.sheetName === '工作表1')?.excluded === true,
    greenEtStillAudited: metadata.find(x => x.sheetName === 'ET')?.excluded === false,
    bomFormatIncluded: metadata.find(x => x.sheetName === 'BOM格式')?.excluded === false,
    levelOnlyTemplateRowNotNew: reopened.getWorksheet('BOM格式').getCell('N4').value === null,
    completeOpenCcConversion: reopened.getWorksheet('M90aProG7_SKU1').getCell('T31').value === 'ADC12 壓鑄\n(鈍化處理)',
    residualExampleConverted: BomRules.toTraditionalChinese('摄像头挡板') === '攝像頭擋板',
    definedNamesPreserved: reopened._bomDefinedNamesXml.includes('Excel_BuiltIn_Database') && reopened._bomDefinedNamesXml.includes('P310含前置風扇') && reopened._bomDefinedNamesXml.includes('tooling'),
    imagesPreserved: reopened.getWorksheet('Basic Name').getImages().length === 1 && reopened.getWorksheet('分群碼&來源碼填寫規則').getImages().length === 1,
    reportCreatedLast: reopened.worksheets.at(-1).name === '【異常檢測報告】'
  };
  assertions.pythonIssueCountsMatched = result.blockerCount === 3 && result.warningCount === 7;
  console.log(JSON.stringify({ assertions, counts: { blockerCount: result.blockerCount, warningCount: result.warningCount } }, null, 2));
  if (Object.values(assertions).some(value => !value)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exit(1); });
