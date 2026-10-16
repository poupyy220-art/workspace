# PN 申請匯入草稿

RD 檔案只在瀏覽器本機處理。`remote-store.js` 只用於取得固定範本與代碼表，存取碼與 CSP 行為不得被本機版本覆蓋。

## 維護邊界
- `rules.js`：純資料規則、來源列對應與補值紀錄。
- `ui.js`：缺漏欄位面板與確認紀錄組合；同次套用先驗證完整紀錄再寫入。
- `app.js`：讀檔、檢查、結果失效與下載；換來源檔須清除前一檔確認。
- `xlsx-io.js`／`check-report.js`：既有範本與報表封裝。本次未改。
- 本機技能與網站的規則應一致；`app.js`、`ui.js`、`index.html` 有本機固定資料夾／網站存取碼的刻意差異，禁止直接整包覆蓋。

## v2.17.1
群組表頭印有 OLD 時可辨識 NEW／OLD／替代，其他已知欄名不當作狀態欄。替代比照 OLD 檢查並保留原字樣。

市場分類、產品分類、細項產品別及規格缺漏可明確補值。全選不自動填值或允許留白；分類順序為市場分類／產品分類／細項產品別。現有值不覆蓋。有阻擋仍不開放正式匯入草稿下載。

## 測試
規則、介面、存取碼、報表與備註定位回歸位於 `tests/pn-import-*-regression.cjs`。

瀏覽器測試 `tests/pn-import-sidecar-browser-regression.cjs` 只建立虛構資料，須可用的 Node Playwright、ExcelJS、Microsoft Edge 與 Python openpyxl。可用 `NODE_PATH` 指向既有 Node 套件，`PN_TEST_PYTHON` 指定 Python 執行檔。不需要真實檔案或存取碼；外部請求全部阻擋。

發布前依根目錄 RELEASE_CHECKLIST.md 核對。PR 合併與正式站驗收完成前，不宣稱已部署。
