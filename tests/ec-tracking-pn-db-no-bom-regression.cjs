const vm = require('node:vm');
const assert = require('node:assert/strict');
const { extract } = require('./ec-tracking-pn-map-regression.cjs');

// 2026-10-16 確認（F026）：「(GETC/ECR Close 時間)」空白的列，用 MTM/PART 精確比對
// PN Database「客戶料號」；備註明確寫不需建立（含條件式）且所有命中列一致時，
// 帶入原因到「備註」並填台灣當天日期。查不到、空白、暫停、歷史紀錄、衝突、讀取失敗都保留空白並提示。
// 測試資料全為虛構值。
const COL = '(GETC/ECR Close 時間)';
const NOTE = '_自動判斷備註';
const names = ['todayDateValue8', 'taiwanTodayDateValue8', 'parseLastModified8', 'resolveMtmPrefix8',
  'classifyPnDbRemark8', 'resolvePnDbNoBom8', 'loadPnDatabaseNoBom8', 'buildStagingRows8'];

function context(fetcher) {
  const ctx = { Map, Set, Date, String, console, document: { getElementById: () => ({ value: 'https://example.invalid/exec' }) },
    fetchPnJsonWithRetry: fetcher };
  vm.createContext(ctx);
  vm.runInContext(names.map(extract).join('\n'), ctx);
  return ctx;
}

async function run() {
  let checks = 0;
  const check = (v, msg) => { assert(v, msg); checks++; };
  const db = [['料號', '建立時間', '客戶料號', '備註'],
    ['INT0001', '2026/08/28', 'TESTAA01WW', '(補資料)無須建MTM BOM，僅供配件組合使用'],
    ['INT0002', '2026/08/28', 'TESTAA02WW', 'MTY 出貨時不需建立'],
    ['INT0003', '2026/08/28', 'TESTAA03WW', '印度工廠使用不接單'],
    ['INT0004', '2026/08/28', 'TESTAA04WW', '出巴西不建BOM'],
    ['INT0005', '2026/08/28', 'TESTAA05WW', '第一版'],
    ['INT0006', '2026/08/28', 'TESTAA06WW', '補資料，已建立'],
    ['INT0007', '2026/08/28', 'TESTAA07WW', ''],
    ['INT0008', '2026/08/28', 'TESTAA08WW', '不需建BOM，暫停'],
    ['INT0009', '2026/08/28', 'TESTAA09WW', 'on hold'],
    ['INT0010', '2026/08/28', 'TESTAA10WW', '不需建BOM'],
    ['INT0010-001', '2026/09/01', 'TESTAA10WW', ''],
    ['INT0011', '2026/08/28', 'TESTAA11WW', '不需建BOM'],
    ['INT0011-001', '2026/09/01', 'TESTAA11WW', '不需建BOM'],
    ['INT0012', '2026/08/28', 'TESTAA12WW', '不需建BOM'],
    ['INT0012-001', '2026/09/01', 'TESTAA12WW', '出巴西不建BOM'],
    ['INT0013', '2026/08/28', 'TESTAA13WW', '不需建BOM，已建立BOM'],
    ['INT0014', '2026/08/28', 'testaa14ww ', '不需建BOM'],
    ['INT0015', '2026/08/28', 'TESTAA15WW', '需建BOM'],
  ];
  let urlSeen = '';
  const ctx = context(async (url, options) => { urlSeen = url; check(options.cache === 'no-store', 'no-store'); return db; });
  const loaded = await ctx.loadPnDatabaseNoBom8();
  check(urlSeen.includes('?sheet=PN%20Database&t='), 'reads PN Database sheet: ' + urlSeen);
  check(!loaded.error && loaded.map.get('TESTAA11WW').length === 2, 'keeps every matching row');

  const today = ctx.taiwanTodayDateValue8();
  const twNow = new Date(Date.now() + 8 * 3600 * 1000);
  check(today instanceof Date && today.getFullYear() === twNow.getUTCFullYear() && today.getMonth() === twNow.getUTCMonth()
    && today.getDate() === twNow.getUTCDate() && today.getHours() === 0, 'Taiwan calendar date, native Date');

  const row = (mtm, ct = 'ChgBom') => ({ 'Lenovo EC/Doc Number': '200000000001', 'MTM/Part': mtm, 'Child Part': '',
    'Change Type': ct, disposition: '19', LastModified: '2026-10-01' });
  const build = (rows, lookup) => ctx.buildStagingRows8(rows, new Map(), new Map([['TEST', 'Test Project']]), new Map(),
    new Map(), 'TEST', new Map(), new Map(), lookup);
  const one = (mtm, lookup = loaded, ct) => build([row(mtm, ct)], lookup)[0];
  const isToday = (v) => v instanceof Date && v.getTime() === today.getTime();

  // 明確及條件式不建立：K 填今天、原因帶入備註
  for (const [mtm, reason] of [['TESTAA01WW', '無須建MTM BOM'], ['TESTAA02WW', '不需建立'], ['TESTAA03WW', '不接單'], ['TESTAA04WW', '不建BOM']]) {
    const r = one(mtm);
    check(isToday(r[COL]), mtm + ' close today');
    check(r['備註'].includes(reason), mtm + ' remark carries reason: ' + r['備註']);
    check(r[NOTE].includes('PN Database'), mtm + ' note explains source');
  }
  // 精確比對（去空白、不分大小寫），多筆相同原因只帶一次
  check(isToday(one('TESTAA14WW')[COL]), 'trim/case-insensitive exact match');
  const dup = one('TESTAA11WW');
  check(isToday(dup[COL]) && dup['備註'] === '不需建BOM', 'same reason not duplicated: ' + dup['備註']);
  check(!isToday(one('TESTAA1')[COL]), 'no partial match');

  // 待確認情境：K 維持空白、備註不改、提示原因
  const pending = [['TESTAA05WW', '歷史'], ['TESTAA06WW', '歷史'], ['TESTAA07WW', '空白'], ['TESTAA08WW', '暫停'], ['TESTAA09WW', '暫停'],
    ['TESTAA10WW', '衝突'], ['TESTAA12WW', '衝突'], ['TESTAA13WW', '矛盾'], ['TESTAA15WW', '未明確'], ['NOTINDB01WW', '查無']];
  for (const [mtm, word] of pending) {
    const r = one(mtm);
    check(r[COL] === '' && r['備註'] === '', mtm + ' stays blank');
    check(r[NOTE].includes('PN Database') && r[NOTE].includes(word) && r[NOTE].includes('待確認'), mtm + ' hint: ' + r[NOTE]);
  }

  // K 已有日期（New／EC直接close）維持原規則，不查 PN Database
  const nw = one('TESTAA01WW', loaded, 'New');
  check(nw[COL] instanceof Date && nw['備註'] === '' && !nw[NOTE].includes('PN Database'), 'New keeps existing K, no lookup');
  const cd = one('TESTAA01WW', loaded, 'ChgDate');
  check(cd['備註'] === 'change date,EC直接close' && !cd[NOTE].includes('PN Database'), 'direct-close keeps own remark');

  // 既有備註保留、追加在後
  const spb = build([{ ...row('12LMS0TEST'), 'Change Type': 'ChgBom', disposition: '99' }], { map: new Map([['12LMS0TEST', [{ internalPN: 'X', remark: '不需建BOM' }]]]) })[0];
  check(spb['備註'] === '第5碼S尾碼數字無需修改BOM；不需建BOM' && isToday(spb[COL]), 'keeps existing remark: ' + spb['備註']);

  // 讀取失敗：不中斷、保留原值並提示
  const failed = context(async () => { throw Error('connection failed'); });
  const fl = await failed.loadPnDatabaseNoBom8();
  check(fl.error && fl.error.includes('connection failed'), 'load failure reported, not thrown');
  const fr = one('TESTAA01WW', fl);
  check(fr[COL] === '' && fr['備註'] === '' && fr[NOTE].includes('讀取失敗'), 'load failure hint');
  for (const bad of [[], {}, [['料號', '建立時間']]]) {
    const b = context(async () => bad);
    check((await b.loadPnDatabaseNoBom8()).error, 'bad format → error');
  }
  // 未傳入（舊呼叫方式）維持原行為
  const legacy = ctx.buildStagingRows8([row('TESTAA01WW')], new Map(), new Map([['TEST', 'Test Project']]), new Map(),
    new Map(), 'TEST', new Map(), new Map())[0];
  check(legacy[COL] === '' && !legacy[NOTE].includes('PN Database'), 'legacy call unchanged');

  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if (require.main === module) run().catch((e) => { console.error(e); process.exitCode = 1; });
