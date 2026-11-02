// 2026-11-02 功能C：驗證「5️⃣ ChgDate 模式」產出的第二分頁待貼入列，跟 8️⃣ 共用
// buildStagingRows8／buildStagingWorksheet8，且只含 Change Type=ChgDate 的列、備註固定
// 「change date,EC直接close」、MTM Family 有算（來自 CustomDB/PN_Project_Map）。
// 也驗證 downloadChgDateWorkbook5 的兩分頁 workbook 組裝（正常/雲端失敗兩種情境）。
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'modules/pn-report/index.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name);
  assert.ok(start >= 0, 'found function ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const checks = [];
function check(name, fn) { fn(); checks.push(name); }

// ---- buildStagingRows8 filtered to ChgDate subset: remark + MTM Family wiring ----
const ctx = {};
vm.runInNewContext([
  extractFn(html, 'resolveMtmPrefix8'),
  extractFn(html, 'todayDateValue8'),
  extractFn(html, 'parseLastModified8'),
  extractFn(html, 'spbLatestPNCell'),
  extractFn(html, 'buildStagingRows8'),
  'this.buildStagingRows8 = buildStagingRows8;',
].join('\n'), ctx);

const flatRows = [
  { 'Lenovo EC/Doc Number': 'E1', 'MTM/Part': '13C50001WW', 'Child Part': '', 'Change Type': 'ChgDate', disposition: '99' },
  { 'Lenovo EC/Doc Number': 'E1', 'MTM/Part': 'CHILD-1', 'Child Part': 'CHILD-1', 'Change Type': 'ChgDate', disposition: '99' }, // child row, filtered out by buildStagingRows8 itself
];
const projectMap = new Map([['13C5', 'Tiny Neo2']]);
const rows = ctx.buildStagingRows8(flatRows, new Map(), projectMap, new Map(), new Map(), 'May', new Map(), new Map(), { map: null, error: '' });

check('ChgDate subset yields exactly one row (child row dropped)', () => assert.equal(rows.length, 1));
check('Remark is the fixed historical phrase for ChgDate', () => assert.equal(rows[0]['備註'], 'change date,EC直接close'));
check('MTM Family resolved from CustomDB project map', () => assert.equal(rows[0]['MTM Family'], 'Tiny Neo2'));
check('SPB AVC PN latest column present (from feature A wiring)', () => assert.ok('SPB AVC PN最新版本' in rows[0]));

// ---- downloadChgDateWorkbook5 assembles 2 sheets: normal + cloud-failure fallback ----
function extractConst(src, name) {
  const re = new RegExp('const ' + name + '\\s*=[^;]*;');
  const m = src.match(re);
  assert.ok(m, 'found const ' + name);
  return m[0];
}
const wbCtx = { console };
const captured = { sheets: [] };
const XLSXStub = {
  utils: {
    aoa_to_sheet: (data) => {
      const ws = { __data: data };
      data.forEach((r, R) => r.forEach((v, C) => { ws[String.fromCharCode(65 + C) + (R + 1)] = { v }; }));
      ws['!ref'] = 'A1:' + String.fromCharCode(64 + Math.max(1, data[0] ? data[0].length : 1)) + Math.max(1, data.length);
      return ws;
    },
    decode_range: (ref) => { const [, e] = ref.split(':'); return { s: { r: 0, c: 0 }, e: { r: Number(e.slice(1)) - 1, c: e.charCodeAt(0) - 65 } }; },
    encode_cell: ({ r, c }) => String.fromCharCode(65 + c) + (r + 1),
    book_new: () => ({}),
    book_append_sheet: (wb, ws, name) => { captured.sheets.push({ name, ws }); },
  },
  writeFile: (wb, filename) => { captured.filename = filename; },
};
vm.createContext(wbCtx);
wbCtx.XLSX = XLSXStub;
wbCtx.makeFilename = (b, e) => b + '.' + e;
wbCtx.PERSONAL_REPORT = { personal: true };
vm.runInContext([
  extractFn(html, 'buildStagingWorksheet8'),
  extractFn(html, 'buildChgDateMergeSheet'),
  extractFn(html, 'downloadChgDateWorkbook5'),
  'this.downloadChgDateWorkbook5 = downloadChgDateWorkbook5; this.buildStagingWorksheet8 = buildStagingWorksheet8;',
].join('\n'), wbCtx);

wbCtx.cacheRep5 = [['Lenovo EC/Doc Number', 'SPB AVC PN最新版本'], ['E1', 'SYN-010']];
wbCtx.cacheStyle5 = {};
wbCtx.cacheLayout5 = { hiddenCols: [], redCols: [1] };
wbCtx.cacheChgDateStaging5 = rows;
wbCtx.cacheChgDateStaging5Error = '';
wbCtx.downloadChgDateWorkbook5();
check('Normal case: workbook has 2 sheets named as expected', () => {
  assert.equal(captured.sheets.length, 2);
  assert.equal(captured.sheets[0].name, '合併報表_ChgDate');
  assert.equal(captured.sheets[1].name, '待貼入(ChgDate)');
});
check('Sheet2 content matches the staging rows (not a placeholder)', () => {
  assert.equal(captured.sheets[1].ws.A2.v, 'E1');
});

// ---- cloud-failure fallback: sheet2 becomes a single warning row, main report still downloads ----
captured.sheets = [];
wbCtx.cacheChgDateStaging5 = null;
wbCtx.cacheChgDateStaging5Error = 'PN_Project_Map 讀取逾時';
wbCtx.downloadChgDateWorkbook5();
check('Cloud failure: still produces 2 sheets (main report not blocked)', () => assert.equal(captured.sheets.length, 2));
check('Cloud failure: sheet2 shows the error reason', () => assert.ok(captured.sheets[1].ws.A2.v.includes('PN_Project_Map 讀取逾時')));

console.log(JSON.stringify({ passed: checks.length, failed: 0 }));
