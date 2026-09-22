// 回歸案例：分群碼／單位／來源碼／特殊料件特性等代碼欄位若填簡體字，
// 轉碼前需先簡轉繁才能命中代碼表；同時要確保這個修正不會破壞既有繁體字
// 內容（尤其 OpenCC 會把「台」正規化成「臺」，可能讓原本用「台」的代碼表
// 鍵值比對失敗）。全部使用內建合成資料，不依賴任何外部真實 BOM 檔案。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.ExcelJS = require('exceljs');
global.JSZip = require('jszip');
global.window = global;

for (const file of ['vendor/opencc-js/cn2t.js', 'bom-rules.js', 'workbook-io.js', 'bom-engine.js']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'bom-validator', ...file.split('/')), 'utf8');
  vm.runInThisContext(source, { filename: file });
}

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BOM格式');
  ws.getRow(2).values = ['状态', '', 'Item Level', '', '', '', '', '', '', '', '', '', '', '料号', '英文品名', '繁中品名', '简中品名', '越南品名', '规格', '分群码', '来源码', '采购类型', '用量', '主件底数', '单位', '特殊料件\n特性'];
  // row3：簡體分群碼／單位（對應真實使用者回報案例：「3:材料阶」「片/支/个」）
  ws.getRow(3).values = ['', '', 1, '', '', '', '', '', '', '', '', '', '', '', 'ABC', 'en', 'zf', 'zh', 'vi', 'SPEC1', '3:材料阶', 'P:採購', 'ODM', 1, 1, '片/支/个', '一般'];
  // row4：既有繁體字內容，修正後應維持原本就正確的結果
  ws.getRow(4).values = ['', '', 1, '', '', '', '', '', '', '', '', '', '', '', 'DEF', 'en2', 'zf2', 'zh2', 'vi2', 'SPEC2', '3:材料階', 'P:採購', 'ODM', 1, 1, '片/支/個', '一般'];
  // row5：既有繁體字「個/台/套/條」（用「台」），驗證不會被 OpenCC 台->臺 正規化破壞
  ws.getRow(5).values = ['', '', 1, '', '', '', '', '', '', '', '', '', '', '', 'GHI', 'en3', 'zf3', 'zh3', 'vi3', 'SPEC3', '3:材料階', 'P:採購', 'ODM', 1, 1, '個/台/套/條', '一般'];
  // row6：簡體「个/台/套/条」，已知殘留限制（見下方 assertion 說明），engine 必須安全跳過、不可覆寫成錯誤內容
  ws.getRow(6).values = ['', '', 1, '', '', '', '', '', '', '', '', '', '', '', 'JKL', 'en4', 'zf4', 'zh4', 'vi4', 'SPEC4', '3:材料階', 'P:採購', 'ODM', 1, 1, '个/台/套/条', '一般'];

  const result = BomEngine.processWorkbook(wb);
  const cell = (row, col) => ws.getCell(row, col).value;

  const assertions = {
    row3GroupCodeSimplifiedConverted: cell(3, 21) === '3',
    row3UnitSimplifiedConverted: cell(3, 26) === 'PCS',
    row3SourceCodeConverted: cell(3, 22) === 'P',
    row3SpecialPropertyConverted: cell(3, 27) === 'GE',
    row4TraditionalUnaffected: cell(4, 21) === '3' && cell(4, 26) === 'PCS' && cell(4, 22) === 'P' && cell(4, 27) === 'GE',
    row5ExistingTaiUnitStillConverted: cell(5, 26) === 'EA',
    row6KnownGapSafelySkipped: cell(6, 26) === '个/台/套/条',
    // 純字串斷言：舊有格式相容規則（描述、全形冒號、漏冒號、非法前綴、未知說明）不受影響
    descriptionOnlyRule: BomRules.convertCode('成品階') === '1',
    fullwidthColonRule: BomRules.convertCode('M：自製') === 'M',
    missingColonRule: BomRules.convertCode('3材料階') === '3',
    invalidPrefixPreserved: BomRules.convertCode('ABC:一般') === 'ABC:一般',
    unknownDescriptionPreserved: BomRules.convertCode('M:未知說明') === 'M:未知說明',
    reportCreated: !!wb.getWorksheet('【異常檢測報告】'),
    itemCountMatches: result.itemCount === 4,
  };

  console.log(JSON.stringify({ assertions }, null, 2));
  console.log('已知限制：單位描述若用簡體「个/台/套/条」，因 OpenCC 固定把「台」轉成「臺」而跟代碼表的「台」鍵值對不上，' +
    '目前仍無法自動轉換；engine 會安全保留原值不覆寫，不會產生錯誤內容。');
  if (Object.values(assertions).some(value => !value)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exit(1); });
