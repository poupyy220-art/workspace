const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

// 2026-10-16 F027：5️⃣ 合併報表新增「ChgDate 日期變更報表」格式。
// 只留 Change Type＝ChgDate 的列；Child Part／Qty／Substitute Relationship 隱藏；
// 另加 LastModified、EOW Date、GA Date、AnnoucementDate、Withdrawal Date、Qualification Date 並標紅字。
// 一般格式輸出維持原樣。
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const pn = Buffer.from(html.match(/src="data:text\/html;charset=utf-8;base64,([^"]+)"/)[1], 'base64').toString('utf8');
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
  row({ 'Lenovo EC/Doc Number': 'EC1', 'MTM/Part': 'MTM-A', 'Change Type': 'ChgDate', 'Name': 'Desktop A', 'disposition': '99', 'LastModified': '2026-10-16', 'EOW Date': '2026-10-15' }),
  row({ 'Lenovo EC/Doc Number': 'EC1', 'MTM/Part': 'MTM-A', 'Child Part': 'CHILD-1', 'Qty': '1', 'Change Type': 'none' }),
  row({ 'Lenovo EC/Doc Number': 'EC2', 'MTM/Part': 'MTM-B', 'Change Type': 'New' }),
  row({ 'Lenovo EC/Doc Number': 'EC3', 'MTM/Part': 'MTM-C', 'Change Type': 'chgdate', 'Withdrawal Date': '2027-01-01' }),
  row({ 'Lenovo EC/Doc Number': 'EC4', 'MTM/Part': 'MTM-D', 'Change Type': 'ChgBom', 'Child Part': 'CHILD-2' }),
];

function run() {
  let checks = 0;
  const check = (value, msg) => { assert(value, msg); checks++; };

  const ctx = { Set, Array, Object };
  vm.createContext(ctx);
  ['REPORT5_HEAD', 'REPORT5_CHGDATE_EXTRA', 'REPORT5_CHGDATE_HIDDEN'].forEach((n) => vm.runInContext(extractConst(n), ctx));
  vm.runInContext(extract('buildMergeReport5'), ctx);

  // 一般格式：維持原本 11 欄、排除 none／空白，New 頂層列標黃
  const all = ctx.buildMergeReport5(HEADERS, ROWS, 'all');
  check(all.data[0].length === 11, 'all: 11 columns');
  check(all.data.length === 5, 'all: header + 4 rows (none excluded)');
  check(all.styles[2] === 'yellow', 'all: New top-level row yellow');
  check(!all.layout.redCols && !all.layout.hiddenCols, 'all: no extra layout');

  // ChgDate 格式：大小寫不拘只留 ChgDate 列
  const cd = ctx.buildMergeReport5(HEADERS, ROWS, 'chgdate');
  const head = cd.data[0];
  check(head.length === 17, 'chgdate: 11 + 6 columns');
  check(cd.data.length === 3, 'chgdate: header + 2 ChgDate rows');
  check(cd.data.slice(1).every((r) => r[head.indexOf('Change Type')].toLowerCase() === 'chgdate'), 'chgdate: only ChgDate rows');
  check(JSON.stringify(head.slice(11)) === JSON.stringify(['LastModified', 'EOW Date', 'GA Date', 'AnnoucementDate', 'Withdrawal Date', 'Qualification Date']), 'chgdate: extra columns order');
  check(JSON.stringify(Array.from(cd.layout.hiddenCols)) === JSON.stringify([3, 4, 6]), 'chgdate: hide D/E/G');
  check(JSON.stringify(Array.from(cd.layout.redCols)) === JSON.stringify([11, 12, 13, 14, 15, 16]), 'chgdate: red date columns');
  check(cd.data[1][head.indexOf('EOW Date')] === '2026-10-15', 'chgdate: EOW Date value kept');
  check(cd.data[2][head.indexOf('Withdrawal Date')] === '2027-01-01', 'chgdate: Withdrawal Date value kept');
  check(cd.layout.missing.length === 0, 'chgdate: no missing columns');

  // 缺欄位時回報 missing，不會丟錯
  const partial = ctx.buildMergeReport5(HEADERS.slice(0, 13), ROWS.map((r) => r.slice(0, 13)), 'chgdate');
  check(partial.layout.missing.length === 6, 'chgdate: missing date columns reported');
  check(partial.data[1][11] === '', 'chgdate: missing column blank');

  // exportExcelWithStyles：隱藏欄與紅字（用假的 XLSX 物件攔截工作表）
  let captured = null;
  const XLSX = {
    utils: {
      book_new: () => ({}),
      aoa_to_sheet: (data) => {
        const ws = {};
        data.forEach((r, R) => r.forEach((v, C) => { ws[String.fromCharCode(65 + C) + (R + 1)] = { v }; }));
        ws['!ref'] = 'A1:' + String.fromCharCode(64 + data[0].length) + data.length;
        return ws;
      },
      decode_range: (ref) => {
        const [, e] = ref.split(':');
        return { s: { r: 0, c: 0 }, e: { r: Number(e.slice(1)) - 1, c: e.charCodeAt(0) - 65 } };
      },
      encode_cell: ({ r, c }) => String.fromCharCode(65 + c) + (r + 1),
      book_append_sheet: (wb, ws) => { captured = ws; },
    },
    writeFile: () => {},
  };
  const ectx = { XLSX, Set, Array, Object, makeFilename: (b, e) => b + '.' + e, document: { getElementById: () => ({ value: 'csv' }) } };
  vm.createContext(ectx);
  vm.runInContext(extract('exportExcelWithStyles'), ectx);
  ectx.exportExcelWithStyles(cd.data, 'x', cd.styles, 'xlsx', cd.layout);
  const cols = captured['!cols'];
  check(cols && cols.length === 17, 'export: !cols set');
  check(cols[3].hidden && cols[4].hidden && cols[6].hidden && !cols[5].hidden, 'export: D/E/G hidden only');
  // v2.17.6 修正：沒給寬度的欄 Excel 會當寬度 0、整份看起來空白，每欄都要有寬度
  check(cols.every((c) => c.wch >= 8 && c.wch <= 50), 'export: every column has a visible width');
  check(cols[0].wch === 22 && cols[4].wch === 8, 'export: width follows longest text (min 8)');
  check(captured['L1'].s.font.color.rgb === 'FF0000' && captured['L1'].s.font.bold, 'export: header red keeps bold');
  check(captured['M2'].s.font.color.rgb === 'FF0000', 'export: data red');
  check(!(captured['K2'].s.font && captured['K2'].s.font.color), 'export: other columns not red');

  // 一般格式匯出不加 !cols
  ectx.exportExcelWithStyles(all.data, 'x', all.styles, 'xlsx');
  check(!captured['!cols'], 'export all: no hidden columns');

  // 介面有 ChgDate 選項
  check(/<select id="report5Mode"[\s\S]*?value="chgdate"/.test(pn), 'ui: ChgDate option');

  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if (require.main === module) run();
