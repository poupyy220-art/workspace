const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
const pn = Buffer.from(html.match(/src="data:text\/html;charset=utf-8;base64,([^"]+)"/)[1], 'base64').toString('utf8');
function extract(src, name, indent) {
  const start = src.search(new RegExp('^' + indent + '(?:async )?function ' + name + '\\(', 'm'));
  const end = src.indexOf('\n' + indent + '}', start) + indent.length + 2;
  assert(start >= 0 && end > start, name);
  return src.slice(start, end);
}
async function run() {
  let checks = 0;
  const check = (v, msg) => { assert(v, msg); checks++; };
  for (const source of [html, pn]) for (const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(m[1]);
  checks++;

  // ---- 7️⃣：下載檔＝全部頂層 MTM（正常L10＋SPB），去重 ----
  const el = { csvFiles7: { files: [{ name: 'a.csv' }] }, factSheetFiles7: { files: [{ name: 'fs.xlsx' }] },
    precheck7Summary: {}, btnDL7: { style: {} }, autoIncSeq: { checked: false } };
  let exported = null, previewed = null;
  const ctx = { Map, Set, console, document: { getElementById: id => el[id] }, dbg() {}, showLoading() {}, alert(m) { ctx.alerted = m; },
    renderPreview(d) { previewed = d; }, incrementGlobalSeq() {},
    exportExcelWithStyles(data, name) { exported = { data, name }; },
    readAndMergeCSVs: async () => ({ headers: ['MTM/Part', 'Child Part', 'Change Type'], rows: [
      ['13HRS00AKJ', '', 'New'],     // SPB 有 FactSheet
      ['13HRS00BKJ', '', 'ChgBOM'],  // SPB 缺
      ['13HR007AKJ', '', 'New'],     // 正常L10
      ['13HR007AKJ', '', 'ChgDate'], // 重複
      ['13HR007AKJ', 'CHILD1', 'New'], // 子階不算
      ['13HR007CKJ', '', 'Delete'],  // 無效 Change Type
    ] }),
    readFactSheetPNs7: async () => new Set(['13HRS00AKJ']) };
  vm.createContext(ctx);
  vm.runInContext(['let cacheMissingFactSheet7 = []; let cacheUploadList7 = [];',
    "const VALID_CHANGE_TYPES_7 = new Set(['new', 'chgbom', 'chgdate', 'chgdes', 'chgrcd']);",
    pn.match(/^    function isSpbMtm7\(.*$/m)[0], extract(pn, 'processSpbPrecheck', '    '),
    extract(pn, 'downloadMissingFactSheetList', '    '), extract(pn, 'clearFileInput7', '    '),
    'this.state = () => ({ cacheMissingFactSheet7, cacheUploadList7 });'].join('\n'), ctx);
  await ctx.processSpbPrecheck();
  check(previewed.length === 4, 'preview rows');
  check(JSON.stringify(ctx.state().cacheMissingFactSheet7) === '["13HRS00BKJ"]', 'missing list');
  check(el.btnDL7.style.display === 'inline-flex', 'button shown');
  check(el.precheck7Summary.innerHTML.includes('全部 3 筆頂層 MTM'), 'summary');
  ctx.downloadMissingFactSheetList();
  check(JSON.stringify(exported.data) === JSON.stringify([['MTM/PART'], ['13HRS00AKJ'], ['13HRS00BKJ'], ['13HR007AKJ']]), 'upload list = all top-level');
  check(exported.name === 'SingleBOM_FactSheet上傳清單', 'file name');
  // 全部 SPB 都已有 FactSheet 時仍可下載（原本會隱藏按鈕）
  ctx.readFactSheetPNs7 = async () => new Set(['13HRS00AKJ', '13HRS00BKJ']);
  await ctx.processSpbPrecheck();
  check(el.btnDL7.style.display === 'inline-flex' && el.precheck7Summary.innerHTML.includes('✅'), 'all present still downloadable');
  ctx.clearFileInput7('csvFiles7');
  check(ctx.state().cacheUploadList7.length === 0 && el.btnDL7.style.display === 'none', 'clear resets');
  ctx.downloadMissingFactSheetList(); check(/請先按/.test(ctx.alerted), 'empty alert');

  // ---- 🛠️ 國別 DB：Pull 重試、Push 保護 ----
  const bar = { textContent: '', className: '' };
  let responses = [], urls = [], posts = 0;
  const g = { Date, Math, JSON, Promise, console, GAS_URL: 'https://example.invalid/exec',
    setTimeout: (f) => f(), confirm: () => true, saveCdb() {},
    document: { getElementById: () => bar },
    fetch: async (url, opt) => { if (opt && opt.method === 'POST') { posts++; return { status: 200, text: async () => '{"status":"ok"}' }; }
      urls.push([url, opt]); const r = responses.shift(); return { status: 200, text: async () => r }; } };
  vm.createContext(g);
  const cdbStart = html.indexOf('var cdbData = [];');
  const cdbEnd = html.indexOf('function cdbAutoDetails');
  vm.runInContext(html.slice(cdbStart, cdbEnd).replace(/^var /gm, 'globalThis.') , g);
  const good = JSON.stringify([['Code', 'DTCOUNTRY_REGION', '機種名稱', '商用或消費', '區域', '中文'], ['KJ', 'CIS', 'Neo50q G6', '商用', '非西歐', '']]);
  g.cdbData = [{ code: 'OLD' }];
  await g.cdbPush(); check(posts === 0 && /尚未 Pull 成功/.test(bar.textContent), 'push blocked before pull');
  responses = ['<!DOCTYPE html>', '<!DOCTYPE html>', good];
  g.cdbPull(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  for (let i = 0; i < 20 && !/成功/.test(bar.textContent); i++) await new Promise(r => setImmediate(r));
  check(/Pull 成功！共 1 筆/.test(bar.textContent), 'pull succeeds after retries: ' + bar.textContent);
  check(urls.length === 3 && urls.every(([u, o]) => /sheet=CountryDB&t=\d+/.test(u) && o.cache === 'no-store'), 'no-store + cache buster');
  check(g.cdbData[0].code === 'KJ', 'data loaded');
  await g.cdbPush(); await new Promise(r => setImmediate(r)); for (let i = 0; i < 10 && !/Push 成功/.test(bar.textContent); i++) await new Promise(r => setImmediate(r));
  check(posts === 1 && /Push 成功/.test(bar.textContent), 'push allowed after pull');
  // 全部失敗 → 白話錯誤、不解除保護
  g.cdbPulledOk = false; urls = []; responses = ['<!DOCTYPE html>', '<!DOCTYPE html>', '<!DOCTYPE html>', '<!DOCTYPE html>'];
  g.cdbPull(); for (let i = 0; i < 40 && !/失敗/.test(bar.textContent); i++) await new Promise(r => setImmediate(r));
  check(urls.length === 4 && /已重試4次/.test(bar.textContent) && /格式異常/.test(bar.textContent), 'fails after 4 tries: ' + bar.textContent);
  check(g.cdbPulledOk === false, 'guard stays on');
  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
run().catch(e => { console.error(e); process.exitCode = 1; });
