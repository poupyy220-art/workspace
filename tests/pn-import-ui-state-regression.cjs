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
// 介面補值清單：市場分類／產品分類／細項產品別／規格缺漏依頁籤＋列號分組；只認「請 RD 補齊明細」或規格的留白確認提示
const fillDetails=JSON.stringify({issues:[
 {sheet:'虛構BOM',row:3,field:'產品分類',reason:'請 RD 補齊明細'},
 {sheet:'虛構BOM',row:3,field:'細項產品別',reason:'請 RD 補齊明細'},
 {sheet:'虛構BOM',row:3,field:'市場分類',reason:'請 RD 補齊明細'},
 {sheet:'虛構BOM',row:5,field:'規格',reason:'請 RD 補齊；如允許留白，需提供此列的 RD 確認紀錄'},
 {sheet:'虛構BOM',row:7,field:'規格',reason:'長度超過30，請 RD 修改'},
 {sheet:'虛構BOM',row:9,field:'市場分類',reason:'NEW 預設補值驗證失敗，停止放行'},
]});
assert.equal(JSON.stringify(ui.fillCandidates(fillDetails)),JSON.stringify([
 {sheet:'虛構BOM',row:3,fields:['產品分類','細項產品別','市場分類']},
 {sheet:'虛構BOM',row:5,fields:['規格']},
]));
assert.equal(ui.fillCandidates('').length,0);
assert.equal(ui.CLASSIFY_PRESETS.length,5);assert.equal(JSON.stringify(ui.CLASSIFY_PRESETS[4]),JSON.stringify({產品分類:'SY',細項產品別:'CDU',市場分類:'SER'}));
// 介面補值紀錄組合：同頁同列同欄位以新的為準、必填檢查、既有格式錯誤不覆蓋
const mergedFills=JSON.parse(ui.buildFieldFills('[{"sheet":"A","row":1,"field":"規格","value":"舊","who":"舊"}]',[{sheet:'A',row:1,field:'規格',value:'12V'},{sheet:'B',row:2,field:'市場分類',value:'SY'}],'王小明 10/13'));
assert.equal(JSON.stringify(mergedFills),JSON.stringify([{sheet:'A',row:1,field:'規格',value:'12V',who:'王小明 10/13'},{sheet:'B',row:2,field:'市場分類',value:'SY',who:'王小明 10/13'}]));
assert.throws(()=>ui.buildFieldFills('',[],'王小明'),/至少勾選/);
assert.throws(()=>ui.buildFieldFills('',[{sheet:'A',row:1,field:'規格',value:'X'}],' '),/確認人與日期/);
assert.throws(()=>ui.buildFieldFills('不是JSON',[{sheet:'A',row:1,field:'規格',value:'X'}],'王小明'),/格式有誤/);
console.log('PASS '+(cases.length+7+8)+'：介面狀態顏色依文字判斷、規格空白清單與確認紀錄組合、介面補值清單與紀錄組合');
