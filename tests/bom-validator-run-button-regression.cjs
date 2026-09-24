// 回歸：處理失敗時按鈕不得顯示「已完成」（LINE 回報 F003 分流時發現）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'modules', 'bom-validator', 'index.html'), 'utf8');
const match = html.match(/async function runProcessing\(\)\{[\s\S]*?\n  \}/);
if (!match) throw new Error('runProcessing() not found in modules/bom-validator/index.html');

function runCase(engineThrows) {
  const elements = {};
  const el = (id) => (elements[id] = elements[id] || { id, disabled: false, textContent: '', classList: { remove() {}, add() {} } });
  const alerts = [];
  const context = {
    $: el,
    console: { error() {} },
    alert: (message) => alerts.push(message),
    workbook: {},
    result: null,
    outputBuffer: null,
    renderResults() {},
    BomEngine: { processWorkbook() { if (engineThrows) throw new Error('模擬失敗'); return { ok: true }; } },
    BomWorkbookIO: { async writeWorkbook() { return new Uint8Array(1); } }
  };
  vm.createContext(context);
  vm.runInContext(`${match[0]}\nthis.run = runProcessing;`, context);
  return context.run().then(() => ({ button: el('runButton'), alerts }));
}

const tests = [
  ['success shows 已完成', async () => {
    const { button } = await runCase(false);
    if (button.textContent !== '已完成') throw new Error(`Unexpected text: ${button.textContent}`);
  }],
  ['failure does not show 已完成 and points to 重新選檔', async () => {
    const { button, alerts } = await runCase(true);
    if (button.textContent === '已完成') throw new Error('Button says 已完成 after a failure');
    if (!button.textContent.includes('重新選檔')) throw new Error(`Failure text should guide to 重新選檔: ${button.textContent}`);
    if (!button.disabled) throw new Error('Button must stay disabled after failure (workbook may be half-processed)');
    if (!alerts.length) throw new Error('Failure alert missing');
  }]
];

(async () => {
  let passed = 0;
  for (const [name, callback] of tests) {
    try { await callback(); passed += 1; console.log(`PASS ${name}`); } catch (error) { console.error(`FAIL ${name}: ${error.message}`); }
  }
  console.log(`${passed} PASS / ${tests.length - passed} FAIL`);
  if (passed !== tests.length) process.exitCode = 1;
})();
