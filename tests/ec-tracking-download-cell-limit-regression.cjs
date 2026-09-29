const vm = require('node:vm');
const assert = require('node:assert/strict');
const { extract, pn } = require('./ec-tracking-pn-map-regression.cjs');

// 2026-09-29 F007／F009：New 料號很多時「EC report Summary」的 MTM清單超過 Excel
// 單格 32,767 字上限，xlsx 寫檔丟錯、onclick 沒接住，按「下載 Excel」完全沒反應。
const LIMIT = 32767;
function colName(c) { let s = ''; c++; while (c) { const r = (c - 1) % 26; s = String.fromCharCode(65 + r) + s; c = Math.floor((c - 1) / 26); } return s; }
function mockXlsx(written) {
  const encode_cell = ({ r, c }) => colName(c) + (r + 1);
  const put = (ws, aoa, r0) => {
    aoa.forEach((row, r) => row.forEach((v, c) => { ws[encode_cell({ r: r0 + r, c })] = { v, t: typeof v === 'number' ? 'n' : 's' }; }));
    const rows = r0 + aoa.length, cols = Math.max(ws.__cols || 0, ...aoa.map(a => a.length));
    ws.__rows = Math.max(ws.__rows || 0, rows); ws.__cols = cols;
    ws['!ref'] = 'A1:' + encode_cell({ r: ws.__rows - 1, c: cols - 1 });
  };
  return {
    utils: {
      encode_cell,
      decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }),
      aoa_to_sheet: (aoa) => { const ws = {}; put(ws, aoa, 0); return ws; },
      sheet_add_aoa: (ws, aoa, { origin }) => put(ws, aoa, parseInt(origin.slice(1), 10) - 1),
      book_new: () => ({ sheets: {} }),
      book_append_sheet: (wb, ws, name) => { wb.sheets[name] = ws; },
    },
    // 跟 xlsx-js-style@1.2.0 相同的檢查（已用正式站同版程式庫實測：2,731 筆即丟錯）
    writeFile: (wb, name) => {
      for (const ws of Object.values(wb.sheets)) for (const [k, cell] of Object.entries(ws)) {
        if (!k.startsWith('!') && !k.startsWith('__') && typeof cell.v === 'string' && cell.v.length > LIMIT) throw new Error('Text length must not exceed 32767 characters');
      }
      written.push({ wb, name });
    },
  };
}

function run() {
  let checks = 0;
  const check = (v, msg) => { assert(v, msg); checks++; };
  const written = [], alerts = [], logs = [];
  const ctx = { Map, Set, Date, Math, String, console, localStorage: { getItem: () => null, setItem() {} },
    alert: (m) => alerts.push(m), dbg: (m) => logs.push(m), XLSX: mockXlsx(written) };
  vm.createContext(ctx);
  const names = ['resolveMtmPrefix8', 'fitExcelList8', 'nextStaging8Filename', 'projectNameForEmail8', 'emailDateStr8',
    'buildEmailSubject8', 'buildNotificationSummary8', 'downloadStagingReport8', 'downloadStagingReport8Core'];
  vm.runInContext('var cacheStaging8 = null, cacheStaging8Meta = null;\n' + names.map(n => extract(n)).join('\n'), ctx);

  const row = (mtm) => ({ 'LNV ECN No': '200000000001', 'MTM/PART': mtm, 'MTM Family': 'Big Project', 'Disposition code': '22',
    'LNV GETC Open Date': new Date(2026, 8, 29), 'LNV GETC Close Date': new Date(2026, 8, 29), '備註': '', 'SPB MTM與否': '',
    '_ChangeType（僅供核對，貼主表前刪除）': 'New', '_自動判斷備註': '' });
  const meta = { projectMap: new Map(), projectConflicts: new Map() };

  // 3,300 筆 New（跟 F009 同量級）→ 下載成功、每格都在上限內
  ctx.cacheStaging8 = Array.from({ length: 3300 }, (_, i) => row('13AA' + String(i).padStart(6, '0')));
  ctx.cacheStaging8Meta = meta;
  ctx.downloadStagingReport8();
  check(alerts.length === 0, 'no alert: ' + alerts.join('|'));
  check(written.length === 1, 'file written');
  const summary = written[0].wb.sheets['EC report Summary'];
  const list = summary.G2.v;
  check(list.length <= LIMIT, 'MTM清單 within limit: ' + list.length);
  check(list.includes('共 3300 筆') && list.includes('完整清單見「待貼入」工作表'), 'truncation explained');
  check(summary.C2.v === 3300, '數量 still full count');
  check(String(summary.H2.v).includes('超過 Excel 單格上限'), '備註 mentions truncation');
  check(written[0].wb.sheets['待貼入'].__rows === 3301, 'detail sheet keeps all rows');

  // 少量時清單完全不變
  const small = ctx.buildNotificationSummary8([row('13AA000001'), row('13AA000002')], new Map(), new Map());
  check(small[0]['MTM清單'] === '13AA000001, 13AA000002' && small[0]['備註'] === '', 'small list unchanged');

  // 其他寫檔錯誤：跳出提示並寫入除錯視窗，不再無聲失敗
  ctx.XLSX.writeFile = () => { throw new Error('disk full'); };
  ctx.cacheStaging8 = [row('13AA000001')];
  ctx.downloadStagingReport8();
  check(alerts.length === 1 && alerts[0].includes('下載 Excel 失敗') && alerts[0].includes('disk full'), 'alert on failure');
  check(logs.some(l => String(l).includes('下載 Excel 失敗')), 'dbg on failure');

  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if (require.main === module) run();
