const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

// 2026-09-29 F016：PN 工具以 data: 網址嵌在 iframe，瀏覽器不給用 localStorage，
// 原本存在 localStorage 的流水號每次都退回 -1。改用下載時間（時分）當尾碼，不需儲存、不會重複。
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const pn = Buffer.from(html.match(/src="data:text\/html;charset=utf-8;base64,([^"]+)"/)[1], 'base64').toString('utf8');
function extract(name) {
  const start = pn.search(new RegExp('    function ' + name + '\\('));
  const end = pn.indexOf('\n    }', start) + 6;
  assert(start >= 0 && end > start, name);
  return pn.slice(start, end);
}

function run() {
  let checks = 0;
  const check = (value) => { assert(value); checks++; };
  const makeCtx = (iso) => {
    const RealDate = Date;
    class FixedDate extends RealDate { constructor(...a) { super(...(a.length ? a : [iso])); } }
    // localStorage 讀寫都丟錯，模擬 data: iframe 的實際狀況
    const localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
    const ctx = { Date: FixedDate, localStorage, String };
    vm.createContext(ctx);
    vm.runInContext(extract('nextStaging8Filename'), ctx);
    return ctx;
  };

  const a = makeCtx('2026-09-29T14:53:10').nextStaging8Filename();
  check(a === 'EC_Tracking_待貼入_2026-09-29-1453.xlsx');
  const b = makeCtx('2026-09-29T15:07:59').nextStaging8Filename();
  check(b === 'EC_Tracking_待貼入_2026-09-29-1507.xlsx');
  check(a !== b);
  // 個位數月、日、時、分補零
  check(makeCtx('2026-01-05T08:04:00').nextStaging8Filename() === 'EC_Tracking_待貼入_2026-01-05-0804.xlsx');

  console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if (require.main === module) run();
