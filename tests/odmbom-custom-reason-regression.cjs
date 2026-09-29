const vm = require('node:vm');
const assert = require('node:assert/strict');
const { extract, pn } = require('./ec-tracking-pn-map-regression.cjs');

// 2026-09-29 F010：4️⃣ ODMBOM Version Y 選「5. 自定義」時，每個料號可各自填原因；
// 空白沿用共用原因，改料號清單時保留已填內容，從 Excel 貼一整欄會往下填。
function run() {
  let checks = 0;
  const check = (v, msg) => { assert(v, msg); checks++; };
  const el = {
    pnInput: { value: '' }, verY: { checked: true }, bomTemplate: { value: 'custom' },
    bomCustomText: { value: '' }, bomCustomBox: { style: {} }, bomCustomTable: { innerHTML: '' }, autoIncSeq: { checked: false },
  };
  let exported = null, alerts = [], confirmAnswer = true, confirms = [];
  const ctx = { Map, Set, String, console, document: { getElementById: id => el[id] }, window: {},
    alert: m => alerts.push(m), confirm: m => { confirms.push(m); return confirmAnswer; },
    exportExcelWithStyles: (d, name) => { exported = { d, name }; }, incrementGlobalSeq() {} };
  vm.createContext(ctx);
  vm.runInContext([
    "const getPNList = () => document.getElementById('pnInput').value.split('\\n').map(x=>x.trim()).filter(x=>x!=='');",
    'const bomCustomReasons4 = new Map();',
    ...['toggleBomCustomInput', 'escHtml4', 'uniquePNs4', 'renderBomCustomTable4', 'setBomReason4', 'pasteBomReasons4', 'generateReport4'].map(n => extract(n)),
    'this.reasons = bomCustomReasons4;',
  ].join('\n'), ctx);
  const paste = (text, idx) => { let prevented = false; ctx.pasteBomReasons4({ clipboardData: { getData: () => text }, preventDefault: () => { prevented = true; } }, idx); return prevented; };
  const comments = () => exported.d.slice(1).map(r => r[1]);

  // 還沒貼料號：顯示提示
  ctx.toggleBomCustomInput();
  check(el.bomCustomBox.style.display === 'block', 'box shown');
  check(el.bomCustomTable.innerHTML.includes('請先在上方「步驟一」貼上料號'), 'empty hint');

  // 貼料號後列出每一筆（重複料號只列一次）
  el.pnInput.value = 'PN-A\nPN-B\nPN-C\nPN-A\n';
  ctx.renderBomCustomTable4();
  check((el.bomCustomTable.innerHTML.match(/<tr><td>/g) || []).length === 3, 'one row per unique PN');

  // 共用原因＋個別原因
  el.bomCustomText.value = 'shared reason';
  ctx.setBomReason4(1, '  only B  ');
  ctx.generateReport4();
  check(JSON.stringify(comments()) === JSON.stringify(['shared reason', 'only B', 'shared reason', 'shared reason']), 'per-PN with shared fallback: ' + comments());
  check(exported.d.length === 5 && exported.d[1][2] === 'Y', 'rows and flag kept');
  check(confirms.length === 0, 'no confirm when all have reasons');

  // 改料號清單：已填的保留、新料號空白
  el.pnInput.value = 'PN-B\nPN-D';
  ctx.renderBomCustomTable4();
  check(el.bomCustomTable.innerHTML.includes('value="only B"'), 'kept after list change');

  // 從 Excel 貼整欄，從第 1 格往下填；多出來的行提醒
  el.pnInput.value = 'PN-A\nPN-B\nPN-C';
  check(paste('r1\r\nr2\r\nr3\r\nr4\r\n', 0) === true, 'multi-line paste handled');
  check(ctx.reasons.get('PN-A') === 'r1' && ctx.reasons.get('PN-B') === 'r2' && ctx.reasons.get('PN-C') === 'r3', 'filled down');
  check(alerts.some(a => a.includes('多 1 行')), 'extra lines warned');
  check(paste('single', 0) === false, 'single-line paste left to browser');

  // 沒有共用原因、也有料號沒填 → 先提醒；取消就不產出
  el.bomCustomText.value = '';
  ctx.setBomReason4(2, '');
  exported = null; confirmAnswer = false;
  ctx.generateReport4();
  check(confirms.length === 1 && confirms[0].includes('1 筆料號沒有原因') && exported === null, 'blank confirm cancels');

  // 特殊字元不會破壞表格
  el.pnInput.value = 'PN-<x>';
  ctx.setBomReason4(0, '"quoted" <b>');
  ctx.renderBomCustomTable4();
  check(!el.bomCustomTable.innerHTML.includes('<x>') && el.bomCustomTable.innerHTML.includes('&quot;quoted&quot; &lt;b&gt;'), 'escaped');

  // 其他模板不受影響
  el.bomTemplate.value = 'india1'; el.pnInput.value = 'PN-A'; confirmAnswer = true;
  ctx.generateReport4();
  check(comments()[0] === 'BOM incloud SBB1T33034 for india. no need set up BOM', 'other template unchanged');
  el.verY.checked = false; el.bomTemplate.value = 'custom';
  ctx.generateReport4();
  check(comments()[0] === '' && exported.d[1][2] === 'N', 'Version N unchanged');

  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if (require.main === module) run();
