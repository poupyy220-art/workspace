# 料號管理中心

正式網站：https://poupyy220-art.github.io/workspace/

## 正式來源

- 首頁與既有工具：`index.html`
- BOM 轉檔與安檢：`modules/bom-validator/`
- Cloudflare 預覽部署：`wrangler.jsonc`
- 自動部署設定：`.github/workflows/deploy.yml`

`PN_Management_Dashboard_v2_8.html` 是歷史保留檔，不是正式首頁。功能或版本更新不得只修改此檔；正式網站一律以 `index.html` 為準。

## 版本更新必要項目

每次正式上線必須同步維護：

1. `index.html` 的頁面版本、側欄版本及右上角版本。
2. 首頁「最新更新」小卡與歷史版本紀錄。
3. 內建測試清單的版本與新增功能測試項目。
4. GitHub Actions 的觸發路徑與正式資產白名單。
5. 上線後的正式站驗收紀錄與 commit SHA。

## BOM 模組原則

- BOM 全程於瀏覽器本機處理，不得上傳伺服器或 AI。
- Python `convert_multi_sheets.py` 為既有 Business Rule Baseline。
- 原始分頁保留原格式，只有系統修改或標記的儲存格套用規定樣式。
- 新增的「異常檢測報告」分頁全面使用統一樣式。
- Web 與 Python／Golden Sample 不一致時，必須停止上線並先完成差異覆核。

## 測試

開發用依賴安裝完成後，可執行：

```text
pnpm test:bom -- <input.xlsx> <python-output.xlsx>
```

其他回歸工具位於 `tests/`，測試輸出檔不得提交至 repository 或發布至正式網站。
