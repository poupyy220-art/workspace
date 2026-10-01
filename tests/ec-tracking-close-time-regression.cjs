const vm = require('node:vm');
const assert = require('node:assert/strict');
const { context, extract } = require('./ec-tracking-pn-map-regression.cjs');

// 2026-10-01 確認（F022）：「(GETC/ECR Close 時間)」Change Type＝New 的列填產表當天日期，
// 但要等公司自動建 BOM 流程完成、確認建立成功才能貼主表 → 該格標黃、_自動判斷備註 提醒；
// 備註為「…EC直接close」的列（ChgDate／ChgDes／Chgrcd／No BOM change）也填當天，不標黃；其他列維持空白。
function run() {
  let checks = 0;
  const check = (v, msg) => { assert(v, msg); checks++; };
  const { ctx } = context(async () => []);
  const build = (rows) => ctx.buildStagingRows8(rows, new Map(), new Map([['13AA', 'Test Project']]), new Map(), new Map(), 'TEST', new Map(), new Map());
  const row = (ec, mtm, ct, disp = '19', child = '') => ({ 'Lenovo EC/Doc Number': ec, 'MTM/Part': mtm, 'Child Part': child, 'Change Type': ct, 'disposition': disp, 'LastModified': '2026-09-28' });
  const COL = '(GETC/ECR Close 時間)';
  const note = r => r['_自動判斷備註'];
  const isToday = v => v instanceof Date && v.getTime() === ctx.todayDateValue8().getTime();

  const [nw] = build([row('200008976212', '13AATEST', 'New')]);
  check(isToday(nw[COL]), 'New → today: ' + nw[COL]);
  check(note(nw).includes('自動建 BOM'), 'New reminder: ' + note(nw));
  const [date] = build([row('200008976212', '13AATEST', 'ChgDate')]);
  check(isToday(date[COL]) && !note(date).includes('自動建 BOM'), 'ChgDate → today, no reminder');
  const [des] = build([row('200008976212', '13AATEST', 'ChgDes')]);
  check(isToday(des[COL]), 'ChgDes → today');
  const [rcd] = build([row('200008976212', '13AATEST', 'Chgrcd')]);
  check(isToday(rcd[COL]), 'Chgrcd → today');
  const cto = build([row('CTO_1', '13AATEST', ''), row('CTO_1', '13AATEST', '', '22', 'TESTCHILD')]);
  check(cto[0]['備註'] === 'No BOM change,EC直接close' && isToday(cto[0][COL]), 'No BOM change → today');
  const [chg] = build([row('200008976212', '13AATEST', 'ChgBom')]);
  check(chg[COL] === '' && !note(chg).includes('自動建 BOM'), 'ChgBom stays blank');
  const [blank] = build([row('200008976212', '13AATEST', '')]);
  check(blank[COL] === '', 'blank Change Type stays blank');

  // 下載：該欄為日期格式；只有 New 的列標黃
  const rows = [nw, date, chg];
  let written = null;
  const encode_cell = ({ r, c }) => r + ':' + c;
  const dctx = { Map, Set, Date, Math, String, console, localStorage: { getItem: () => null, setItem() {} }, alert() {}, dbg() {},
    XLSX: { utils: {
      encode_cell,
      aoa_to_sheet: (aoa) => { const ws = {}; aoa.forEach((row, r) => row.forEach((v, c) => { ws[encode_cell({ r, c })] = { v }; })); ws.__n = aoa.length; ws.__c = aoa[0].length; dctx.XLSX.utils.__last = ws; return ws; },
      decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: dctx.XLSX.utils.__last.__n - 1, c: dctx.XLSX.utils.__last.__c - 1 } }),
      sheet_add_aoa() {}, book_new: () => ({ s: {} }), book_append_sheet: (wb, ws, n) => { wb.s[n] = ws; } },
      writeFile: (wb) => { written = wb; } } };
  vm.createContext(dctx);
  vm.runInContext('var cacheStaging8 = null, cacheStaging8Meta = null;\n' + ['resolveMtmPrefix8', 'fitExcelList8', 'nextStaging8Filename', 'projectNameForEmail8', 'emailDateStr8',
    'buildEmailSubject8', 'buildNotificationSummary8', 'downloadStagingReport8', 'downloadStagingReport8Core'].map(n => extract(n)).join('\n'), dctx);
  dctx.cacheStaging8 = rows; dctx.cacheStaging8Meta = { projectMap: new Map(), projectConflicts: new Map() };
  dctx.downloadStagingReport8();
  const ws = written.s['待貼入'];
  const col = Object.keys(rows[0]).indexOf(COL);
  const cell = r => ws[(r + 1) + ':' + col].s;
  check(cell(0).numFmt === 'yyyy/mm/dd' && cell(1).numFmt === 'yyyy/mm/dd', 'date format');
  check(cell(0).fill && cell(0).fill.fgColor.rgb === 'FFFF00', 'New close-time cell yellow');
  check(!cell(1).fill && !cell(2).fill, 'ChgDate / ChgBom not highlighted');

  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if (require.main === module) run();
