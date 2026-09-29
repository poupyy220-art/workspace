const assert = require('node:assert/strict');
const { context } = require('./ec-tracking-pn-map-regression.cjs');

// 2026-09-29 May 確認（F014）：CTO_ 開頭 EC 的確認者改為查 Project R&R 簡表（CustomDB）
// 對應 MTM Family 的 SE（取代 2026-09-23「固定等於 Creater」）；查不到 SE 時留空並提醒。
function run() {
  let checks = 0;
  const check = (value) => { assert(value); checks++; };
  const { ctx } = context(async () => []);
  const prefixMap = new Map([['13C5', 'Tiny Neo2'], ['13ZZ', 'No SE Project']]);
  const seMap = new Map([['Tiny Neo2', 'SE']]);
  const build = (rows) => ctx.buildStagingRows8(rows, new Map(), prefixMap, new Map(), new Map(), 'TEST', seMap, new Map());
  const top = (ec, mtm) => ({ 'Lenovo EC/Doc Number': ec, 'MTM/Part': mtm, 'Child Part': '', 'Change Type': '', 'disposition': '', 'LastModified': '2026-09-29' });
  const child = (ec, mtm, changeType) => ({ ...top(ec, mtm), 'Child Part': 'SBB1Q66247', 'Change Type': changeType, 'disposition': '22' });

  // CTO_EC、MTM Family 查得到 SE → 確認者＝SE
  const withSe = build([top('CTO_00405786', 'CTOSBB_13C5CTO1WW'), child('CTO_00405786', 'CTOSBB_13C5CTO1WW', 'ChgBom')]);
  check(withSe.length === 1);
  check(withSe[0]['確認者'] === 'SE');
  check(withSe[0]['Disposition code'] === '---');

  // 整份無 Change Type 的 CTO_EC 也一樣查 SE
  const noChange = build([top('CTO_00405009', 'CTOSBB_13C5CTO1WW')]);
  check(noChange[0]['確認者'] === 'SE');
  check(noChange[0]['備註'] === 'No BOM change,EC直接close');

  // MTM Family 有、但 CustomDB 查無 SE → 留空並提醒
  const noSe = build([top('CTO_00405630', 'CTOSBB_13ZZCTO1WW')]);
  check(noSe[0]['確認者'] === '');
  check(noSe[0]['_自動判斷備註'].includes('查無「No SE Project」對應的 SE，確認者留空'));

  // MTM Family 查不到 → 確認者留空，不誤填 Creater
  const noFamily = build([top('CTO_00405631', 'CTOSBB_99XXCTO1WW')]);
  check(noFamily[0]['確認者'] === '');
  check(noFamily[0]['_自動判斷備註'].includes('MTM Family 查無對應 Project'));

  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if (require.main === module) run();
