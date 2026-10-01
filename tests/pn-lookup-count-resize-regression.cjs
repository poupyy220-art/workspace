const vm = require('node:vm');
const assert = require('node:assert/strict');
const { extract, pn } = require('./ec-tracking-pn-map-regression.cjs');

// 2026-10-01 F020：雲端資料庫快速搜尋顯示「查到幾筆」，結果區可拖拉右下角或按鈕放大。
function run() {
  let checks = 0;
  const check = (v, msg) => { assert(v, msg); checks++; };

  check(/\.lookup-container\s*\{[^}]*resize:\s*vertical/.test(pn), 'lookup-container resizable');
  check(!/\.lookup-container\s*\{[^}]*max-height:\s*250px/.test(pn), 'no fixed max-height cap');
  check(pn.includes('id="lookupCount"'), 'count element exists');
  check(pn.includes('id="lookupContainer"') && pn.includes('onclick="toggleLookupSize()"'), 'expand button exists');

  const node = () => ({ innerHTML: '', textContent: '', style: {}, children: [], appendChild(c) { this.children.push(c); } });
  const el = { lookupInput: { value: '' }, lookupBody: node(), lookupDownloadArea: node(), lookupCount: node(),
    lookupContainer: node(), btnLookupSize: node() };
  const ctx = { console, document: { getElementById: id => el[id], createElement: () => node() },
    globalDB: [
      { internalPN: 'PN-A-001', createdTime: '2026/01/01', customerPN: 'C1', remarks: '' },
      { internalPN: 'PN-A-002', createdTime: '2026/01/02', customerPN: 'C1', remarks: '' },
      { internalPN: 'PN-B-001', createdTime: '2026/01/03', customerPN: 'C2', remarks: '巴西' },
    ], lastLookupResults: [] };
  vm.createContext(ctx);
  vm.runInContext(['lookupDB', 'toggleLookupSize'].map(extract).join('\n'), ctx);

  // 多行：2 個關鍵字，1 個查無
  el.lookupInput.value = 'pn-a\nNOPE\n';
  ctx.lookupDB();
  check(el.lookupBody.children.length === 2, 'two rows shown');
  check(el.lookupCount.textContent.includes('查到 2 筆') && el.lookupCount.textContent.includes('2 個關鍵字'), 'count text: ' + el.lookupCount.textContent);
  check(el.lookupCount.textContent.includes('1 個查無') && el.lookupCount.textContent.includes('NOPE'), 'missing keyword listed');
  check(el.lookupDownloadArea.style.display === 'flex', 'download shown');

  // 單筆
  el.lookupInput.value = 'PN-B';
  ctx.lookupDB();
  check(el.lookupCount.textContent === '查到 1 筆', 'single: ' + el.lookupCount.textContent);

  // 查無
  el.lookupInput.value = 'ZZZ';
  ctx.lookupDB();
  check(el.lookupCount.textContent.includes('查到 0 筆'), 'zero: ' + el.lookupCount.textContent);
  check(el.lookupDownloadArea.style.display === 'none', 'download hidden');

  // 清空
  el.lookupInput.value = '';
  ctx.lookupDB();
  check(el.lookupCount.textContent === '', 'cleared');

  // 放大／縮回
  ctx.toggleLookupSize();
  check(el.lookupContainer.style.height === '70vh' && el.btnLookupSize.textContent.includes('縮小'), 'expanded');
  ctx.toggleLookupSize();
  check(el.lookupContainer.style.height === '250px' && el.btnLookupSize.textContent.includes('放大'), 'collapsed');

  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if (require.main === module) { try { run(); } catch (e) { console.error('FAIL:', e.message); process.exitCode = 1; } }
module.exports = { run };
