# Repository instructions

## 每次開始工作前

只要任務涉及此 repository 的功能修改、版本更新、測試、GitHub、通知或部署，必須先完整閱讀根目錄的 `RELEASE_CHECKLIST.md`，並在工作進度中明確說明已讀取。

不得只依賴聊天室記憶或上一輪摘要。若 `RELEASE_CHECKLIST.md` 與使用者本次明確指示衝突，以使用者本次指示為準，並同步更新 checklist，避免下次再次遺漏。

## BOM Business Rule

- `convert_multi_sheets.py` 是 BOM 轉檔／安檢 Business Rule baseline，不是參考範例。
- 未經使用者明確確認，不得新增、刪除、簡化或重新解讀 Business Rule。
- 正式 BOM 原則上只掃描頁籤色為 `#00B050` 或 `#92D050` 的工作表。
- `BOM格式` 是既有例外：即使沒有綠色頁籤，只要有實際 PN／Level 資料仍要掃描；空白範本不掃描。
- 原始 BOM 必須在瀏覽器本機處理，不得上傳伺服器或 AI。

## 發布要求

- 不得只更新功能而漏掉首頁版本、最新更新小卡、歷史版本、測試清單、BOM SOP 或快取版本。
- 未完成 `RELEASE_CHECKLIST.md` 的必要驗證，不得宣稱可以正式發布。
- GitHub 暫存、commit、push、PR、merge 與部署，必須遵守工具規範並取得使用者明確授權。
