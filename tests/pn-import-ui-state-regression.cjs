// 介面狀態顏色判斷（scripts/ui.js classify）：用 app.js 實際會出現的狀態文字逐一驗證
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(__dirname+'/../modules/pn-import/scripts/ui.js','utf8'),ctx);
const c=t=>vm.runInContext('PnBomUi.classify',ctx)(t);
const cases=[
 ['檢查完成，請人工覆核後下載。 自動處理 3 處。','ok'],
 ['已下載匯入草稿。請用 Excel 抽查後，再由你操作公司系統。','ok'],
 ['已送出異常檢查與補值報表下載，請確認瀏覽器下載結果。規則檢查通過，仍需人工覆核。','ok'],
 ['異常檢查與補值報表產生失敗：XML 無法解析','blocked'],
 ['尚有 1 項阻擋問題，正式匯入表暫停下載。 自動處理 19 處。','blocked'],
 ['已送出異常檢查與補值報表下載，請確認瀏覽器下載結果。仍有 2 項阻擋問題；匯入草稿仍被阻擋。','blocked'],
 ['匯入範本欄位不符：C，停止避免錯欄','blocked'],
 ['請連接固定資料夾，或選擇匯入範本與代碼表','warn'],
 ['資料或選項已變更，請重新檢查。','warn'],
 ['等待選擇檔案。','']
];
for(const [t,want] of cases)assert.equal(c(t),want,t);
// 規格空白清單：只列「規格＋需 RD 確認紀錄」的阻擋，同頁同列去重；明細不是 JSON 時回空
const ui=vm.runInContext('PnBomUi',ctx);
const details=JSON.stringify({issues:[{sheet:'BOM格式',row:10,field:'規格',reason:'請 RD 補齊；如允許留白，需提供此列的 RD 確認紀錄'},{sheet:'BOM格式',row:10,field:'規格',reason:'請 RD 補齊；如允許留白，需提供此列的 RD 確認紀錄'},{sheet:'BOM格式',row:11,field:'英文品名',reason:'請 RD 補齊明細'},{sheet:'BOM格式',row:12,field:'規格',reason:'長度超過30，請 RD 修改'}]});
assert.equal(JSON.stringify(ui.specCandidates(details)),JSON.stringify([{sheet:'BOM格式',row:10}]));
assert.equal(ui.specCandidates('').length,0);
// 確認紀錄組合：併入既有、同頁同列以新的為準、必填檢查、既有格式錯誤不覆蓋
const merged=JSON.parse(ui.buildApprovals('[{"sheet":"A","row":3,"note":"舊"},{"sheet":"BOM格式","row":10,"note":"舊"}]',[{sheet:'BOM格式',row:10}],'王小明 10/07'));
assert.equal(JSON.stringify(merged),JSON.stringify([{sheet:'A',row:3,note:'舊'},{sheet:'BOM格式',row:10,note:'王小明 10/07'}]));
assert.throws(()=>ui.buildApprovals('',[],'王小明'),/至少勾選/);
assert.throws(()=>ui.buildApprovals('',[{sheet:'A',row:1}],'  '),/確認人與日期/);
assert.throws(()=>ui.buildApprovals('不是JSON',[{sheet:'A',row:1}],'王小明'),/格式有誤/);
console.log('PASS '+(cases.length+7)+'：介面狀態顏色依文字判斷、規格空白清單與確認紀錄組合');
