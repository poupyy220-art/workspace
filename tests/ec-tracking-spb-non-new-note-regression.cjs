const assert = require('node:assert/strict');
const { context } = require('./ec-tracking-pn-map-regression.cjs');

// 2026-09-29 May 確認：SPB MTM 只有 Change Type=New 才從 FactSheet 帶國別（規則不變），
// 但非 New 的 SPB 列不能靜靜留白，要在 _自動判斷備註 提醒人工填，
// FactSheet 查得到時順便列出參考值，只寫備註、不自動填正式欄位。
function run() {
  let checks = 0;
  const check = (value, msg) => { assert(value, msg); checks++; };
  const { ctx } = context(async () => []);
  const ccMap = new Map([['IN', { region: 'India', chinese: '印度' }]]);
  const projectMap = new Map([['13AA', 'Test Project']]);
  const factSheet = new Map([['13AAS1XX00', { crmCountry: 'IN', salesGeo: 'India' }]]);
  const build = (rows, fsMap = factSheet) => ctx.buildStagingRows8(rows, ccMap, projectMap, new Map(), fsMap, 'TEST', new Map(), new Map());
  const row = (mtm, changeType, disposition = '99') => ({ 'Lenovo EC/Doc Number': '300000000001', 'MTM/Part': mtm, 'Child Part': '', 'Change Type': changeType, 'disposition': disposition, 'LastModified': '2026-09-29' });
  const note = (r) => r['_自動判斷備註'];

  // SPB＋ChgBom、FactSheet 查得到 → 正式欄位仍留白，備註提醒並附參考值
  const [chg] = build([row('13AAS1XX00', 'ChgBom')]);
  check(chg['MTM後2碼'] === '' && chg['國別中文'] === '' && chg['Sales GEO'] === '' && chg['西歐/非西歐/出中國'] === '', 'fields stay blank');
  check(note(chg).includes('Change Type 為「ChgBom」'), 'mentions change type: ' + note(chg));
  check(note(chg).includes('未自動帶國別'), 'explains rule');
  check(note(chg).includes('FactSheet 參考：IN／India'), 'shows FactSheet reference');

  // SPB＋ChgBom、FactSheet 查不到
  const [missing] = build([row('13AAS1YY00', 'ChgBom')]);
  check(note(missing).includes('FactSheet 也查無此料號'), 'missing in FactSheet: ' + note(missing));

  // SPB＋ChgDate、本次沒上傳 FactSheet
  const [noFs] = build([row('13AAS1XX00', 'ChgDate')], new Map());
  check(note(noFs).includes('本次未上傳 FactSheet'), 'no FactSheet uploaded: ' + note(noFs));

  // 與其他備註並存（Disposition 異常）不互相覆蓋
  const [both] = build([row('13AAS1XX00', 'ChgBom', '19')]);
  check(note(both).includes('Disposition code 應為 99') && note(both).includes('FactSheet 參考'), 'notes combined: ' + note(both));

  // SPB＋New 照原規則帶國別，不加新提醒
  const [isNew] = build([row('13AAS1XX00', 'New')]);
  check(isNew['MTM後2碼'] === 'IN' && isNew['Sales GEO'] === 'India' && isNew['國別中文'] === '印度', 'New still filled');
  check(!note(isNew).includes('未自動帶國別'), 'New has no extra note');

  // 非 SPB＋ChgBom 不受影響
  const [normal] = build([row('13AA007AIN', 'ChgBom', '22')]);
  check(!note(normal).includes('未自動帶國別'), 'non-SPB unaffected');

  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if (require.main === module) run();
