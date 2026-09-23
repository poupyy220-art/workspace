const assert = require('node:assert/strict');
const { context } = require('./ec-tracking-pn-map-regression.cjs');

// 2026-09-23 May 確認的 CTO_ 開頭 EC 規則：
// Disposition code 固定「---」、確認者 = Creater；整份 Flatfile 無 Change Type
// 時備註「No BOM change,EC直接close」，有 ChgBom/Insert/Extract 時備註留空待人工填。
function run() {
  let checks = 0;
  const check = (value) => { assert(value); checks++; };
  const { ctx } = context(async () => []);
  const build = (rows) => ctx.buildStagingRows8(rows, new Map(), new Map([['13C5', 'Tiny Neo2']]), new Map(), new Map(), 'TEST', new Map([['Tiny Neo2', 'SE']]), new Map());
  const top = (ec, mtm) => ({ 'Lenovo EC/Doc Number': ec, 'MTM/Part': mtm, 'Child Part': '', 'Change Type': '', 'disposition': '', 'LastModified': '2026-09-23' });
  const child = (ec, mtm, changeType) => ({ ...top(ec, mtm), 'Child Part': 'SBB1Q66247', 'Change Type': changeType, 'disposition': '22' });

  // 整份無 Change Type → No BOM change
  const noChange = build([top('CTO_00405009', 'CTOSBB_13C5CTO1WW'), child('CTO_00405009', 'CTOSBB_13C5CTO1WW', '')]);
  check(noChange.length === 1);
  check(noChange[0]['Disposition code'] === '---');
  check(noChange[0]['確認者'] === 'TEST');
  check(noChange[0]['備註'] === 'No BOM change,EC直接close');
  check(noChange[0]['MTM Family'] === 'Tiny Neo2');
  check(noChange[0]['_自動判斷備註'].includes('判斷為 No BOM change'));
  check(noChange[0]['_自動判斷備註'].includes('MTM Family依CTO PN編碼慣例自動判斷'));
  check(!noChange[0]['_自動判斷備註'].includes('Disposition code'));

  // 下階有 ChgBom → 備註留空、提醒人工填
  const withChange = build([top('CTO_00404566', 'CTOSBB_13C5CTO1WW'), child('CTO_00404566', 'CTOSBB_13C5CTO1WW', 'ChgBom')]);
  check(withChange.length === 1);
  check(withChange[0]['Disposition code'] === '---');
  check(withChange[0]['確認者'] === 'TEST');
  check(withChange[0]['備註'] === '');
  check(withChange[0]['_自動判斷備註'].includes('有 BOM 變更'));

  // 同一次上傳混兩張 CTO_EC，各自判斷
  const mixed = build([top('CTO_A', 'CTOSBB_13C5CTO1WW'), top('CTO_B', 'CTOSBB_13C5CTO1WW'), child('CTO_B', 'CTOSBB_13C5CTO1WW', 'Insert')]);
  check(mixed.find(r => r['LNV ECN No'] === 'CTO_A')['備註'] === 'No BOM change,EC直接close');
  check(mixed.find(r => r['LNV ECN No'] === 'CTO_B')['備註'] === '');

  // 一般 EC 不受影響：Change Type 空白仍提示人工確認，Disposition 照原值
  const normal = build([{ ...top('200008971071', '13C5ABC1WW'), 'disposition': '22' }]);
  check(normal[0]['Disposition code'] === '22');
  check(normal[0]['備註'] === '');
  check(normal[0]['_自動判斷備註'].includes('Change Type 空白，需人工確認'));
  check(normal[0]['確認者'] === 'SE');

  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if (require.main === module) run();
