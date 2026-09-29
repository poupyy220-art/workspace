const vm = require('node:vm');
const assert = require('node:assert/strict');
const { context, extract } = require('./ec-tracking-pn-map-regression.cjs');

// 2026-09-29 May 確認（F013）：Change Type 非 New（如 ChgBom）且沒有自動備註的列，
// 備註留白但下載時標黃，_自動判斷備註 提醒人工填寫；CTO EC 有 BOM 變更也標黃。
function run() {
  let checks = 0;
  const check = (v, msg) => { assert(v, msg); checks++; };
  const { ctx } = context(async () => []);
  const build = (rows) => ctx.buildStagingRows8(rows, new Map(), new Map([['13AA', 'Test Project']]), new Map(), new Map(), 'TEST', new Map(), new Map());
  const row = (ec, mtm, ct, disp = '19', child = '') => ({ 'Lenovo EC/Doc Number': ec, 'MTM/Part': mtm, 'Child Part': child, 'Change Type': ct, 'disposition': disp, 'LastModified': '2026-09-28' });
  const note = r => r['_自動判斷備註'];

  const [chg] = build([row('200008976212', '13AA04301X', 'ChgBom')]);
  check(chg['備註'] === '', 'ChgBom remark stays blank');
  check(note(chg).includes('Change Type 為「ChgBom」，「備註」需人工填寫實際變更內容'), 'ChgBom reminder: ' + note(chg));
  const [date] = build([row('200008976212', '13AA04301X', 'ChgDate')]);
  check(date['備註'] === 'change date,EC直接close' && !note(date).includes('需人工填寫'), 'ChgDate unchanged');
  const [nw] = build([row('200008976212', '13AA04301X', 'New')]);
  check(!note(nw).includes('需人工填寫'), 'New no reminder');
  const [blank] = build([row('200008976212', '13AA04301X', '')]);
  check(!note(blank).includes('「備註」需人工填寫'), 'blank change type keeps its own note');
  const [lm] = build([row('200008976212', '12LMS1XX00', 'ChgBom', '99')]);
  check(lm['備註'] === '第5碼S尾碼數字無需修改BOM' && !note(lm).includes('「備註」需人工填寫'), 'has auto remark → no reminder');

  // 下載：備註需人工填寫的列標黃
  const cto = build([row('CTO_1', 'CTOSBB_13AACTO1WW', ''), row('CTO_1', 'CTOSBB_13AACTO1WW', 'ChgBom', '22', 'SBB1')]);
  const rows = [chg, date, nw, cto[0]];
  let written = null;
  const cells = {};
  const encode_cell = ({ r, c }) => r + ':' + c;
  const dctx = { Map, Set, Date, Math, String, console, localStorage: { getItem: () => null, setItem() {} }, alert() {}, dbg() {},
    XLSX: { utils: {
      encode_cell,
      aoa_to_sheet: (aoa) => { const ws = {}; aoa.forEach((row, r) => row.forEach((v, c) => { ws[encode_cell({ r, c })] = { v }; })); ws.__n = aoa.length; ws.__c = aoa[0].length; return ws; },
      decode_range: (ref) => ({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }),
      sheet_add_aoa() {}, book_new: () => ({ s: {} }), book_append_sheet: (wb, ws, n) => { wb.s[n] = ws; } },
      writeFile: (wb) => { written = wb; } } };
  vm.createContext(dctx);
  vm.runInContext('var cacheStaging8 = null, cacheStaging8Meta = null;\n' + ['resolveMtmPrefix8', 'fitExcelList8', 'nextStaging8Filename', 'projectNameForEmail8', 'emailDateStr8',
    'buildEmailSubject8', 'buildNotificationSummary8', 'downloadStagingReport8', 'downloadStagingReport8Core'].map(n => extract(n)).join('\n'), dctx);
  // decode_range 要回傳真實範圍
  dctx.XLSX.utils.decode_range = function () { return { s: { r: 0, c: 0 }, e: { r: this.__last.__n - 1, c: this.__last.__c - 1 } }; };
  const origAoa = dctx.XLSX.utils.aoa_to_sheet;
  dctx.XLSX.utils.aoa_to_sheet = function (aoa) { const ws = origAoa(aoa); dctx.XLSX.utils.__last = ws; return ws; };
  dctx.cacheStaging8 = rows; dctx.cacheStaging8Meta = { projectMap: new Map(), projectConflicts: new Map() };
  dctx.downloadStagingReport8();
  const ws = written.s['待貼入'];
  const headers = Object.keys(rows[0]);
  const col = headers.indexOf('備註');
  const fill = r => (ws[(r + 1) + ':' + col].s.fill || {}).fgColor;
  check(fill(0) && fill(0).rgb === 'FFFF00', 'ChgBom remark cell yellow');
  check(!fill(1) && !fill(2), 'ChgDate / New not highlighted');
  check(fill(3) && fill(3).rgb === 'FFFF00', 'CTO with BOM change highlighted');

  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if (require.main === module) run();
