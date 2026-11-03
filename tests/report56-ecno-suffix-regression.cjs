// 2026-11-03（主人回報）：5️⃣/6️⃣ 合併報表的 EC No 要跟 8️⃣ 待貼入一致——依「檔名」把 0012/0013 系列
// 補單字母尾碼（0013221166 → 0013221166_A）、POR 補尾碼。規則與 8️⃣ parseFlatfileObjRows8 完全一致，
// 且只在「欄位值 + _」正好是檔名前綴時才升級（防誤配）。2000/4000 系列不補。
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path');
const pn = fs.readFileSync(path.join(__dirname, '../modules/pn-report/index.html'), 'utf8').replace(/\r\n/g, '\n');
const ex = (n) => { const s = pn.search(new RegExp('    function ' + n + '\\(')); const e = pn.indexOf('\n    }', s) + 6; return pn.slice(s, e); };
const ctx = {}; vm.createContext(ctx);
vm.runInContext(ex('ecNoFromFilename'), ctx);
const ec = ctx.ecNoFromFilename;
let n = 0; const check = (v, m) => { assert(v, m); n++; };

const F = '0013221166_A_LBG AVC DT_FLATFILE.csv';
check(ec('0013221166', F) === '0013221166_A', '0013 系列補 _A');
check(ec('0012345678', '0012345678_B_LBG.csv') === '0012345678_B', '0012 系列補 _B');
check(ec('11189498POR', '11189498POR_W_x.csv') === '11189498POR_W', 'POR 補尾碼');
check(ec('0011970548POR', '0011970548POR_U_x.csv') === '0011970548POR_U', 'POR 單字母尾碼');
check(ec('4000111', '4000111_A_x.csv') === '4000111', '2000/4000 系列不補');
check(ec('2000222', '2000222_C_x.csv') === '2000222', '2000 系列不補');
check(ec('0013221166', '0013999999_A_x.csv') === '0013221166', '防誤配：欄位≠檔名前綴不升級');
check(ec('0013221166', 'randomname.csv') === '0013221166', '檔名無尾碼不升級');
check(ec(' 0013221166 ', F) === '0013221166_A', '前後空白照樣升級');
check(ec('0013221166_A', F) === '0013221166_A', '已含尾碼不重複（欄位值即原樣，不符 raw+_ 前綴規則）');
check(ec('', F) === '' && ec(null, F) === '', '空值安全');
check(ec('CTO_ABC', 'CTO_ABC_x.csv') === 'CTO_ABC', 'CTO 不受影響');

// 確認 readAndMergeCSVs 真的有接 ecNoFromFilename（5️⃣/6️⃣/7️⃣ 共用的解析）
check(/cells\[ecIdx\]\s*=\s*ecNoFromFilename\(cells\[ecIdx\],\s*f\[i\]\.name\)/.test(pn), 'readAndMergeCSVs 已套用 ecNoFromFilename');

console.log(`PASS ${n}; FAIL 0`);
