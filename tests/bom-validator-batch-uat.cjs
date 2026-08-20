const fs = require('fs');
const path = require('path');
const vm = require('vm');
global.ExcelJS = require('exceljs');
global.JSZip = require('jszip');
global.window = global;
for (const file of ['vendor/opencc-js/cn2t.js', 'bom-rules.js', 'workbook-io.js', 'bom-engine.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'modules', 'bom-validator', ...file.split('/')), 'utf8'), { filename: file });
}

function countCells(ws, predicate) {
  let count = 0;
  ws.eachRow({includeEmpty:false}, row => row.eachCell({includeEmpty:false}, cell => { if (predicate(cell)) count += 1; }));
  return count;
}

function manifest(wb) {
  return wb.worksheets.map(ws => ({
    name: BomWorkbookIO.displayName(ws),
    state: ws.state,
    merges: Object.keys(ws._merges || {}).sort(),
    formulas: countCells(ws, BomRules.isFormulaCell),
    comments: (() => { const cells = []; ws.eachRow({includeEmpty:false}, row => row.eachCell({includeEmpty:false}, cell => { if (cell.note) cells.push(cell.address); })); return cells.sort(); })(),
    images: ws.getImages().length
  }));
}

function residuals(wb, metadata) {
  const out = [];
  for (const meta of metadata.filter(x => !x.excluded)) {
    const ws = wb.getWorksheet(meta.worksheetName || meta.sheetName);
    if (!ws) continue;
    for (const col of [meta.zfColumn, meta.zhColumn, meta.specColumn].filter(Boolean)) {
      for (let row = (meta.headerRow || 0) + 1; row <= ws.rowCount; row += 1) {
        const cell = ws.getCell(row, col);
        if (BomRules.isFormulaCell(cell)) continue;
        const before = BomRules.cellText(cell);
        const after = BomRules.toTraditionalChinese(before);
        if (before && before !== after) out.push({sheet:meta.sheetName,cell:cell.address,before,after});
      }
    }
  }
  return out;
}

async function packageCommentCount(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  let count = 0;
  for (const name of Object.keys(zip.files).filter(n => /^xl\/comments.*\.xml$/.test(n))) {
    const xml = await zip.file(name).async('string');
    count += (xml.match(/<comment\b/g) || []).length;
  }
  return count;
}

async function inspectOne(file) {
  const result = {file:path.basename(file), path:file};
  try {
    const sourceBuffer = fs.readFileSync(file);
    const originalCommentCount = await packageCommentCount(sourceBuffer);
    const wb = await BomWorkbookIO.loadWorkbook(sourceBuffer);
    const before = manifest(wb);
    const engine = BomEngine.processWorkbook(wb);
    const output = Buffer.from(await BomWorkbookIO.writeWorkbook(wb));
    if (process.env.BOM_UAT_SAVE_DIR) fs.writeFileSync(path.join(process.env.BOM_UAT_SAVE_DIR, `${path.basename(file, '.xlsx')}_uat.xlsx`), output);
    const reopened = await BomWorkbookIO.loadWorkbook(output);
    const afterAll = manifest(reopened);
    const after = afterAll.filter(x => x.name !== '【異常檢測報告】');
    const report = reopened.getWorksheet('【異常檢測報告】');
    const structural = {
      names: JSON.stringify(after.map(x => x.name)) === JSON.stringify(before.map(x => x.name)),
      states: JSON.stringify(after.map(x => x.state)) === JSON.stringify(before.map(x => x.state)),
      merges: JSON.stringify(after.map(x => x.merges)) === JSON.stringify(before.map(x => x.merges)),
      formulas: JSON.stringify(after.map(x => x.formulas)) === JSON.stringify(before.map(x => x.formulas)),
      comments: await packageCommentCount(output) === originalCommentCount,
      images: JSON.stringify(after.map(x => x.images)) === JSON.stringify(before.map(x => x.images)),
      reportLast: reopened.worksheets.at(-1)?.name === '【異常檢測報告】',
      reportStyle: !!report && report.autoFilter === 'A9:G9' && report.views[0]?.topLeftCell === 'A10' && ['A9','G9','A10','G10'].every(a => report.getCell(a).border?.top?.style === 'thin')
    };
    const remaining = residuals(reopened, engine.metadata);
    result.status = Object.values(structural).every(Boolean) && remaining.length === 0 ? 'PASS' : 'FAIL';
    result.structural = structural;
    result.residualSimplified = remaining;
    result.counts = {sheets:before.length,items:engine.itemCount,newItems:engine.newCount,blockers:engine.blockerCount,warnings:engine.warningCount};
    result.auditedSheets = engine.metadata.filter(x => !x.excluded).map(x => x.sheetName);
    result.excludedSheets = engine.metadata.filter(x => x.excluded).map(x => x.sheetName);
  } catch (error) {
    result.status = 'UNREADABLE';
    result.error = error.message;
  }
  return result;
}

(async () => {
  const files = process.argv.slice(2);
  const results = [];
  for (const file of files) results.push(await inspectOne(file));
  console.log(JSON.stringify({summary:{total:results.length,pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length,unreadable:results.filter(x=>x.status==='UNREADABLE').length},results}, null, 2));
  if (results.some(x => x.status === 'FAIL')) process.exitCode = 1;
})().catch(error => { console.error(error); process.exit(1); });
