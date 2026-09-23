/**
 * LINE 群組回報入口 — 與 Code.gs 放在同一個 Apps Script 專案
 *
 * 流程：同事在 LINE 工作群組打「#回報 問題描述」→ 記錄到 BOM Feedback Sheet →
 *       AI 分流／修復 → 維護者核准 → processLineOutbox 把回覆推回群組。
 *
 * Required Script Properties（只放在 Apps Script「指令碼屬性」，不得寫進 Repository）:
 *   LINE_CHANNEL_ACCESS_TOKEN  LINE Messaging API 長期 channel access token
 *   LINE_WEBHOOK_KEY           Webhook 網址暗號；LINE 後台網址需帶 ?k=<同一值>
 *   LINE_GROUP_IDS             允許的群組 ID，逗號分隔；其他來源一律忽略
 * Optional:
 *   LINE_SETUP_MODE            'true' 時，未登記群組輸入「#群組ID」會回覆該群組 ID；設定完請刪除
 *   LINE_GITHUB_REPO           預設 poupyy220-art/workspace；合併的 PR 標題含 [F024] 會觸發通知
 *
 * Apps Script 讀不到 X-Line-Signature header，因此以「網址暗號＋群組白名單」代替簽章驗證。
 */

const LINE_REPORT_PREFIX = /^[#＃]\s*回報\s*/;
const LINE_CLOSE_PATTERN = /^[#＃]?\s*(F\d{3,})\s*(ok|好了|可以了|沒問題)/i;
const LINE_PENDING_SECONDS = 600;
const LINE_MAX_IMAGES = 3;
const LINE_COLUMNS = { status: 7, source: 11, imageLinks: 12, imageCount: 13, group: 14, reply: 15, replyStatus: 16, replyTime: 17 };
// 由具體到籠統排序：先比對專有名稱，最後才用 bom、pn 這種常見字
const LINE_TOOLS = [
  { name: 'PIM 合併', keys: ['pim'] },
  { name: 'SPB vs L10', keys: ['spb vs', 'l10'] },
  { name: 'EC 受限制物料分析器', keys: ['ec 受限', 'ec受限', '受限制'] },
  { name: 'CTO EDI 新專案維護', keys: ['cto', 'edi', '棧板'] },
  { name: 'BOM 轉檔與安檢', keys: ['bom 轉檔', 'bom轉檔', '安檢', '轉檔', 'bom'] },
  { name: 'MTM 國別查詢', keys: ['mtm', '國別查詢'] },
  { name: '國別 DB 維護', keys: ['國別 db', '國別db'] },
  { name: '萬用專案查詢', keys: ['萬用', '專案查詢'] },
  { name: '出勤表自動填寫', keys: ['出勤'] },
  { name: 'SOP 知識庫', keys: ['sop'] },
  { name: 'PN 工具', keys: ['pn', '料號查詢'] }
];

// ---------- Webhook 入口（由 Code.gs 的 doPost 轉進來） ----------

function handleLineWebhook_(e, payload) {
  // 暗號不對就當作沒看到，不透露任何資訊
  const key = e && e.parameter ? String(e.parameter.k || '') : '';
  const expected = PropertiesService.getScriptProperties().getProperty('LINE_WEBHOOK_KEY');
  if (!expected || key !== expected) return json_({ ok: true });

  payload.events.forEach(function (event) {
    try {
      handleLineEvent_(event);
    } catch (error) {
      console.error(error);
      if (event.replyToken) lineReply_(event.replyToken, '系統暫時無法記錄，請稍後再試，或直接私訊維護人員。');
    }
  });
  return json_({ ok: true });
}

function handleLineEvent_(event) {
  const source = event.source || {};
  if (source.type !== 'group' || !source.groupId) return;
  const groupId = source.groupId;

  if (!isAllowedLineGroup_(groupId)) {
    // 設定期間才回覆群組 ID，方便填入 LINE_GROUP_IDS
    const setupMode = PropertiesService.getScriptProperties().getProperty('LINE_SETUP_MODE') === 'true';
    const text = event.message && event.message.type === 'text' ? event.message.text.trim() : '';
    if (setupMode && text === '#群組ID') lineReply_(event.replyToken, `這個群組的 ID：\n${groupId}\n請填入 Apps Script 的 LINE_GROUP_IDS。`);
    return;
  }

  if (event.type === 'join') {
    lineReply_(event.replyToken, '大家好，我是 Debug 小幫手 🤖\n網站有問題時，訊息開頭打「#回報」再寫問題，可以接著貼截圖。\n一般聊天我不會回、也不會記錄。');
    return;
  }
  if (event.type !== 'message' || !event.message) return;

  const userId = source.userId || 'unknown';
  if (event.message.type === 'text') handleLineText_(event, groupId, userId, event.message.text || '');
  else if (event.message.type === 'image') handleLineImage_(event, groupId, userId);
}

function handleLineText_(event, groupId, userId, rawText) {
  const text = String(rawText).trim();

  if (LINE_REPORT_PREFIX.test(text)) {
    createLineReport_(event, groupId, userId, text.replace(LINE_REPORT_PREFIX, ''));
    return;
  }

  const closeMatch = text.match(LINE_CLOSE_PATTERN);
  if (closeMatch) {
    closeLineReport_(event, groupId, closeMatch[1].toUpperCase());
    return;
  }

  // 剛回報、機器人追問「哪一個工具」時，下一句當作回答
  const pending = getLinePending_(groupId, userId);
  if (pending && pending.needTool) {
    const tool = detectLineTool_(text);
    if (!tool) return;
    updateLineReportCell_(pending.id, 5, `工具：${tool}`);
    pending.needTool = false;
    putLinePending_(groupId, userId, pending);
    lineReply_(event.replyToken, `好的，${pending.id} 已補上工具：${tool}。處理中，修好會在這裡通知 🔧`);
  }
  // 其他一般聊天：不回覆、不記錄
}

// ---------- 建立回報 ----------

function createLineReport_(event, groupId, userId, description) {
  if (!description) {
    lineReply_(event.replyToken, '請在「#回報」後面寫問題，例如：\n#回報 BOM 轉檔後第 35 列品名變亂碼');
    return;
  }
  let safeDescription;
  try {
    safeDescription = safeText_(description, 1000, true);
  } catch (lengthError) {
    lineReply_(event.replyToken, '問題描述超過 1000 字，請精簡後再回報一次。');
    return;
  }

  const tool = detectLineTool_(safeDescription);
  const now = new Date();
  let reportId = '';

  try {
    withLock_(function () {
      const guard = checkFeedbackGuard_('LINE', groupId, safeDescription, 0, now);
      reportId = nextLineReportId_();
      const sheet = getSheet_(FEEDBACK_SHEET);
      ensureLineHeaders_(sheet);
      const row = [
        // LINE 不知道同事實際使用的網站版本，模組版本欄留空避免誤導
        reportId, now, '', 'LINE 回報', sheetText_(tool ? `工具：${tool}` : '工具：待確認'),
        sheetText_(safeDescription), '新回饋', '', '', '', 'LINE', '', 0, groupId, '', '', ''
      ];
      sheet.appendRow(row);
      commitFeedbackGuard_(guard);
    });
  } catch (guardError) {
    const message = String(guardError.message || guardError);
    if (/Duplicate/.test(message)) lineReply_(event.replyToken, '這個問題 5 分鐘內已經回報過了，不用重複送 👍');
    else if (/Daily/.test(message)) lineReply_(event.replyToken, '今天的回報數量已達上限，請直接私訊維護人員。');
    else throw guardError;
    return;
  }

  putLinePending_(groupId, userId, { id: reportId, needTool: !tool, images: 0 });
  notifyLineReport_(reportId, now, tool, safeDescription);

  const ask = tool ? '' : '\n請問是哪一個工具？直接回名稱即可，例如：BOM 轉檔、PN、EC 受限制、出勤表';
  lineReply_(event.replyToken, `收到 ${reportId}，處理中 🔧\n有截圖的話，10 分鐘內直接貼上來即可。${ask}`);
}

function handleLineImage_(event, groupId, userId) {
  // 只收「剛打完 #回報的同一個人」接著貼的圖，一般聊天的圖不碰
  const pending = getLinePending_(groupId, userId);
  if (!pending) return;
  if (pending.images >= LINE_MAX_IMAGES) {
    lineReply_(event.replyToken, `${pending.id} 最多附 ${LINE_MAX_IMAGES} 張截圖，這張沒有記錄。`);
    return;
  }

  const image = fetchLineImage_(event.message.id);
  const imageFiles = saveFeedbackImages_(pending.id, [{ mimeType: image.mimeType, bytes: image.bytes, name: `line-image-${pending.images + 1}.${image.extension}` }]);
  withLock_(function () {
    const sheet = getSheet_(FEEDBACK_SHEET);
    const rowNumber = findFeedbackRow_(sheet, pending.id);
    if (!rowNumber) throw new Error('Report row not found');
    const linkCell = sheet.getRange(rowNumber, LINE_COLUMNS.imageLinks);
    const links = String(linkCell.getValue() || '');
    linkCell.setValue(links ? `${links}\n${imageFiles[0].url}` : imageFiles[0].url);
    sheet.getRange(rowNumber, LINE_COLUMNS.imageCount).setValue(pending.images + 1);
  });

  pending.images += 1;
  putLinePending_(groupId, userId, pending);
  lineReply_(event.replyToken, `📎 ${pending.id} 已附上第 ${pending.images} 張截圖`);
}

function fetchLineImage_(messageId) {
  const response = UrlFetchApp.fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: `Bearer ${requiredProperty_('LINE_CHANNEL_ACCESS_TOKEN')}` },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error(`LINE content fetch failed: ${response.getResponseCode()}`);
  const blob = response.getBlob();
  const mimeType = String(blob.getContentType() || '').toLowerCase();
  if (FEEDBACK_IMAGE_TYPES.indexOf(mimeType) < 0) throw new Error('Unsupported image type');
  const bytes = blob.getBytes();
  if (!bytes.length || bytes.length > FEEDBACK_MAX_IMAGE_BYTES) throw new Error('Image exceeds size limit');
  if (!matchesImageSignature_(bytes, mimeType)) throw new Error('Image content does not match type');
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return { mimeType: mimeType, bytes: bytes, extension: extension };
}

// ---------- 結案 ----------

function closeLineReport_(event, groupId, reportId) {
  const result = withLock_(function () {
    const sheet = getSheet_(FEEDBACK_SHEET);
    const rowNumber = findFeedbackRow_(sheet, reportId);
    if (!rowNumber) return 'missing';
    const row = sheet.getRange(rowNumber, 1, 1, LINE_COLUMNS.replyTime).getValues()[0];
    if (String(row[LINE_COLUMNS.group - 1]) !== groupId) return 'missing';
    if (String(row[LINE_COLUMNS.status - 1]) === '已解決') return 'closed';
    if (String(row[LINE_COLUMNS.replyStatus - 1]) !== '修好已通知') return 'working';
    sheet.getRange(rowNumber, LINE_COLUMNS.status).setValue('已解決');
    sheet.getRange(rowNumber, LINE_COLUMNS.replyStatus).setValue('同事已確認');
    return 'ok';
  });
  const messages = {
    ok: `${reportId} 已結案，謝謝回報 🙏`,
    closed: `${reportId} 之前已經結案囉。`,
    working: `${reportId} 還在處理中，修好會在這裡通知。`,
    missing: `找不到 ${reportId}，請確認編號。`
  };
  lineReply_(event.replyToken, messages[result]);
}

// ---------- 定時推送（每 10 分鐘，由 setupLineTriggers 建立） ----------

/**
 * 處理狀態（G 欄）只寫 Sheet 下拉選項：新回饋／處理中／已解決／不處理；流程細節記在回覆狀態（P 欄）。
 * 1. PR 標題含 [F024] 且已合併超過 5 分鐘（等網站部署完）→ 取 PR 內文 line-reply 區塊，回覆狀態設「修好待通知」，視同核准。
 * 2. 回覆狀態 = 核准發送／修好待通知 → 推送到該群組，改為「已發送」／「修好已通知」；同事回 OK 後才改「已解決」。
 */
function processLineOutbox() {
  try { collectMergedPullRequests_(); } catch (error) { console.error(error); }
  sendApprovedLineReplies_();
}

function collectMergedPullRequests_() {
  const repo = PropertiesService.getScriptProperties().getProperty('LINE_GITHUB_REPO') || 'poupyy220-art/workspace';
  const response = UrlFetchApp.fetch(`https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=20`, {
    headers: { Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error(`GitHub API failed: ${response.getResponseCode()}`);
  const pulls = JSON.parse(response.getContentText());
  const now = Date.now();

  pulls.forEach(function (pull) {
    if (!pull.merged_at || now - new Date(pull.merged_at).getTime() < 5 * 60 * 1000) return;
    const idMatch = String(pull.title || '').match(/\[(F\d{3,})\]/);
    if (!idMatch) return;
    const reply = extractLineReply_(pull.body) || '已修好並更新網站，請重新整理後再試一次。';
    withLock_(function () {
      const sheet = getSheet_(FEEDBACK_SHEET);
      const rowNumber = findFeedbackRow_(sheet, idMatch[1]);
      if (!rowNumber) return;
      const replyStatus = String(sheet.getRange(rowNumber, LINE_COLUMNS.replyStatus).getValue());
      if (replyStatus.indexOf('修好') === 0 || replyStatus === '同事已確認') return;
      sheet.getRange(rowNumber, LINE_COLUMNS.status).setValue('處理中');
      sheet.getRange(rowNumber, LINE_COLUMNS.reply).setValue(sheetText_(`${reply}\n（PR #${pull.number}）`));
      sheet.getRange(rowNumber, LINE_COLUMNS.replyStatus).setValue('修好待通知');
    });
  });
}

function sendApprovedLineReplies_() {
  const sheet = getSheet_(FEEDBACK_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow < 5) return;
  const rows = sheet.getRange(5, 1, lastRow - 4, LINE_COLUMNS.replyTime).getValues();
  rows.forEach(function (row, index) {
    const replyStatus = String(row[LINE_COLUMNS.replyStatus - 1]);
    if (replyStatus !== '核准發送' && replyStatus !== '修好待通知') return;
    const rowNumber = index + 5;
    const reportId = String(row[0]);
    const groupId = String(row[LINE_COLUMNS.group - 1] || '');
    const reply = String(row[LINE_COLUMNS.reply - 1] || '').trim();
    if (!groupId || !reply) {
      sheet.getRange(rowNumber, LINE_COLUMNS.replyStatus).setValue(groupId ? '缺回覆內容' : '非 LINE 來源');
      return;
    }
    const fixed = replyStatus === '修好待通知';
    const tail = fixed ? `\n沒問題的話請回「${reportId} OK」` : '';
    const ok = linePush_(groupId, `${reportId}：${reply}${tail}`);
    sheet.getRange(rowNumber, LINE_COLUMNS.replyStatus).setValue(ok ? (fixed ? '修好已通知' : '已發送') : '發送失敗');
    sheet.getRange(rowNumber, LINE_COLUMNS.replyTime).setValue(new Date());
  });
}

function extractLineReply_(body) {
  const match = String(body || '').match(/<!--\s*line-reply\s*-->([\s\S]*?)<!--\s*\/line-reply\s*-->/);
  return match ? match[1].trim().slice(0, 500) : '';
}

// ---------- 一次性設定（在 Apps Script 編輯器手動執行） ----------

/**
 * 產生網址暗號並回傳要貼到 LINE 後台的 Webhook URL；已有暗號時沿用，不會換掉。
 * 暗號只存在指令碼屬性，不需要人工複製 token 以外的任何機密。
 */
function setupLineWebhookKey() {
  const properties = PropertiesService.getScriptProperties();
  let key = properties.getProperty('LINE_WEBHOOK_KEY');
  if (!key) {
    key = `${Utilities.getUuid()}${Utilities.getUuid()}`.replace(/-/g, '');
    properties.setProperty('LINE_WEBHOOK_KEY', key);
  }
  // 從編輯器執行時 getUrl() 會回傳 /dev 測試網址，LINE 連不進去；必須用「管理部署作業」裡結尾 /exec 的正式網址
  return logSetupResult_(`暗號已建立。Webhook URL = 管理部署作業裡的網頁應用程式網址（結尾 /exec）＋ ?k=${key}\n請勿截圖或轉貼這行。`);
}

/** 建立每 10 分鐘的 processLineOutbox 觸發條件；重複執行不會重複建立。 */
function setupLineTriggers() {
  const exists = ScriptApp.getProjectTriggers().some(function (trigger) { return trigger.getHandlerFunction() === 'processLineOutbox'; });
  if (!exists) ScriptApp.newTrigger('processLineOutbox').timeBased().everyMinutes(10).create();
  return logSetupResult_(exists ? '觸發條件已存在' : '已建立每 10 分鐘的 processLineOutbox');
}

/** 授權外部連線並檢查 token 是否有效（不會發任何訊息）。 */
function checkLineSetup() {
  const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/info', {
    headers: { Authorization: `Bearer ${requiredProperty_('LINE_CHANNEL_ACCESS_TOKEN')}` },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) return logSetupResult_(`LINE token 無效：HTTP ${response.getResponseCode()}`);
  const info = JSON.parse(response.getContentText());
  if (!PropertiesService.getScriptProperties().getProperty('LINE_WEBHOOK_KEY')) {
    return logSetupResult_(`LINE 機器人「${info.displayName}」token 正常；尚未建立網址暗號，請執行 setupLineWebhookKey`);
  }
  return logSetupResult_(`LINE 機器人「${info.displayName}」連線正常；允許群組 ${String(PropertiesService.getScriptProperties().getProperty('LINE_GROUP_IDS') || '').split(',').filter(Boolean).length} 個`);
}

/** 編輯器按「執行」只顯示 console 內容，設定函式的結果要印出來才看得到。 */
function logSetupResult_(text) {
  console.log(text);
  return text;
}

// ---------- 小工具 ----------

function isAllowedLineGroup_(groupId) {
  return String(PropertiesService.getScriptProperties().getProperty('LINE_GROUP_IDS') || '')
    .split(',').map(function (value) { return value.trim(); }).filter(Boolean).indexOf(groupId) >= 0;
}

function detectLineTool_(text) {
  const lower = String(text).toLowerCase();
  for (let i = 0; i < LINE_TOOLS.length; i += 1) {
    if (LINE_TOOLS[i].keys.some(function (key) { return lower.indexOf(key) >= 0; })) return LINE_TOOLS[i].name;
  }
  return '';
}

function nextLineReportId_() {
  const properties = PropertiesService.getScriptProperties();
  const next = Number(properties.getProperty('LINE_FEEDBACK_SEQ') || 0) + 1;
  properties.setProperty('LINE_FEEDBACK_SEQ', String(next));
  return `F${String(next).padStart(3, '0')}`;
}

function findFeedbackRow_(sheet, reportId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 5) return 0;
  const ids = sheet.getRange(5, 1, lastRow - 4, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    if (String(ids[i][0]) === reportId) return i + 5;
  }
  return 0;
}

function updateLineReportCell_(reportId, column, value) {
  withLock_(function () {
    const sheet = getSheet_(FEEDBACK_SHEET);
    const rowNumber = findFeedbackRow_(sheet, reportId);
    if (rowNumber) sheet.getRange(rowNumber, column).setValue(sheetText_(value));
  });
}

function ensureLineHeaders_(sheet) {
  const headerRow = 4;
  ensureFeedbackImageHeaders_(sheet);
  if (!sheet.getRange(headerRow, LINE_COLUMNS.group).getValue()) {
    sheet.getRange(headerRow, LINE_COLUMNS.group, 1, 4).setValues([['LINE 群組', '給同事的回覆', '回覆狀態', '回覆時間']]);
  }
}

function getLinePending_(groupId, userId) {
  const raw = CacheService.getScriptCache().get(`LINE_PENDING_${groupId}_${userId}`);
  return raw ? JSON.parse(raw) : null;
}

function putLinePending_(groupId, userId, pending) {
  CacheService.getScriptCache().put(`LINE_PENDING_${groupId}_${userId}`, JSON.stringify(pending), LINE_PENDING_SECONDS);
}

function notifyLineReport_(reportId, now, tool, description) {
  try {
    MailApp.sendEmail({
      to: requiredProperty_('NOTIFY_EMAIL'),
      subject: `[LINE 回報] ${tool || '工具待確認'}｜${reportId}`,
      htmlBody: `<p><b>回報編號：</b>${escapeHtml_(reportId)}</p><p><b>時間：</b>${escapeHtml_(formatDate_(now))}</p><p><b>工具：</b>${escapeHtml_(tool || '待確認')}</p><p><b>問題：</b>${escapeHtml_(description)}</p><p>截圖會陸續寫入 Sheet 的圖片連結欄。</p>`,
      name: 'Debug 小幫手'
    });
  } catch (mailError) {
    console.error(mailError);
  }
}

function lineReply_(replyToken, text) {
  if (!replyToken) return false;
  return lineApi_('https://api.line.me/v2/bot/message/reply', { replyToken: replyToken, messages: [{ type: 'text', text: text }] });
}

function linePush_(to, text) {
  return lineApi_('https://api.line.me/v2/bot/message/push', { to: to, messages: [{ type: 'text', text: text }] });
}

function lineApi_(url, body) {
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${requiredProperty_('LINE_CHANNEL_ACCESS_TOKEN')}` },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const ok = response.getResponseCode() === 200;
  if (!ok) console.error(`LINE API ${response.getResponseCode()}: ${response.getContentText()}`);
  return ok;
}
