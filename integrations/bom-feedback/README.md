# BOM 問題回饋整合

## 資料流

`BOM 網頁 → Apps Script Web App → BOM Feedback Google Sheet＋私人 Google Drive 圖片資料夾 → 維護人員通知信`

## 隱私與防護

- 僅接受問題類型、分頁／列號、問題描述及選填圖片，不接受 Excel 或 BOM 檔案。
- 圖片可由剪貼簿貼上或選擇 PNG／JPG／WebP；最多 3 張，每張處理後 2 MB、合計 5 MB。
- 網頁先重新編碼圖片，移除原始檔名及中繼資料；伺服端再驗證 MIME、檔案簽章與實際解碼容量。
- 圖片存入未公開的 Google Drive 資料夾，Sheet 只記錄私人連結與數量。
- 使用者必須主動勾選同意。
- 固定問題類型及欄位長度均由伺服端再次驗證。
- 隱藏欄位阻擋一般自動填表程式。
- 相同內容五分鐘內不得重複送出。
- 預設每日上限 30 筆，可由 Script Property `FEEDBACK_DAILY_LIMIT` 調整。
- 圖片每日合計預設上限 30 MB，可由 Script Property `FEEDBACK_DAILY_IMAGE_MB` 調整。
- Google Sheet 共用權限不因 Web App 開放呼叫而改變。
- Apps Script 的 Drive OAuth 無法限制到單一資料夾。部署擁有者必須授予 Drive 寫入權限；程式本身只會使用 `FEEDBACK_IMAGE_FOLDER_ID` 指定的私人資料夾，請勿移除這項程式端限制。

## Apps Script Properties

- `SPREADSHEET_ID`：回饋 Google Sheet ID。
- `NOTIFY_EMAIL`：回饋通知信箱。
- `FEEDBACK_IMAGE_FOLDER_ID`：私人圖片資料夾 ID；只有附圖時才需要。
- `FEEDBACK_DAILY_LIMIT`：選填，預設 30。
- `FEEDBACK_DAILY_IMAGE_MB`：選填，預設 30。

不得把電子郵件或其他機密資料直接寫入 Repository。

## 發布

Apps Script 以擁有者身分執行，Web App 呼叫權限設定為「所有人」。啟用圖片前，先在 Apps Script 編輯器執行 `authorizeFeedbackImageStorage`，完成 Drive 授權及私人資料夾寫入檢查。正式網站只有在實際完成 Drive 建檔、Sheet 寫入與寄信測試後，才可將 `feedback-config.js` 的 `enabled` 設為 `true`。
