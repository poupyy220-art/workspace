const vm = require('node:vm');
const assert = require('node:assert/strict');
const { context, extract } = require('./ec-tracking-pn-map-regression.cjs');

// 2026-09-29 May 確認（F011／F012）：
// 1. POR 檔名單字母尾碼（…POR_W_…）比照兩碼尾碼：LNV ECN No 帶尾碼、Disposition 19/22/99、確認者＝Creater
// 2. POR EC 整份 Flatfile 無 Change Type → 備註「No BOM change,EC直接close」，_自動判斷備註 提醒抽看
async function run() {
  let checks = 0;
  const check = (v, msg) => { assert(v, msg); checks++; };

  // 檔名尾碼解析
  const csv = 'Lenovo EC/Doc Number,MTM/Part,Child Part,Change Type,disposition\n11189498POR,13AA000VJE,,,99\n';
  const files = (name) => ({ files: [{ name, text: async () => csv }] });
  const el = {};
  const pctx = { document: { getElementById: id => el[id] }, console };
  vm.createContext(pctx);
  vm.runInContext(extract('parseFlatfileObjRows8'), pctx);
  for (const [name, want] of [['11189498POR_W_LBG AVC DT_FLATFILE.csv', '11189498POR_W'], ['11189498POR_CQ_LBG.csv', '11189498POR_CQ'],
    ['11189498POR_LBG AVC DT.csv', ''], ['11189498POR.csv', '']]) {
    el.f = files(name);
    const rows = await pctx.parseFlatfileObjRows8('f');
    check(rows[0].__sourcePorEcNo === want, name + ' → ' + rows[0].__sourcePorEcNo);
  }

  const { ctx } = context(async () => []);
  const build = (rows) => ctx.buildStagingRows8(rows, new Map(), new Map([['13AA', 'Test Project']]), new Map(), new Map(), 'TEST', new Map(), new Map());
  const row = (ec, src, mtm, child, ct, disp) => ({ 'Lenovo EC/Doc Number': ec, __sourcePorEcNo: src, 'MTM/Part': mtm, 'Child Part': child, 'Change Type': ct, 'disposition': disp, 'LastModified': '2026-09-27' });

  // F011：單字母尾碼、整份無 Change Type
  const f011 = build([row('11189498POR', '11189498POR_W', '13AA000VJE', '', '', '99'), row('11189498POR', '11189498POR_W', '13AA000VJE', 'SBB0T19940', '', '')]);
  check(f011.length === 1, 'top row only');
  check(f011[0]['LNV ECN No'] === '11189498POR_W', 'ECN keeps single suffix: ' + f011[0]['LNV ECN No']);
  check(f011[0]['Disposition code'] === '19/22/99', 'POR disposition display');
  check(f011[0]['確認者'] === 'TEST', 'confirmer = Creater');
  check(f011[0]['備註'] === 'No BOM change,EC直接close', 'remark: ' + f011[0]['備註']);
  check(f011[0]['_自動判斷備註'].includes('POR EC 整份 Flatfile 無 Change Type'), 'auto note: ' + f011[0]['_自動判斷備註']);

  // F012：單字母尾碼、有 New／Insert
  const f012 = build([row('0011970548POR', '0011970548POR_U', '13AA0002DC', '', 'New', '99'), row('0011970548POR', '0011970548POR_U', '13AA0002DC', 'SBB1Q66950', 'Insert', '')]);
  check(f012[0]['LNV ECN No'] === '0011970548POR_U' && f012[0]['Disposition code'] === '19/22/99' && f012[0]['確認者'] === 'TEST', 'F012 POR rules');
  check(f012[0]['備註'] === '' && !f012[0]['_自動判斷備註'].includes('No BOM change'), 'with change type: no No-BOM-change remark');

  // 同一次上傳兩張 POR：各自判斷
  const mixed = build([row('11111111POR', '11111111POR_A', '13AA000001', '', '', '99'), row('22222222POR', '22222222POR_BC', '13AA000002', '', '', '99'), row('22222222POR', '22222222POR_BC', '13AA000002', 'SBB1', 'ChgBom', '')]);
  check(mixed.find(r => r['LNV ECN No'] === '11111111POR_A')['備註'] === 'No BOM change,EC直接close', 'EC A no change');
  check(mixed.find(r => r['LNV ECN No'] === '22222222POR_BC')['備註'] === '', 'EC BC has change');

  // 非 POR 的 Change Type 空白維持原提示
  const normal = build([row('200008971071', '', '13AA000003', '', '', '22')]);
  check(normal[0]['備註'] === '' && normal[0]['_自動判斷備註'].includes('Change Type 空白，需人工確認'), 'non-POR unchanged');

  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
