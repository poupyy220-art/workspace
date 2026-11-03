// 2026-11-02 功能D（8️⃣ 待貼入）：Change Type=ChgBom 且 SPB MTM 的列 → 確認者固定「Ido」、
// (GETC/ECR Close 時間) 放「confirming」且下載時紅字＋水平置中。只套用 ChgBom＋SPB；
// 其餘 Change Type、或 ChgBom 非 SPB，維持原規則不變。
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'modules/pn-report/index.html'), 'utf8');
function extractFn(src, name) {
  const start = src.indexOf('function ' + name);
  assert.ok(start >= 0, 'found function ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
}
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };

// ---- data: buildStagingRows8 overrides ----
// 傳入宿主的 Date/Map/Set，讓 sandbox 內建立的 Date 與測試端同一個 realm（instanceof Date 才成立）。
const ctx = { Date, Map, Set, String, Number, console };
vm.runInNewContext([
  extractFn(html, 'todayDateValue8'), extractFn(html, 'taiwanTodayDateValue8'),
  extractFn(html, 'parseLastModified8'), extractFn(html, 'resolveMtmPrefix8'),
  extractFn(html, 'classifyPnDbRemark8'), extractFn(html, 'resolvePnDbNoBom8'),
  extractFn(html, 'spbLatestPNCell'),
  extractFn(html, 'buildStagingRows8'), 'this.buildStagingRows8 = buildStagingRows8;',
].join('\n'), ctx);
const projectMap = new Map([['12LM', 'Tiny Neo'], ['12LN', 'Tiny Neo B']]);
const build = (mtm, ct) => ctx.buildStagingRows8(
  [{ 'Lenovo EC/Doc Number': 'E1', 'MTM/Part': mtm, 'Child Part': '', 'Change Type': ct, disposition: '99' }],
  new Map(), projectMap, new Map(), new Map(), 'May', new Map([['Tiny Neo', 'SE_X'], ['Tiny Neo B', 'SE_Y']]), new Map(), { map: null, error: '' })[0];

check('ChgBom + SPB（無不需建BOM）→ 確認者 Ido、Close 時間 confirming', () => {
  const r = build('12LMS0001W', 'ChgBom'); // 第5碼 S = SPB；pnDbLookup=null → 無不需建BOM
  assert.equal(r['確認者'], 'Ido');
  assert.equal(r['(GETC/ECR Close 時間)'], 'confirming');
  assert.ok(String(r['_自動判斷備註']).includes('Ido'));
});
check('例外：ChgBom + SPB 且主檔判不需建BOM → 維持今天 close、確認者仍 Ido', () => {
  // 帶入 PN Database「不需建BOM」→ 走 close 今天分支；功能D 例外應維持今天、不改 confirming
  const r = ctx.buildStagingRows8(
    [{ 'Lenovo EC/Doc Number': 'E1', 'MTM/Part': '12LMS0001W', 'Child Part': '', 'Change Type': 'ChgBom', disposition: '99' }],
    new Map(), projectMap, new Map(), new Map(), 'May', new Map(),
    new Map(), { map: new Map([['12LMS0001W', [{ internalPN: 'X', remark: '不需建BOM' }]]]), error: '' })[0];
  assert.notEqual(r['(GETC/ECR Close 時間)'], 'confirming');
  assert.ok(r['(GETC/ECR Close 時間)'] instanceof Date);
  assert.equal(r['確認者'], 'Ido');
  assert.ok(String(r['_自動判斷備註']).includes('仍需發信告知 Ido'));
});
check('ChgBom 非 SPB → 不套用（確認者非 Ido、Close 非 confirming）', () => {
  const r = build('12LN0001WW', 'ChgBom'); // 第5碼 0 = 非 SPB
  assert.notEqual(r['確認者'], 'Ido');
  assert.notEqual(r['(GETC/ECR Close 時間)'], 'confirming');
});
check('非 ChgBom（ChgDate）+ SPB → 不套用', () => {
  const r = build('12LMS0001W', 'ChgDate');
  assert.notEqual(r['確認者'], 'Ido');
  assert.notEqual(r['(GETC/ECR Close 時間)'], 'confirming');
});


// 複合變更類型須匹配完整 token；原始來源細節不放公開測試。
for (const ct of ['ChgBom/UPC', 'UPC/ChgBom', 'ChgBom / UPC']) {
  check(ct + ' SPB → Ido / confirming', () => {
    const r = build('12LMS0001W', ct);
    assert.equal(r['確認者'], 'Ido');
    assert.equal(r['(GETC/ECR Close 時間)'], 'confirming');
  });
}
for (const ct of ['UPC','ChgBomExtra','chgbom/UPC']) {
  check(ct + ' 不誤判 ChgBom', () => assert.notEqual(build('12LMS0001W', ct)['確認者'], 'Ido'));
}
check('複合 ChgBom 非 SPB 維持原規則', () => assert.notEqual(build('12LN0001WW','ChgBom/UPC')['確認者'],'Ido'));
check('複合 ChgBom 保留不需建 BOM 的原生日期', () => {
  const r = ctx.buildStagingRows8([{'Lenovo EC/Doc Number':'E1','MTM/Part':'12LMS0001W','Child Part':'','Change Type':'ChgBom/UPC',disposition:'99'}], new Map(), projectMap,new Map(),new Map(),'TEST',new Map(),new Map(),{map:new Map([['12LMS0001W',[{internalPN:'SYNTHETIC',remark:'不需建BOM'}]]]),error:''})[0];
  assert.equal(r['確認者'],'Ido');
  assert.ok(r['(GETC/ECR Close 時間)'] instanceof Date);
});

// ---- styling: buildStagingWorksheet8 marks confirming/pending red + center ----
const wbCtx = {};
const XLSXStub = {
  utils: {
    aoa_to_sheet: (data) => { const ws = {}; data.forEach((r, R) => r.forEach((v, C) => { ws[String.fromCharCode(65 + C) + (R + 1)] = { v }; })); ws['!ref'] = 'A1:' + String.fromCharCode(64 + data[0].length) + data.length; return ws; },
    decode_range: (ref) => { const [, e] = ref.split(':'); return { s: { r: 0, c: 0 }, e: { r: Number(e.slice(1)) - 1, c: e.charCodeAt(0) - 65 } }; },
    encode_cell: ({ r, c }) => String.fromCharCode(65 + c) + (r + 1),
  },
};
vm.createContext(wbCtx); wbCtx.XLSX = XLSXStub;
vm.runInContext(extractFn(html, 'buildStagingWorksheet8') + '\nthis.buildStagingWorksheet8 = buildStagingWorksheet8;', wbCtx);
const rows = [
  { 'LNV ECN No': 'E1', '(GETC/ECR Close 時間)': 'confirming', '_自動判斷備註': '' },
  { 'LNV ECN No': 'E2', '(GETC/ECR Close 時間)': 'pending', '_自動判斷備註': '' },
  { 'LNV ECN No': 'E3', '(GETC/ECR Close 時間)': '2026/11/02', '_自動判斷備註': '' },
];
const ws = wbCtx.buildStagingWorksheet8(rows);
const closeCol = Object.keys(rows[0]).indexOf('(GETC/ECR Close 時間)'); // col index
const cellRef = (r) => String.fromCharCode(65 + closeCol) + (r + 2); // +2: header row + 1-index
check('confirming cell → red font + center', () => {
  const s = ws[cellRef(0)].s;
  assert.equal(s.font.color.rgb, 'FF0000');
  assert.equal(s.alignment.horizontal, 'center');
});
check('pending cell → red font + center', () => {
  const s = ws[cellRef(1)].s;
  assert.equal(s.font.color.rgb, 'FF0000');
  assert.equal(s.alignment.horizontal, 'center');
});
check('date cell → not red (no confirming/pending styling)', () => {
  const s = ws[cellRef(2)].s;
  assert.ok(!s.font.color);
});

console.log(JSON.stringify({ passed: checks.length, failed: 0 }));
