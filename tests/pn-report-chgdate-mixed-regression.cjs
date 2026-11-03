// 2026-11-03 功能（主人指示）：ChgDate 日期變更報表除了純 ChgDate，也要納入「含日期變更的混合型」
// （ChgBom/Date、Date/Usage…）。判定用「以 / 切 token、整段相等比對 chgdate/date」，而不是 includes('date')
// 子字串，避免 Update(upDATE) 這類誤收；純 BOM／純 Usage 不收。輸出保留原 Change Type；一般報表不受影響。
// 另測隱藏欄的新行為：整批純 ChgDate 維持隱藏 D/E/G；有混合列則不隱藏（保留 BOM／Usage 資訊）。
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const pn = fs.readFileSync(path.join(__dirname, '../modules/pn-report/index.html'), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
  const start = pn.search(new RegExp('    function ' + name + '\\('));
  const end = pn.indexOf('\n    }', start) + 6;
  assert(start >= 0 && end > start, name);
  return pn.slice(start, end);
}
function extractConst(name) {
  const m = pn.match(new RegExp('    const ' + name + ' = [^\\n]+\\n'));
  assert(m, name);
  return m[0].replace('const ', 'var ');
}

const HEADERS = [
  'Lenovo EC/Doc Number', 'Lenovo EC/Doc Name', 'MTM/Part', 'Child Part', 'Qty', 'Change Type', 'Substitute Relationship',
  'Version', 'EC Purpose', 'EC Description', 'Name', 'basic_name', 'disposition',
  'LastModified', 'EOW Date', 'GA Date', 'AnnoucementDate', 'Withdrawal Date', 'Qualification Date',
];
const row = (o) => HEADERS.map((h) => o[h] || '');

const ROWS = [
  row({ 'Lenovo EC/Doc Number': 'EC1', 'MTM/Part': 'MTM-A', 'Change Type': 'ChgDate', 'Name': 'DT A', 'disposition': '99', 'EOW Date': '2026-10-15' }),
  row({ 'Lenovo EC/Doc Number': 'EC1', 'MTM/Part': 'MTM-A', 'Child Part': 'C1', 'Qty': '1', 'Change Type': 'none' }),
  row({ 'Lenovo EC/Doc Number': 'EC2', 'MTM/Part': 'MTM-B', 'Change Type': 'New' }),
  row({ 'Lenovo EC/Doc Number': 'EC3', 'MTM/Part': 'MTM-C', 'Child Part': 'C3', 'Qty': '2', 'Substitute Relationship': 'ALT', 'Change Type': 'ChgBom/Date', 'Withdrawal Date': '2027-01-01' }),
  row({ 'Lenovo EC/Doc Number': 'EC4', 'MTM/Part': 'MTM-D', 'Child Part': 'C4', 'Change Type': 'ChgBom' }),
  row({ 'Lenovo EC/Doc Number': 'EC5', 'MTM/Part': 'MTM-E', 'Change Type': 'Quantity Change' }),
  row({ 'Lenovo EC/Doc Number': 'EC6', 'MTM/Part': 'MTM-F', 'Child Part': 'C6', 'Change Type': 'Date/Usage' }),
  row({ 'Lenovo EC/Doc Number': 'EC7', 'MTM/Part': 'MTM-G', 'Change Type': 'Extract' }),
  row({ 'Lenovo EC/Doc Number': 'EC8', 'MTM/Part': 'MTM-H', 'Change Type': 'Insert' }),
  row({ 'Lenovo EC/Doc Number': 'EC9', 'MTM/Part': 'MTM-I', 'Child Part': 'C9', 'Change Type': ' chgbom / DATE ' }),
  row({ 'Lenovo EC/Doc Number': 'EC10', 'MTM/Part': 'MTM-J', 'Change Type': 'Update' }),
];
// 全部純 ChgDate（驗整批純 ChgDate 時仍隱藏 D/E/G）
const PURE_ROWS = [
  row({ 'Lenovo EC/Doc Number': 'P1', 'MTM/Part': 'P-A', 'Change Type': 'ChgDate' }),
  row({ 'Lenovo EC/Doc Number': 'P2', 'MTM/Part': 'P-B', 'Change Type': 'chgdate' }),
];

function run() {
  let checks = 0;
  const check = (value, msg) => { assert(value, msg); checks++; };

  const ctx = { Set, Array, Object, String, Number };
  vm.createContext(ctx);
  ['REPORT5_HEAD', 'REPORT5_CHGDATE_EXTRA', 'REPORT5_CHGDATE_HIDDEN', 'SPB_PN_COL', 'DATE_TOKENS'].forEach((n) => vm.runInContext(extractConst(n), ctx));
  ['chgDateTokens', 'isChgDateType', 'isMixedChgDateType', 'spbLatestPNCell', 'buildMergeReport5'].forEach((n) => vm.runInContext(extract(n), ctx));

  // --- 單元：token 判定規則 ---
  check(ctx.isChgDateType('ChgDate'), 'pure ChgDate is date');
  check(ctx.isChgDateType('ChgBom/Date'), 'ChgBom/Date is date');
  check(ctx.isChgDateType('Date/Usage'), 'Date/Usage is date');
  check(ctx.isChgDateType('ChgBom/Date/Usage'), 'ChgBom/Date/Usage is date (any order)');
  check(ctx.isChgDateType(' chgbom / DATE '), 'whitespace + case still date');
  check(!ctx.isChgDateType('ChgBom'), 'pure BOM is not date');
  check(!ctx.isChgDateType('Quantity Change'), 'pure Usage (Quantity Change) is not date');
  check(!ctx.isChgDateType('Insert') && !ctx.isChgDateType('Extract'), 'Insert/Extract not date');
  check(!ctx.isChgDateType('Update'), 'Update(upDATE) substring NOT matched');
  check(!ctx.isChgDateType('') && !ctx.isChgDateType(null) && !ctx.isChgDateType(undefined), 'empty/null not date');
  check(ctx.isMixedChgDateType('ChgBom/Date') && ctx.isMixedChgDateType('Date/Usage'), 'mixed detected');
  check(!ctx.isMixedChgDateType('ChgDate'), 'pure ChgDate is not mixed');
  check(!ctx.isMixedChgDateType('ChgBom'), 'pure BOM is not mixed');

  // --- chgdate 報表：納入純 + 混合，排除純 BOM/Usage/未知/Update/none ---
  const pnMap = new Map([['MTM-A', [{ internalPN: 'SYN001' }, { internalPN: 'SYN001-002' }]]]);
  const cd = ctx.buildMergeReport5(HEADERS, ROWS, 'chgdate', pnMap);
  const head = cd.data[0];
  const ctCol = head.indexOf('Change Type');
  const got = cd.data.slice(1).map((r) => r[head.indexOf('Lenovo EC/Doc Number')]);
  check(JSON.stringify(got) === JSON.stringify(['EC1', 'EC3', 'EC6', 'EC9']), 'chgdate: only date rows (EC1 pure, EC3/EC6/EC9 mixed)');
  check(cd.data.length === 5, 'chgdate: header + 4 rows, no duplicates');
  check(new Set(got).size === got.length, 'chgdate: no duplicate EC rows');

  // 保留原本 Change Type（不被正規化成 token）
  check(cd.data[2][ctCol] === 'ChgBom/Date', 'chgdate: original Change Type preserved (ChgBom/Date)');
  check(cd.data[4][ctCol] === 'chgbom / DATE', 'chgdate: original Change Type preserved, only outer-trimmed');

  // 有混合列 → 不隱藏 D/E/G（保留 BOM/Usage 欄）；紅字欄不變；SPB 欄既不隱藏也不紅
  check(JSON.stringify(Array.from(cd.layout.hiddenCols)) === '[]', 'chgdate(mixed present): D/E/G NOT hidden');
  check(JSON.stringify(Array.from(cd.layout.redCols)) === JSON.stringify([11, 12, 13, 14, 15, 16]), 'chgdate: red date columns unchanged');
  check(head.length === 18 && head[17] === ctx.SPB_PN_COL, 'chgdate: 11+6+SPB columns');
  check(!cd.layout.hiddenCols.includes(17) && !cd.layout.redCols.includes(17), 'chgdate: SPB column neither hidden nor red');
  // 混合列保留 Child Part / Qty / Substitute Relationship 內容
  check(cd.data[2][head.indexOf('Child Part')] === 'C3' && cd.data[2][head.indexOf('Qty')] === '2' && cd.data[2][head.indexOf('Substitute Relationship')] === 'ALT', 'chgdate: mixed row keeps Child Part/Qty/Substitute');
  // SPB 版本（原始料號=第0版，取最高版）
  check(cd.data[1][17] === 'SYN001-002', 'chgdate: SPB latest version on EC1 (base v0 vs -002)');

  // --- 整批純 ChgDate：維持隱藏 D/E/G（原本行為） ---
  const cdPure = ctx.buildMergeReport5(HEADERS, PURE_ROWS, 'chgdate', null);
  check(JSON.stringify(Array.from(cdPure.layout.hiddenCols)) === JSON.stringify([3, 4, 6]), 'chgdate(all pure): D/E/G hidden kept');
  check(cdPure.data.length === 3, 'chgdate(all pure): header + 2 rows');

  // --- 一般報表不受影響：全部非空/非 none 列都進，Change Type 不篩 ---
  const all = ctx.buildMergeReport5(HEADERS, ROWS, 'all', pnMap);
  check(all.data[0].length === 12, 'all: 11 + SPB only (no extra/hidden/red)');
  check(!all.layout.hiddenCols && !all.layout.redCols, 'all: no chgdate layout');
  // none 排除，其餘 10 列都在（含純 BOM/Usage/Update/Insert/Extract/New）
  check(all.data.length === 1 + 10, 'all: header + 10 rows (only none excluded)');

  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if (require.main === module) run();
