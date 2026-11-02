// 2026-11-02：PN 報表 5️⃣／6️⃣／8️⃣ 新增「SPB AVC PN最新版本」欄，演算法移植自 EC 受限制物料分析器。
// 本測試鎖住移植進來的 spbLatestPNCell helper 與原 EC 分析器 latestPN 的 6 組經典案例邏輯等價，
// 並驗證單欄呈現（有結果→PN；查無／不同系列／最高版並列→原因字串同格）、大小寫/空白正規化、
// null map 留白。報表 5 的欄位接線另見 merge-report5-chgdate-regression.cjs。
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const pn = fs.readFileSync(path.join(__dirname, '../modules/pn-report/index.html'), 'utf8').replace(/\r\n/g, '\n');
function extractFn(name) {
  const start = pn.search(new RegExp('    function ' + name + '\\('));
  assert(start >= 0, 'found ' + name);
  let i = pn.indexOf('{', start), depth = 0;
  for (; i < pn.length; i++) {
    if (pn[i] === '{') depth++;
    else if (pn[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return pn.slice(start, i);
}

const ctx = { Set, Array, Object, String, Number };
vm.createContext(ctx);
vm.runInContext(extractFn('spbLatestPNCell'), ctx);
const cell = ctx.spbLatestPNCell;

let checks = 0;
const check = (value, msg) => { assert(value, msg); checks++; };
const KEY = 'ZZZZS001';
const toMap = (values) => new Map([[KEY, values.map((pn) => ({ internalPN: pn }))]]);

// 與 EC 分析器 ec-business-rules latestPN（ec-regression 已覆蓋）相同的 6 組輸入。
const CASES = [
  ['numeric order', ['SYN-002', 'SYN-010', 'SYN-003'], 'SYN-010', false],
  ['duplicate', ['SYN-001', 'SYN-001'], 'SYN-001', false],
  ['different series', ['SYN-001', 'OTHER-002'], '', true],
  ['unversioned ambiguity', ['SYN', 'SYN-002'], '', true],
  ['numeric tie', ['SYN-01', 'SYN-001'], '', true],
  ['no match', [], '', true],
];
for (const [name, values, expectedPn, expectNote] of CASES) {
  const got = cell(toMap(values), KEY);
  if (expectNote) check(got && !values.includes(got), 'reason text in cell: ' + name + ' got=' + got);
  else check(got === expectedPn, 'resolved pn: ' + name + ' got=' + got);
}
check(cell(toMap(['SYN-010']), '  zzzzs001 ') === 'SYN-010', 'case-insensitive + trimmed key');
check(cell(null, KEY) === '', 'null map blanks column');
check(cell(toMap(['SYN-010']), '  ') === '', 'empty MTM blanks cell');
check(cell(toMap(['SYN-010']), 'NOPE').includes('找不到'), 'unknown MTM reports not-found');

// 報表 8 的 out.push 真的帶入新欄（原始碼層級確認，避免未來誤刪）
check(/'SPB AVC PN最新版本':\s*spbLatestPNCell\(/.test(pn), 'report8 out.push wires SPB latest PN column');

console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
