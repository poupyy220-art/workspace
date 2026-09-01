const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');

const toolPath = path.resolve(__dirname, '../modules/attendance-tool/index.html');
const templatePath = path.resolve(process.argv[2] || 'C:/Users/may_chen/Desktop/202608.xlsx');
const outputPath = path.resolve(process.argv[3] || path.join(process.cwd(), 'attendance-v10.3-e2e.xlsx'));
const html = fs.readFileSync(toolPath, 'utf8');
const script = (html.match(/<script>([\s\S]*)<\/script>/) || [])[1];
if (!script) throw new Error('找不到工具主程式');

function extractFunction(name) {
  const asyncStart = script.indexOf('async function ' + name + '(');
  const start = asyncStart >= 0 ? asyncStart : script.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到函式：' + name);
  const brace = script.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < script.length; index++) {
    if (script[index] === '{') depth++;
    if (script[index] === '}') depth--;
    if (depth === 0) return script.slice(start, index + 1);
  }
  throw new Error('函式未結束：' + name);
}

const context = {
  Math,
  Date,
  Set,
  Map,
  LUNCH_START_MINUTES: 720,
  LUNCH_END_MINUTES: 780,
};
vm.createContext(context);
for (const name of [
  'randInt', 'pad2', 'fmt', 'escapeXml', 'decodeXmlEntities', 'resolveRelTarget',
  'getFirstSheetPath', 'getRelTargetByType', 'parseSharedStrings', 'parseStyles',
  'parseThemeColors', 'applyTint', 'isGrayHex', 'isStyleGray', 'matchCell',
  'getCellAttr', 'getCellText', 'columnNumber', 'findNearbyStyle', 'buildInlineCell',
  'setCellInlineStr', 'isWeekendText', 'randomFillTimes', 'randomUniqueFillTimes',
  'isValidTime', 'timeToMinutes', 'minutesToTime', 'calculateLeaveHours',
  'addWorkingHours', 'isHalfHourIncrement', 'isChronologicalPair',
  'applyAttendanceAdjustments',
]) vm.runInContext(extractFunction(name), context);

let checks = 0;
function check(name, condition) {
  if (!condition) throw new Error('FAIL: ' + name);
  checks++;
}

async function scanWorkbook(zip) {
  const sheetPath = await context.getFirstSheetPath(zip);
  const xml = await zip.file(sheetPath).async('string');
  const sharedStrings = await context.parseSharedStrings(zip);
  const stylesFile = zip.file('xl/styles.xml');
  const styles = stylesFile ? context.parseStyles(await stylesFile.async('string')) : { fills: [], xfs: [], themeColors: [] };
  styles.themeColors = await context.parseThemeColors(zip);
  const dateRows = [];
  for (let row = 6; row < 66; row++) {
    const aText = context.getCellText(xml, 'A' + row, sharedStrings);
    if (aText === null || !aText.includes('/')) break;
    const styleAttr = context.getCellAttr(xml, 'B' + row, 's');
    const styleIndex = styleAttr === null ? null : parseInt(styleAttr, 10);
    dateRows.push({
      row,
      aText,
      gray: context.isStyleGray(styles, styleIndex),
      weekend: context.isWeekendText(aText),
      inText: context.getCellText(xml, 'B' + row, sharedStrings) || '',
      outText: context.getCellText(xml, 'C' + row, sharedStrings) || '',
      leaveTexts: ['D', 'E', 'F', 'G'].map(column => context.getCellText(xml, column + row, sharedStrings) || ''),
      remarkText: context.getCellText(xml, 'H' + row, sharedStrings) || '',
    });
  }
  return { sheetPath, xml, dateRows };
}

(async () => {
  check('09:00-18:00 扣午休為 8hr', context.calculateLeaveHours('09:00', '18:00') === 8);
  check('11:00-14:00 扣午休為 2hr', context.calculateLeaveHours('11:00', '14:00') === 2);
  check('12:00-13:00 扣午休為 0hr', context.calculateLeaveHours('12:00', '13:00') === 0);
  check('顛倒請假時間無效', context.calculateLeaveHours('18:00', '09:00') === null);
  check('顛倒上下班無效', !context.isChronologicalPair('18:00', '09:00'));
  check('11:00 加 2 工時得到 14:00', context.addWorkingHours('11:00', 2) === '14:00');

  for (let round = 0; round < 100; round++) {
    const usedIn = new Set();
    const usedOut = new Set();
    for (let day = 0; day < 23; day++) {
      const generated = context.randomUniqueFillTimes(usedIn, usedOut);
      check('上班不重複 ' + round + '-' + day, usedIn.size === day + 1 && usedIn.has(generated.inText));
      check('下班不重複 ' + round + '-' + day, usedOut.size === day + 1 && usedOut.has(generated.outText));
      check('上班範圍 ' + round + '-' + day, /^08:(3[1-9]|[45]\d|5\d)$|^09:(0[1-9]|1\d|2\d)$/.test(generated.inText));
      check('下班範圍 ' + round + '-' + day, /^18:(0[1-9]|1\d|2\d|3[1-9]|[45]\d|5\d)$/.test(generated.outText));
    }
  }

  const originalBytes = fs.readFileSync(templatePath);
  const zip = await JSZip.loadAsync(originalBytes);
  const scanned = await scanWorkbook(zip);
  check('正式範本 31 個日期', scanned.dateRows.length === 31);
  check('原始 D22 確實不存在', !context.matchCell(scanned.xml, 'D22'));

  const adjustments = new Map();
  for (const row of scanned.dateRows.filter(item => !item.gray)) adjustments.set(row.row, { status: 'normal' });
  adjustments.set(8, { status: 'fullLeave', leaveColumn: 'D', otherLeaveName: '', remark: '出國旅遊', hours: 8, leaveStart: '09:00', leaveEnd: '18:00', inTime: '', outTime: '' });
  adjustments.set(9, { status: 'hourLeave', leaveColumn: 'G', otherLeaveName: '出差', remark: '客戶拜訪', hours: 2, leaveStart: '11:00', leaveEnd: '14:00', inTime: '08:30', outTime: '18:00' });
  adjustments.set(22, { status: 'fullLeave', leaveColumn: 'D', otherLeaveName: '', remark: '', hours: 8, leaveStart: '09:00', leaveEnd: '18:00', inTime: '', outTime: '' });

  const applied = context.applyAttendanceAdjustments(scanned.xml, scanned.dateRows, adjustments, null);
  check('D22 已安全建立', Boolean(context.matchCell(applied.sheetXml, 'D22')));
  check('D22 保留鄰近樣式', context.getCellAttr(applied.sheetXml, 'D22', 's') === context.getCellAttr(scanned.xml, 'D21', 's'));
  check('全天假備註寫 H8', context.getCellText(applied.sheetXml, 'H8', []) === '出國旅遊');
  check('備註不混入 D8', !context.getCellText(applied.sheetXml, 'D8', []).includes('備註'));
  check('時數假扣午休後為 2hr', context.getCellText(applied.sheetXml, 'G9', []).includes('11:00~14:00,2hr'));
  check('時數假備註寫 H9', context.getCellText(applied.sheetXml, 'H9', []) === '客戶拜訪');

  zip.file(scanned.sheetPath, applied.sheetXml);
  const outputBytes = await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, outputBytes);

  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.readFile(outputPath);
  const sheet = reopened.getWorksheet('出勤紀錄');
  check('輸出可重新開啟', Boolean(sheet));
  check('重新開啟 D22 正確', sheet.getCell('D22').text === '09:00~18:00,8hr');
  check('重新開啟 H8 正確', sheet.getCell('H8').text === '出國旅遊');
  check('重新開啟 H9 正確', sheet.getCell('H9').text === '客戶拜訪');
  check('日期與 UsedRange 保留', sheet.getCell('A36').text.includes('2026/8/31') && sheet.dimensions.bottom === 42);

  const inTimes = [], outTimes = [];
  for (let row = 6; row <= 36; row++) {
    if (sheet.getCell('B' + row).text) inTimes.push(sheet.getCell('B' + row).text);
    if (sheet.getCell('C' + row).text) outTimes.push(sheet.getCell('C' + row).text);
  }
  check('最終上班時間不重複', new Set(inTimes).size === inTimes.length);
  check('最終下班時間不重複', new Set(outTimes).size === outTimes.length);

  const reopenedZip = await JSZip.loadAsync(fs.readFileSync(outputPath));
  const rescanned = await scanWorkbook(reopenedZip);
  const preserveAdjustments = new Map();
  for (const row of rescanned.dateRows.filter(item => !item.gray)) preserveAdjustments.set(row.row, { status: 'preserve' });
  const preserved = context.applyAttendanceAdjustments(rescanned.xml, rescanned.dateRows, preserveAdjustments, null);
  check('重新處理預設保留不改 XML', preserved.sheetXml === rescanned.xml);
  check('保留筆數正確', preserved.counts.preservedCount === 21);

  console.log('PASS:', checks, 'checks');
  console.log('OUTPUT:', outputPath);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
