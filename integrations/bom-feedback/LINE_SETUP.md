# LINE Debug 小幫手：設定步驟與排查

## 資料流

`LINE 工作群組「#回報」→ Apps Script（Line.gs）→ BOM Feedback Sheet＋私人 Drive → AI 分流修復 → 維護者核准 → Apps Script 推回 LINE 群組`

- 只記錄 `#回報`（或全形 `＃回報`）開頭的訊息，以及同一人 10 分鐘內接著貼的截圖（最多 3 張）。
- 一般聊天、其他人貼的圖、其他群組：不回覆、不記錄。
- 回報沒寫到工具時，機器人會追問一次。
- 合併標題含 `[F024]` 的 PR 後約 5–15 分鐘，機器人自動通知同事；同事回「F024 OK」才結案。
- 不需要修 PR 的回覆（例如操作說明）：在 Sheet「給同事的回覆」欄寫內容，「回覆狀態」改成 `核准發送`，10 分鐘內送出。

## Sheet 欄位（BOM Feedback 分頁，第 4 列標題）

| 欄 | 內容 | LINE 回報時 |
|---|---|---|
| A | 編號 | `F001` 起跳 |
| E | 位置 | `工具：BOM 轉檔與安檢` |
| G | 處理狀態（下拉選項） | 新回饋 → 處理中（PR 合併）→ 已解決（同事回 OK）；不處理由你手動選 |
| K | 來源 | `LINE` |
| L／M | 圖片連結／數量 | 私人 Drive 連結 |
| N | LINE 群組 | 群組 ID（推送回覆用） |
| O | 給同事的回覆 | 你寫或 PR 自動帶入 |
| P | 回覆狀態 | 手動回覆：`核准發送` → `已發送`；修好通知：`修好待通知` → `修好已通知` → `同事已確認`；失敗為 `發送失敗` |
| Q | 回覆時間 | 自動 |

## 一次性設定（標「你」的步驟需要本人登入操作）

1. **你：建立 LINE 官方帳號並啟用 Messaging API。** 到 LINE Official Account Manager 建立新的工作用官方帳號（例如「Debug 小幫手」），再到「設定 → Messaging API」按啟用。不要沿用家庭用的機器人。官方介面若有變動，以 LINE 當下畫面為準。
2. **你：官方帳號設定。**
   - 「帳號設定」→ 允許「加入群組或多人聊天室」。
   - 「回應設定」→ 關閉「自動回應訊息」與「加入好友的歡迎訊息」，開啟「Webhook」。
3. **你：發行 token。** LINE Developers Console → 這個 channel →「Messaging API」分頁 → Channel access token（long-lived）按 Issue，複製起來。
4. **你：更新 Apps Script。** 打開目前 BOM 回饋用的 Apps Script 專案（網站 `feedback-config.js` 裡那個網址所屬的專案）：
   - 新增檔案 `Line.gs`，貼上本資料夾的 `Line.gs` 全文。
   - **不要整份取代 `Code.gs`**（線上版可能與 repo 不同步）。只在 `doPost` 的 `const payload = parsePayload_(e);` 下一行加入：
     `if (Array.isArray(payload.events)) return handleLineWebhook_(e, payload);`
5. **你：指令碼屬性。** 專案設定 → 指令碼屬性，新增：
   - `LINE_CHANNEL_ACCESS_TOKEN` = 第 3 步的 token
   - `LINE_SETUP_MODE` = `true`（第 9 步完成後刪除）
6. **你：重新部署同一個網址。** 部署 → 管理部署 → 編輯（鉛筆）→ 版本選「新版本」→ 部署。**不要按「新增部署」**，否則網址會變，網站的回饋按鈕會失效。
7. **你：在編輯器依序執行兩個函式**（上方下拉選單選函式 → 執行）：
   - `checkLineSetup`：第一次會要求授權「連線到外部服務」，同意後應顯示「LINE 機器人「Debug 小幫手」連線正常」。
   - 先執行 `setupLineWebhookKey`：自動產生暗號並在執行紀錄顯示 `k=` 後的暗號（不要截圖）。Webhook URL ＝「管理部署作業」裡結尾 `/exec` 的網址＋`?k=暗號`；**不要用 `/dev` 網址**，LINE 連不進去。
   - 再執行 `checkLineSetup` 確認 token 與暗號。
8. **你：LINE Developers Console →「Messaging API」分頁 → Webhook URL** 貼上第 7 步的網址，打開「Use webhook」。按「Verify」若顯示錯誤，先別急，直接做第 9 步實測。
9. **一起：測試群組。** 建一個只有你（和一位願意幫忙的同事）的 LINE 群組，把機器人拉進去，輸入 `#群組ID`，機器人會回群組 ID。把 ID 填進指令碼屬性 `LINE_GROUP_IDS`，然後**刪除** `LINE_SETUP_MODE`。
10. **一起：實測。** 在測試群組依序試：
    - 打「中午吃什麼」→ 機器人不應回應。
    - 打「#回報 按下去沒有反應」→ 應回「收到 F001」並追問工具；回「出勤表」→ 應回「已補上」。
    - 貼一張無敏感資訊的截圖 → 應回「已附上第 1 張截圖」；Sheet 有連結。
    - 在 Sheet 的 O 欄寫「測試回覆」、P 欄改 `核准發送` → 執行 `processLineOutbox` → 群組收到「F001：測試回覆」。
11. **你：執行 `setupLineTriggers`**，建立每 10 分鐘自動送出回覆的排程。
12. **你：正式群組。**（只用一個機器人：Apps Script 只存一組 token，兩個官方帳號不能同時接同一個 Webhook） 把機器人拉進工作群組 → 輸入 `#群組ID`（需暫時把 `LINE_SETUP_MODE` 改回 `true`）→ 把正式群組 ID 用逗號加到 `LINE_GROUP_IDS` → 再刪除 `LINE_SETUP_MODE`。在群組公告：「Debug 小幫手只記錄 #回報 開頭的訊息，一般聊天不會記錄」。

## 機器人沒反應時，依序檢查 3 個地方

1. **Apps Script →「執行項目」**：有沒有 `doPost` 紀錄？有紅色錯誤就看訊息。
   - 完全沒有紀錄 → LINE 後台 Webhook 沒開、網址貼錯，或第 6 步部署成新網址。
2. **指令碼屬性**：`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_WEBHOOK_KEY`、`LINE_GROUP_IDS` 三個都在嗎？群組 ID 有沒有多餘空白？
3. **LINE 官方帳號「回應設定」**：Webhook 是否開啟、自動回應是否關閉（沒關的話會出現制式罐頭訊息）。

## 限制與注意

- Apps Script 讀不到 LINE 的簽章 header，因此以「網址暗號＋群組白名單」防假訊息；暗號外洩時刪掉 `LINE_WEBHOOK_KEY`，重新執行 `setupLineWebhookKey`，並更新 LINE 後台網址。
- 主動推送（修好通知）會用到 LINE 官方帳號的每月免費訊息額度，發到群組可能依人數計算；回覆「收到」使用 reply，不算額度。實際額度以 LINE 官方方案為準。
- Repository 是公開的：token、暗號、群組 ID 只放指令碼屬性。PR 的 `line-reply` 區塊會公開，只寫一般性原因，不寫料號、客戶、檔名或同事原文。
- 截圖存入 `FEEDBACK_IMAGE_FOLDER_ID` 私人資料夾，與網站回饋共用每日上限。
