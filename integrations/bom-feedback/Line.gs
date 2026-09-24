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
 *   LINE_GITHUB_REPO           預設 poupyy220-art/workspace；合併的 PR 標題含 [F024] 會觸發通知；main 的 index.html commit 標題含 vX.Y.Z 會推「網站已更新」到白名單群組
 *   LINE_SITE_LAST_SHA         （自動寫入）最後一次已通知的網站 commit，刪除後下次只重新記錄、不補發
 *   LINE_ADMIN_USER_IDS        可使用 #待辦 的 LINE 使用者 ID（逗號分隔）；設定模式下在群組打「#我的ID」可查
 *   CLAUDE_REPLY_KEY          Claude 代發已核准回覆的暗號（本機 feedback.local.json 存同一值，不得寫進 Repository）
 *
 * Apps Script 讀不到 X-Line-Signature header，因此以「網址暗號＋群組白名單」代替簽章驗證。
 */

const LINE_REPORT_PREFIX = /^[#＃]\s*回報\s*/;
const LINE_CLOSE_PATTERN = /^[#＃]?\s*(F\d{3,})\s*(ok|好了|可以了|沒問題)/i;
const LINE_SUPPLEMENT_PATTERN = /^[#＃]?\s*([FU]\d{3,})\s*[:：,，]?\s*(\S[\s\S]*)$/i;
// 同事補充記在每列最後兩欄：BOM Feedback R／S 欄、Data Requests L／M 欄
const SUPPLEMENT_COLUMNS = { F: { text: 18, time: 19 }, U: { text: 12, time: 13 } };
const LINE_SITE_URL = 'https://poupyy220-art.github.io/workspace/';
const LINE_PENDING_SECONDS = 600;
// 「#回報」選單按鈕送出的文字；按下後同一人的下一句就是描述
const LINE_REPORT_MODES = { '選擇:問題': { label: '問題' }, '選擇:需求': { label: '需求' } };
// #更新 要找 BOM 檔，收檔時間比截圖長
const DATA_PENDING_SECONDS = 1800;
const LINE_MAX_IMAGES = 3;
const LINE_COLUMNS = { status: 7, source: 11, imageLinks: 12, imageCount: 13, group: 14, reply: 15, replyStatus: 16, replyTime: 17 };

// 「#更新」資料更新需求：另存「Data Requests」分頁（U001 起編號）；AI 只做比對預覽，寫入一律由維護者在 Claude 觸發
const LINE_UPDATE_PREFIX = /^[#＃]\s*更新\s*/;
const DATA_REQUEST_SHEET = 'Data Requests';
const DATA_COLUMNS = { type: 3, description: 4, fileLinks: 5, fileCount: 6, status: 7, group: 8, reply: 9, replyStatus: 10, replyTime: 11 };
const DATA_HEADERS = ['需求編號', '送出時間', '更新類型', '說明', '檔案連結', '檔案數量', '處理狀態', 'LINE 群組', '給同事的回覆', '回覆狀態', '回覆時間'];
const DATA_MAX_FILES = 3;
const DATA_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DATA_TYPES = [{ name: 'PN_Project_Map', keys: ['pn_project_map', 'project_map', 'project map', '專案對照', '料號對照'] }];
// 「#待辦」維護者自己的待辦清單（T001 起），只有 LINE_ADMIN_USER_IDS 能新增、查看、改狀態
const LINE_TODO_LIST_PATTERN = /^[#＃]\s*待辦\s*清單\s*$/;
const LINE_TODO_PREFIX = /^[#＃]\s*待辦\s*/;
const LINE_TODO_STATUS_PATTERN = /^[#＃]?\s*(T\d{3,})\s*(完成|取消|進行中)\s*$/i;
const LINE_MY_ID_PATTERN = /^[#＃]\s*我的\s*ID\s*$/i;
// 「#額度」查本月 LINE 推播用量（只有維護者）；用量達 80% 時每月寄一次提醒信
const LINE_QUOTA_PATTERN = /^[#＃]\s*額度\s*$/;
const LINE_QUOTA_WARN_RATIO = 0.8;
const TODO_SHEET = 'To Do';
const TODO_HEADERS = ['待辦編號', '建立時間', '內容', '狀態', '完成時間', 'LINE 群組', '備註'];
const TODO_COLUMNS = { content: 3, status: 4, doneTime: 5, group: 6, note: 7 };
const TODO_STATUSES = ['待辦', '進行中', '已完成', '取消'];
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
  { name: 'PN 工具', keys: ['pn', '料號查詢', 'ec tracking', '待貼入'] }
];

// ---------- Webhook 入口（由 Code.gs 的 doPost 轉進來） ----------

function handleLineWebhook_(e, payload) {
  // Claude 代發已核准回覆：沿用 events 路由（不必改 Code.gs），但用另一把 CLAUDE_REPLY_KEY 驗證
  if (payload.claudeReply) return json_(handleClaudeReply_(payload.claudeReply));

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
    lineReply_(event.replyToken, '大家好，我是 Debug 小幫手 🤖\n・網站有問題或想調整：打「#回報」從選單選擇，或直接打「#回報 問題描述」，可以接著貼截圖。\n・要更新資料：打「#更新」，從選單選擇資料類型後傳 Excel 檔。\n一般聊天我不會回、也不會記錄。');
    return;
  }
  if (event.type !== 'message' || !event.message) return;

  const userId = source.userId || 'unknown';
  if (event.message.type === 'text') handleLineText_(event, groupId, userId, event.message.text || '');
  else if (event.message.type === 'image') handleLineImage_(event, groupId, userId);
  else if (event.message.type === 'file') handleLineFile_(event, groupId, userId);
}

function handleLineText_(event, groupId, userId, rawText) {
  const text = String(rawText).trim();

  if (LINE_REPORT_PREFIX.test(text)) {
    createLineReport_(event, groupId, userId, text.replace(LINE_REPORT_PREFIX, ''));
    return;
  }

  if (LINE_UPDATE_PREFIX.test(text)) {
    createDataRequest_(event, groupId, userId, text.replace(LINE_UPDATE_PREFIX, ''));
    return;
  }

  // 設定模式下查自己的 LINE 使用者 ID（填 LINE_ADMIN_USER_IDS 用）
  if (LINE_MY_ID_PATTERN.test(text)) {
    if (PropertiesService.getScriptProperties().getProperty('LINE_SETUP_MODE') === 'true') lineReply_(event.replyToken, `你的 LINE 使用者 ID：\n${userId}\n請填入 Apps Script 的 LINE_ADMIN_USER_IDS。`);
    return;
  }

  if (LINE_QUOTA_PATTERN.test(text)) {
    if (requireLineAdmin_(event, userId)) lineReply_(event.replyToken, formatLineQuota_(getLineQuota_()));
    return;
  }

  if (LINE_TODO_LIST_PATTERN.test(text)) {
    if (requireLineAdmin_(event, userId)) showTodoList_(event);
    return;
  }
  if (LINE_TODO_PREFIX.test(text)) {
    if (requireLineAdmin_(event, userId)) createTodo_(event, groupId, text.replace(LINE_TODO_PREFIX, ''));
    return;
  }
  const todoStatusMatch = text.match(LINE_TODO_STATUS_PATTERN);
  if (todoStatusMatch) {
    if (requireLineAdmin_(event, userId)) updateTodoStatus_(event, todoStatusMatch[1].toUpperCase(), todoStatusMatch[2] === '完成' ? '已完成' : todoStatusMatch[2]);
    return;
  }

  // 從 #回報 選單按了「回報問題／提出需求」：這句就是描述
  const waiting = getLinePending_(groupId, userId);
  if (waiting && waiting.kind === 'awaitReport') {
    createLineReport_(event, groupId, userId, text, waiting.mode);
    return;
  }

  const closeMatch = text.match(LINE_CLOSE_PATTERN);
  if (closeMatch) {
    closeLineReport_(event, groupId, closeMatch[1].toUpperCase());
    return;
  }

  // 「F005 ②」「U003 還少一個檔」：同事對既有編號的補充，記錄後自動回覆
  const supplementMatch = text.match(LINE_SUPPLEMENT_PATTERN);
  if (supplementMatch && addLineSupplement_(event, groupId, supplementMatch[1].toUpperCase(), supplementMatch[2])) return;

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

function createLineReport_(event, groupId, userId, description, mode) {
  // 只打「#回報」：跳出選單（回報問題／提出需求／更新資料），不建立回報
  if (!description) {
    lineReplyMessages_(event.replyToken, [{ type: 'flex', altText: '要回報什麼？請選擇', contents: buildReportMenuCard_() }]);
    return;
  }
  const picked = LINE_REPORT_MODES[String(description).replace(/\s/g, '').replace('：', ':')];
  if (picked) {
    putLinePending_(groupId, userId, { kind: 'awaitReport', mode: picked.label });
    lineReply_(event.replyToken, picked.label === '需求'
      ? '好的，請直接打出希望新增或調整的地方（10 分鐘內），例如：\nEC Tracking 下載的 Excel 希望多一欄序號'
      : '好的，請直接打出遇到的問題（10 分鐘內），例如：\nBOM 轉檔後第 35 列品名變亂碼');
    return;
  }
  const isRequest = mode === '需求';
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
        reportId, now, '', isRequest ? 'LINE 需求' : 'LINE 回報', sheetText_(tool ? `工具：${tool}` : '工具：待確認'),
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

  const ask = tool ? '' : '\n請問是哪一個工具？點下方按鈕，或直接回名稱';
  const message = { type: 'text', text: `收到 ${reportId}，處理中 🔧\n有截圖的話，10 分鐘內直接貼上來即可。${ask}` };
  // 工具不明時附上快速回覆按鈕；按下等於送出工具名稱，由 needTool 流程補寫
  if (!tool) message.quickReply = { items: LINE_TOOLS.slice(0, 13).map(function (item) { return { type: 'action', action: { type: 'message', label: item.name.slice(0, 20), text: item.name } }; }) };
  lineReplyMessages_(event.replyToken, [message]);
}

function handleLineImage_(event, groupId, userId) {
  // 只收「剛打完 #回報的同一個人」接著貼的圖，一般聊天的圖不碰
  const pending = getLinePending_(groupId, userId);
  if (!pending) return;
  if (pending.kind === 'awaitReport') {
    lineReply_(event.replyToken, '請先用文字描述，建立編號後再貼截圖 🙏');
    return;
  }
  if (pending.kind === 'data') {
    lineReply_(event.replyToken, `${pending.id} 需要的是 Excel 檔（BOM_TREE_….xlsx），截圖沒有記錄。`);
    return;
  }
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

// ---------- 資料更新需求（#更新） ----------

function createDataRequest_(event, groupId, userId, description) {
  // 只打「#更新」不加字：跳出資料類型按鈕選單（按下等於送出「#更新 類型」），不建立需求
  if (!String(description || '').trim()) {
    lineReplyMessages_(event.replyToken, [{ type: 'flex', altText: '要更新哪一種資料？請選擇', contents: buildUpdateMenuCard_() }]);
    return;
  }
  let safeDescription;
  try {
    safeDescription = safeText_(description, 500, false);
  } catch (lengthError) {
    lineReply_(event.replyToken, '說明超過 500 字，請精簡後再送一次。');
    return;
  }
  const type = detectDataType_(safeDescription);
  const now = new Date();
  let requestId = '';

  try {
    withLock_(function () {
      const guard = checkFeedbackGuard_('DATA', groupId, safeDescription || type, 0, now);
      requestId = nextDataRequestId_();
      getDataRequestSheet_().appendRow([
        requestId, now, type || '待確認', sheetText_(safeDescription), '', 0, '新需求', groupId, '', '', ''
      ]);
      commitFeedbackGuard_(guard);
    });
  } catch (guardError) {
    const message = String(guardError.message || guardError);
    if (/Duplicate/.test(message)) lineReply_(event.replyToken, '這個更新需求 5 分鐘內已經送過了，不用重複送 👍');
    else if (/Daily/.test(message)) lineReply_(event.replyToken, '今天的需求數量已達上限，請直接私訊維護人員。');
    else throw guardError;
    return;
  }

  putLinePending_(groupId, userId, { id: requestId, kind: 'data', files: 0 });
  notifyDataRequest_(requestId, now, type, safeDescription);
  const typeText = type ? `（${type}）` : '';
  const unsupported = type ? '' : '\n目前自動比對只支援 PN_Project_Map，其他資料會由維護人員另外處理。';
  lineReply_(event.replyToken, `收到 ${requestId}${typeText} 📥\n請在 30 分鐘內傳 BOM_TREE Excel 檔（最多 ${DATA_MAX_FILES} 個）。\nAI 會先比對預覽，確認前不會改動資料。${unsupported}`);
}

function handleLineFile_(event, groupId, userId) {
  // 只收「剛打完 #更新 的同一個人」接著傳的 Excel，一般聊天的檔案不碰
  const pending = getLinePending_(groupId, userId);
  if (!pending || pending.kind !== 'data') return;
  if (pending.files >= DATA_MAX_FILES) {
    lineReply_(event.replyToken, `${pending.id} 最多附 ${DATA_MAX_FILES} 個檔案，這個沒有記錄。`);
    return;
  }
  const fileName = String(event.message.fileName || '');
  if (!/\.xlsx?$/i.test(fileName)) {
    lineReply_(event.replyToken, `${pending.id} 只收 Excel 檔（.xlsx／.xls），「${fileName}」沒有記錄。`);
    return;
  }
  if (Number(event.message.fileSize || 0) > DATA_MAX_FILE_BYTES) {
    lineReply_(event.replyToken, `${pending.id}：檔案超過 10 MB，沒有記錄，請直接私訊維護人員。`);
    return;
  }

  const bytes = fetchLineContent_(event.message.id);
  if (!bytes.length || bytes.length > DATA_MAX_FILE_BYTES) throw new Error('Data file exceeds size limit');
  if (!matchesExcelSignature_(bytes)) {
    lineReply_(event.replyToken, `${pending.id}：「${fileName}」內容不是有效的 Excel，沒有記錄。`);
    return;
  }

  const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('DATA_REQUEST_FOLDER_ID') || requiredProperty_('FEEDBACK_IMAGE_FOLDER_ID'));
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const mimeType = /\.xls$/i.test(fileName) ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const file = folder.createFile(Utilities.newBlob(bytes, mimeType, `${pending.id}_${safeName}`));
  file.setDescription(`Data request file for ${pending.id}`);

  withLock_(function () {
    const sheet = getDataRequestSheet_();
    const rowNumber = findFeedbackRow_(sheet, pending.id);
    if (!rowNumber) throw new Error('Data request row not found');
    const linkCell = sheet.getRange(rowNumber, DATA_COLUMNS.fileLinks);
    const links = String(linkCell.getValue() || '');
    linkCell.setValue(links ? `${links}\n${file.getUrl()}` : file.getUrl());
    sheet.getRange(rowNumber, DATA_COLUMNS.fileCount).setValue(pending.files + 1);
  });

  pending.files += 1;
  putLinePending_(groupId, userId, pending);
  lineReply_(event.replyToken, `📎 ${pending.id} 已收到檔案：${safeName}\nAI 比對完會把預覽交給維護人員確認。`);
}

function fetchLineContent_(messageId) {
  const response = UrlFetchApp.fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: `Bearer ${requiredProperty_('LINE_CHANNEL_ACCESS_TOKEN')}` },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error(`LINE content fetch failed: ${response.getResponseCode()}`);
  return response.getBlob().getBytes();
}

function matchesExcelSignature_(bytes) {
  const byte = function (index) { return ((bytes[index] || 0) + 256) % 256; };
  const isZip = byte(0) === 0x50 && byte(1) === 0x4B && byte(2) === 0x03 && byte(3) === 0x04; // .xlsx
  const isOle = [0xD0, 0xCF, 0x11, 0xE0].every(function (value, index) { return byte(index) === value; }); // .xls
  return isZip || isOle;
}

function detectDataType_(text) {
  const lower = String(text).toLowerCase();
  for (let i = 0; i < DATA_TYPES.length; i += 1) {
    if (DATA_TYPES[i].keys.some(function (key) { return lower.indexOf(key) >= 0; })) return DATA_TYPES[i].name;
  }
  return '';
}

function nextDataRequestId_() {
  const properties = PropertiesService.getScriptProperties();
  const next = Number(properties.getProperty('LINE_DATA_SEQ') || 0) + 1;
  properties.setProperty('LINE_DATA_SEQ', String(next));
  return `U${String(next).padStart(3, '0')}`;
}

/** 第一次使用時自動建立「Data Requests」分頁；版面比照 BOM Feedback（第 4 列標題、第 5 列起資料）。 */
function getDataRequestSheet_() {
  const spreadsheet = SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID'));
  let sheet = spreadsheet.getSheetByName(DATA_REQUEST_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(DATA_REQUEST_SHEET);
    sheet.getRange(1, 1).setValue('資料更新需求（LINE #更新）');
    sheet.getRange(2, 1).setValue('AI 只做比對預覽；寫入一律由維護者在 Claude 確認後執行。');
    sheet.getRange(4, 1, 1, DATA_HEADERS.length).setValues([DATA_HEADERS]);
    try { applyDataRequestFormat_(sheet); } catch (formatError) { console.error(formatError); }
  }
  return sheet;
}

/** 在編輯器手動執行一次：替既有的 Data Requests 分頁套用與 BOM Feedback 一致的格式與下拉選單（不動資料）。 */
function formatDataRequestSheet() {
  const sheet = SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID')).getSheetByName(DATA_REQUEST_SHEET);
  if (!sheet) return logSetupResult_('還沒有 Data Requests 分頁（第一次 #更新 時會自動建立並套用格式）');
  applyDataRequestFormat_(sheet);
  return logSetupResult_('Data Requests 分頁格式與處理狀態下拉選單已套用');
}

// 版面比照 BOM Feedback：第 1 列深藍標題、第 2 列淡黃說明、第 4 列欄位標題、資料列藍白相間
function applyDataRequestFormat_(sheet) {
  const width = DATA_HEADERS.length;
  sheet.getRange(1, 1, 1, width).merge().setBackground('#1f4e79').setFontColor('#ffffff').setFontWeight('bold').setFontSize(14);
  sheet.getRange(2, 1, 1, width).merge().setBackground('#fff2cc').setFontColor('#7f6000');
  sheet.getRange(4, 1, 1, width).setBackground('#dce6f1').setFontColor('#1f3864').setFontWeight('bold');
  sheet.setFrozenRows(4);
  [90, 150, 130, 220, 180, 80, 100, 120, 320, 100, 110].forEach(function (px, index) { sheet.setColumnWidth(index + 1, px); });

  const dataRows = Math.max(sheet.getMaxRows() - 4, 1);
  const body = sheet.getRange(5, 1, dataRows, width);
  body.setVerticalAlignment('middle');
  sheet.getRange(5, DATA_COLUMNS.description, dataRows, 1).setWrap(true);
  sheet.getRange(5, DATA_COLUMNS.reply, dataRows, 1).setWrap(true);
  // 藍白相間用條件式格式（applyRowBanding 在部分試算表會丟 Unexpected error）；失敗也不擋後面的下拉選單
  try {
    const zebraRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(ROW()>=5,ISEVEN(ROW()))')
      .setBackground('#dbe9f7')
      .setRanges([body])
      .build();
    const otherRules = sheet.getConditionalFormatRules().filter(function (rule) {
      return !rule.getBooleanCondition() || rule.getBooleanCondition().getCriteriaValues().join('') !== '=AND(ROW()>=5,ISEVEN(ROW()))';
    });
    sheet.setConditionalFormatRules(otherRules.concat([zebraRule]));
  } catch (zebraError) {
    console.error(zebraError);
  }

  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['新需求', '預覽完成', '已完成', '不處理'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(5, DATA_COLUMNS.status, dataRows, 1).setDataValidation(statusRule);
}

function notifyDataRequest_(requestId, now, type, description) {
  try {
    MailApp.sendEmail({
      to: requiredProperty_('NOTIFY_EMAIL'),
      subject: `[LINE 更新需求] ${type || '類型待確認'}｜${requestId}`,
      htmlBody: `<p><b>需求編號：</b>${escapeHtml_(requestId)}</p><p><b>時間：</b>${escapeHtml_(formatDate_(now))}</p><p><b>類型：</b>${escapeHtml_(type || '待確認')}</p><p><b>說明：</b>${escapeHtml_(description || '（未填）')}</p><p>檔案會陸續寫入「Data Requests」分頁；確認預覽前不會寫入任何資料。</p>`,
      name: 'Debug 小幫手'
    });
  } catch (mailError) {
    console.error(mailError);
  }
}

// ---------- Claude 代發已核准回覆 ----------

/**
 * 維護者在 Claude 對話中說「發」之後，由本機 send-line-reply.js 呼叫。
 * 只能把回覆寫進「已存在」的 F／U 編號列，並推送到該列原本的 LINE 群組；不能指定群組、不能新增資料。
 * payload：{ events: [], claudeReply: { key, id, text, fixed } }；key 需等於指令碼屬性 CLAUDE_REPLY_KEY。
 */
function handleClaudeReply_(request) {
  const expected = PropertiesService.getScriptProperties().getProperty('CLAUDE_REPLY_KEY');
  if (!expected || String(request.key || '') !== expected) return { ok: false, error: 'unauthorized' };

  const id = String(request.id || '').trim().toUpperCase();
  if (!/^[FU]\d{3,}$/.test(id)) return { ok: false, error: 'invalid id' };
  const text = String(request.text || '').trim();
  if (!text || text.length > 4800) return { ok: false, error: 'text must be 1-4800 characters' };

  const isData = id.charAt(0) === 'U';
  const columns = isData ? DATA_COLUMNS : LINE_COLUMNS;
  const fixed = !isData && request.fixed === true;

  return withLock_(function () {
    const sheet = isData
      ? SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID')).getSheetByName(DATA_REQUEST_SHEET)
      : getSheet_(FEEDBACK_SHEET);
    const rowNumber = sheet ? findFeedbackRow_(sheet, id) : 0;
    if (!rowNumber) return { ok: false, error: 'id not found' };
    const row = sheet.getRange(rowNumber, 1, 1, columns.replyTime).getValues()[0];
    const groupId = String(row[columns.group - 1] || '');
    if (!groupId || !isAllowedLineGroup_(groupId)) return { ok: false, error: 'no allowed LINE group for this id' };

    // 同一段文字已送過就不重送（避免重複呼叫洗版）
    const previousStatus = String(row[columns.replyStatus - 1]);
    if (String(row[columns.reply - 1]).trim() === text && (previousStatus === '已發送' || previousStatus === '修好已通知')) {
      return { ok: true, id: id, sent: false, duplicate: true };
    }

    const tail = fixed ? `\n沒問題的話請回「${id} OK」` : '';
    // 有卡片資料就送 LINE 卡片（Flex），卡片失敗時退回純文字，確保一定送得出去
    let sent = false;
    if (request.card) {
      try {
        sent = lineApi_('https://api.line.me/v2/bot/message/push', {
          to: groupId,
          messages: [{ type: 'flex', altText: `${id}：${text}`.slice(0, 390), contents: buildDataUpdateCard_(id, request.card) }]
        });
      } catch (cardError) {
        console.error(cardError);
      }
    }
    if (!sent) sent = linePush_(groupId, `${id}：${text}${tail}`);
    sheet.getRange(rowNumber, columns.reply).setValue(sheetText_(text));
    sheet.getRange(rowNumber, columns.replyStatus).setValue(sent ? (fixed ? '修好已通知' : '已發送') : '發送失敗');
    sheet.getRange(rowNumber, columns.replyTime).setValue(new Date());
    return { ok: sent, id: id, sent: sent };
  });
}

/**
 * 資料更新結果卡片：標題、三個數字（新增／補標籤／已存在）、新增料號預覽、查看完整清單按鈕。
 * card = { project, added: [料號...], tagged, unchanged, rowsBefore, rowsAfter, link, date, note }
 */
function buildDataUpdateCard_(id, card) {
  const added = (Array.isArray(card.added) ? card.added : []).map(String).slice(0, 300);
  const count = function (value) { return String(Math.max(0, Number(value) || 0)); };
  const preview = added.length ? added.slice(0, 6).join('、') + (added.length > 6 ? ` …等 ${added.length} 筆` : '') : '這次沒有新增料號';
  const stat = function (icon, number, label, background, color) {
    return {
      type: 'box', layout: 'vertical', flex: 1, backgroundColor: background, cornerRadius: '10px', paddingAll: '8px',
      contents: [
        { type: 'text', text: icon, size: 'md', align: 'center' },
        { type: 'text', text: number, size: 'xl', weight: 'bold', color: color, align: 'center' },
        { type: 'text', text: label, size: 'xs', color: color, align: 'center' }
      ]
    };
  };
  const footerText = card.rowsBefore && card.rowsAfter ? `🛡️ 總列數 ${card.rowsBefore} → ${card.rowsAfter} · 已核對` : '🛡️ 已核對';
  const bubble = {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#E6F4EA', paddingAll: '14px',
      contents: [
        { type: 'text', text: `#️⃣ ${id} · PN_Project_Map`, size: 'xs', color: '#1E7E34' },
        { type: 'text', text: `${String(card.project || '資料')} 更新完成 ✅`, size: 'lg', weight: 'bold', color: '#1E7E34', wrap: true },
        { type: 'text', text: `${String(card.date || '')} · 維護人員已確認`.replace(/^ · /, ''), size: 'xs', color: '#3C8D50' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
          stat('➕', count(card.added ? added.length : 0), '新增料號', '#E8F0FE', '#1A56B8'),
          stat('🏷️', count(card.tagged), '補上標籤', '#FEF3E2', '#A15C00'),
          stat('✅', count(card.unchanged), '已存在', '#F1F3F4', '#3C4043')
        ] },
        { type: 'text', text: `📝 新增：${preview}`, size: 'xs', color: '#5F6368', wrap: true },
        card.note ? { type: 'text', text: String(card.note).slice(0, 300), size: 'xs', color: '#5F6368', wrap: true } : null
      ].filter(Boolean)
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: [
        card.link ? { type: 'button', style: 'primary', color: '#1E7E34', height: 'sm', action: { type: 'uri', label: '📋 查看完整清單', uri: String(card.link) } } : null,
        { type: 'text', text: '💬 有問題請直接在群組告訴維護人員', size: 'xs', color: '#80868B', align: 'center' },
        { type: 'text', text: footerText, size: 'xxs', color: '#9AA0A6', align: 'center' }
      ].filter(Boolean)
    }
  };
  return bubble;
}

// ---------- 同事補充（F／U 編號後面接文字） ----------

/** 找得到同群組的編號才記錄並回覆；找不到就回 false，當一般聊天處理（不回、不記）。 */
function addLineSupplement_(event, groupId, id, rawText) {
  const text = String(rawText || '').trim().slice(0, 500);
  if (!text) return false;
  const isData = id.charAt(0) === 'U';
  const columns = SUPPLEMENT_COLUMNS[id.charAt(0)];
  const recorded = withLock_(function () {
    const sheet = isData
      ? SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID')).getSheetByName(DATA_REQUEST_SHEET)
      : getSheet_(FEEDBACK_SHEET);
    if (!sheet) return false;
    const rowNumber = findFeedbackRow_(sheet, id);
    if (!rowNumber) return false;
    const groupColumn = isData ? DATA_COLUMNS.group : LINE_COLUMNS.group;
    if (String(sheet.getRange(rowNumber, groupColumn).getValue()) !== groupId) return false;
    if (!sheet.getRange(4, columns.text).getValue()) sheet.getRange(4, columns.text, 1, 2).setValues([['同事補充', '補充時間']]);
    const cell = sheet.getRange(rowNumber, columns.text);
    const previous = String(cell.getValue() || '');
    const stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'MM/dd HH:mm');
    cell.setValue(sheetText_(previous ? `${previous}\n[${stamp}] ${text}` : `[${stamp}] ${text}`));
    sheet.getRange(rowNumber, columns.time).setValue(new Date());
    return true;
  });
  if (!recorded) return false;
  try {
    MailApp.sendEmail({
      to: requiredProperty_('NOTIFY_EMAIL'),
      subject: `[LINE 補充] ${id}`,
      htmlBody: `<p><b>編號：</b>${escapeHtml_(id)}</p><p><b>補充內容：</b>${escapeHtml_(text)}</p>`,
      name: 'Debug 小幫手'
    });
  } catch (mailError) {
    console.error(mailError);
  }
  lineReply_(event.replyToken, `收到 ${id} 的補充 👍 維護人員會接著處理`);
  return true;
}

// ---------- 待辦（只有維護者） ----------

function isLineAdmin_(userId) {
  return String(PropertiesService.getScriptProperties().getProperty('LINE_ADMIN_USER_IDS') || '')
    .split(',').map(function (value) { return value.trim(); }).filter(Boolean).indexOf(userId) >= 0;
}

function requireLineAdmin_(event, userId) {
  if (isLineAdmin_(userId)) return true;
  lineReply_(event.replyToken, '待辦清單只有維護人員可以使用；有需求請打「#回報」選「提出需求」🙏');
  return false;
}

function createTodo_(event, groupId, rawText) {
  const content = String(rawText || '').trim();
  if (!content) {
    lineReply_(event.replyToken, '請在「#待辦」後面寫內容，例如：\n#待辦 PN Database 清單跟公司系統比對\n看清單打「#待辦清單」，完成打「T001 完成」');
    return;
  }
  let safeContent;
  try {
    safeContent = safeText_(content, 500, false);
  } catch (lengthError) {
    lineReply_(event.replyToken, '待辦內容超過 500 字，請精簡後再送一次。');
    return;
  }
  const todoId = withLock_(function () {
    const properties = PropertiesService.getScriptProperties();
    const next = Number(properties.getProperty('LINE_TODO_SEQ') || 0) + 1;
    properties.setProperty('LINE_TODO_SEQ', String(next));
    const id = `T${String(next).padStart(3, '0')}`;
    getTodoSheet_().appendRow([id, new Date(), sheetText_(safeContent), '待辦', '', groupId, '']);
    return id;
  });
  lineReply_(event.replyToken, `已記下 ${todoId} 📝\n看清單打「#待辦清單」，完成打「${todoId} 完成」`);
}

function readOpenTodos_() {
  const sheet = SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID')).getSheetByName(TODO_SHEET);
  if (!sheet || sheet.getLastRow() < 5) return [];
  return sheet.getRange(5, 1, sheet.getLastRow() - 4, TODO_HEADERS.length).getValues()
    .filter(function (row) { return row[0] && (row[TODO_COLUMNS.status - 1] === '待辦' || row[TODO_COLUMNS.status - 1] === '進行中'); })
    .map(function (row) { return { id: String(row[0]), content: String(row[TODO_COLUMNS.content - 1]), status: String(row[TODO_COLUMNS.status - 1]) }; });
}

function showTodoList_(event) {
  const todos = readOpenTodos_();
  if (!todos.length) {
    lineReply_(event.replyToken, '目前沒有未完成的待辦 🎉');
    return;
  }
  lineReplyMessages_(event.replyToken, [{ type: 'flex', altText: `待辦清單：${todos.length} 項未完成`, contents: buildTodoListCard_(todos) }]);
}

function buildTodoListCard_(todos) {
  const shown = todos.slice(0, 15);
  const rows = shown.map(function (todo) {
    return {
      type: 'box', layout: 'horizontal', spacing: 'sm',
      contents: [
        { type: 'text', text: todo.id, size: 'sm', weight: 'bold', color: '#1A73E8', flex: 2 },
        { type: 'text', text: todo.content.slice(0, 60), size: 'sm', wrap: true, flex: 7 },
        { type: 'text', text: todo.status === '進行中' ? '🔄' : '⬜', size: 'sm', align: 'end', flex: 1 }
      ]
    };
  });
  if (todos.length > shown.length) rows.push({ type: 'text', text: `…另有 ${todos.length - shown.length} 項，請看 Sheet「${TODO_SHEET}」分頁`, size: 'xs', color: '#9AA0A6', wrap: true });
  return {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#FFF4E5', paddingAll: '14px',
      contents: [
        { type: 'text', text: `📝 待辦清單（${todos.length} 項未完成）`, size: 'lg', weight: 'bold', color: '#B06000' },
        { type: 'text', text: '⬜ 待辦　🔄 進行中', size: 'xs', color: '#C77700' }
      ]
    },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: rows },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: '完成打「T001 完成」，也可以打「T001 進行中」「T001 取消」', size: 'xxs', color: '#9AA0A6', align: 'center', wrap: true }]
    }
  };
}

function updateTodoStatus_(event, todoId, status) {
  const result = withLock_(function () {
    const sheet = SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID')).getSheetByName(TODO_SHEET);
    if (!sheet) return 'missing';
    const rowNumber = findFeedbackRow_(sheet, todoId);
    if (!rowNumber) return 'missing';
    sheet.getRange(rowNumber, TODO_COLUMNS.status).setValue(status);
    sheet.getRange(rowNumber, TODO_COLUMNS.doneTime).setValue(status === '已完成' || status === '取消' ? new Date() : '');
    return 'ok';
  });
  const done = { 已完成: '已完成 ✅', 取消: '已取消', 進行中: '改為進行中 🔄' };
  lineReply_(event.replyToken, result === 'ok' ? `${todoId} ${done[status]}` : `找不到 ${todoId}，請確認編號。`);
}

/** 第一次 #待辦 時自動建立「To Do」分頁；版面比照 Data Requests。 */
function getTodoSheet_() {
  const spreadsheet = SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID'));
  let sheet = spreadsheet.getSheetByName(TODO_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(TODO_SHEET);
    sheet.getRange(1, 1).setValue('維護者待辦（LINE #待辦）');
    sheet.getRange(2, 1).setValue('只有維護者可以新增；狀態可在 LINE 打「T001 完成／進行中／取消」或直接改下拉選單。');
    sheet.getRange(4, 1, 1, TODO_HEADERS.length).setValues([TODO_HEADERS]);
    try { applyTodoFormat_(sheet); } catch (formatError) { console.error(formatError); }
  }
  return sheet;
}

function applyTodoFormat_(sheet) {
  const width = TODO_HEADERS.length;
  sheet.getRange(1, 1, 1, width).merge().setBackground('#1f4e79').setFontColor('#ffffff').setFontWeight('bold').setFontSize(14);
  sheet.getRange(2, 1, 1, width).merge().setBackground('#fff2cc').setFontColor('#7f6000');
  sheet.getRange(4, 1, 1, width).setBackground('#dce6f1').setFontColor('#1f3864').setFontWeight('bold');
  sheet.setFrozenRows(4);
  [90, 150, 360, 90, 150, 120, 200].forEach(function (px, index) { sheet.setColumnWidth(index + 1, px); });
  const dataRows = Math.max(sheet.getMaxRows() - 4, 1);
  sheet.getRange(5, TODO_COLUMNS.content, dataRows, 1).setWrap(true);
  const statusRule = SpreadsheetApp.newDataValidation().requireValueInList(TODO_STATUSES, true).setAllowInvalid(false).build();
  sheet.getRange(5, TODO_COLUMNS.status, dataRows, 1).setDataValidation(statusRule);
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
  try { notifySiteUpdates_(); } catch (error) { console.error(error); }
  try { checkLineQuota_(); } catch (error) { console.error(error); }
  sendApprovedLineReplies_();
}

// 網站有新版本（main 上 index.html 的 commit 標題含 vX.Y.Z）→ 部署 5 分鐘後推到所有白名單群組。
// 第一次執行只記下目前最新的 commit，不補發舊版本。
function notifySiteUpdates_() {
  const props = PropertiesService.getScriptProperties();
  const repo = props.getProperty('LINE_GITHUB_REPO') || 'poupyy220-art/workspace';
  const response = UrlFetchApp.fetch(`https://api.github.com/repos/${repo}/commits?sha=main&path=index.html&per_page=10`, {
    headers: { Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error(`GitHub commits API failed: ${response.getResponseCode()}`);
  const commits = JSON.parse(response.getContentText());
  if (!commits.length) return;
  const lastSha = props.getProperty('LINE_SITE_LAST_SHA');
  const now = Date.now();
  const ready = commits.filter(function (commit) { return now - new Date(commit.commit.committer.date).getTime() >= 5 * 60 * 1000; });
  if (!ready.length) return;
  if (!lastSha) { props.setProperty('LINE_SITE_LAST_SHA', ready[0].sha); return; }

  const fresh = [];
  for (let i = 0; i < ready.length && ready[i].sha !== lastSha; i += 1) fresh.push(ready[i]);
  if (!fresh.length) return;
  props.setProperty('LINE_SITE_LAST_SHA', ready[0].sha);

  const lines = fresh.map(function (commit) {
    const subject = String(commit.commit.message || '').split('\n')[0];
    const version = subject.match(/v\d+\.\d+(?:\.\d+)?/);
    if (!version) return null;
    const summary = subject.replace(/^\w+(\([^)]*\))?!?:\s*/, '').replace(/\s*[（(]?v\d+\.\d+(?:\.\d+)?[)）]?\s*/, ' ').trim();
    return { version: version[0], summary: summary };
  }).filter(Boolean).reverse().slice(-5);
  if (!lines.length) return;

  const latest = lines[lines.length - 1].version;
  const text = [`🆕 料號管理中心已更新到 ${latest}`]
    .concat(lines.map(function (line) { return `・${line.version} ${line.summary}`.slice(0, 200); }))
    .concat(['請重新整理網頁（Ctrl+F5）後使用', LINE_SITE_URL]).join('\n');
  String(props.getProperty('LINE_GROUP_IDS') || '').split(',').map(function (id) { return id.trim(); }).filter(Boolean)
    .forEach(function (groupId) { linePush_(groupId, text); });
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
  sendApprovedRepliesFrom_(getSheet_(FEEDBACK_SHEET), LINE_COLUMNS);
  // Data Requests 分頁要等第一個 #更新 才會建立；沒有就略過
  const dataSheet = SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID')).getSheetByName(DATA_REQUEST_SHEET);
  if (dataSheet) sendApprovedRepliesFrom_(dataSheet, DATA_COLUMNS);
}

function sendApprovedRepliesFrom_(sheet, columns) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 5) return;
  const rows = sheet.getRange(5, 1, lastRow - 4, columns.replyTime).getValues();
  rows.forEach(function (row, index) {
    const replyStatus = String(row[columns.replyStatus - 1]);
    if (replyStatus !== '核准發送' && replyStatus !== '修好待通知') return;
    const rowNumber = index + 5;
    const reportId = String(row[0]);
    const groupId = String(row[columns.group - 1] || '');
    const reply = String(row[columns.reply - 1] || '').trim();
    if (!groupId || !reply) {
      sheet.getRange(rowNumber, columns.replyStatus).setValue(groupId ? '缺回覆內容' : '非 LINE 來源');
      return;
    }
    const fixed = replyStatus === '修好待通知';
    const tail = fixed ? `\n沒問題的話請回「${reportId} OK」` : '';
    const ok = linePush_(groupId, `${reportId}：${reply}${tail}`);
    sheet.getRange(rowNumber, columns.replyStatus).setValue(ok ? (fixed ? '修好已通知' : '已發送') : '發送失敗');
    sheet.getRange(rowNumber, columns.replyTime).setValue(new Date());
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
  const seconds = pending.kind === 'data' ? DATA_PENDING_SECONDS : LINE_PENDING_SECONDS;
  CacheService.getScriptCache().put(`LINE_PENDING_${groupId}_${userId}`, JSON.stringify(pending), seconds);
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
  return lineReplyMessages_(replyToken, [{ type: 'text', text: text }]);
}

function lineReplyMessages_(replyToken, messages) {
  if (!replyToken) return false;
  return lineApi_('https://api.line.me/v2/bot/message/reply', { replyToken: replyToken, messages: messages });
}

/** 「#更新」選單：每個可自動處理的資料類型一顆按鈕，最後一顆給其他資料（人工處理）。 */
function buildUpdateMenuCard_() {
  const typeButtons = DATA_TYPES.map(function (item) {
    return { type: 'button', style: 'primary', color: '#1E7E34', height: 'sm', action: { type: 'message', label: `🗂️ ${item.name}`.slice(0, 20), text: `#更新 ${item.name}` } };
  });
  return {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#E6F4EA', paddingAll: '14px',
      contents: [
        { type: 'text', text: '🗂️ 要更新哪一種資料？', size: 'lg', weight: 'bold', color: '#1E7E34' },
        { type: 'text', text: '點選後請在 30 分鐘內傳 Excel 檔', size: 'xs', color: '#3C8D50' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: typeButtons.concat([
        { type: 'button', style: 'secondary', height: 'sm', action: { type: 'message', label: '📝 其他資料（人工處理）', text: '#更新 其他資料' } }
      ])
    },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: '🔒 AI 會先比對預覽，維護人員確認後才更新', size: 'xxs', color: '#9AA0A6', align: 'center', wrap: true }]
    }
  };
}

function buildReportMenuCard_() {
  function button(style, color, label, text) {
    const item = { type: 'button', style: style, height: 'sm', action: { type: 'message', label: label, text: text } };
    if (color) item.color = color;
    return item;
  }
  return {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#FDECEA', paddingAll: '14px',
      contents: [
        { type: 'text', text: '🛠️ 要回報什麼？', size: 'lg', weight: 'bold', color: '#B3261E' },
        { type: 'text', text: '點選後直接打文字說明，可接著貼截圖', size: 'xs', color: '#C5534A', wrap: true }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: [
        button('primary', '#B3261E', '🐞 回報問題', '#回報 選擇:問題'),
        button('primary', '#1A73E8', '💡 提出需求／格式調整', '#回報 選擇:需求'),
        button('secondary', '', '🗂️ 更新資料', '#更新')
      ]
    },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: '也可以直接打「#回報 問題描述」一次送出', size: 'xxs', color: '#9AA0A6', align: 'center', wrap: true }]
    }
  };
}

function linePush_(to, text) {
  return lineApi_('https://api.line.me/v2/bot/message/push', { to: to, messages: [{ type: 'text', text: text }] });
}

// ---------- 推播額度 ----------

/** 回傳 { limit: 數字或 null（無上限）, used: 數字 }；查詢失敗回 null。回覆（reply）不計入，只有推播（push）算。 */
function getLineQuota_() {
  const headers = { Authorization: `Bearer ${requiredProperty_('LINE_CHANNEL_ACCESS_TOKEN')}` };
  const quota = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/quota', { headers: headers, muteHttpExceptions: true });
  const usage = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: headers, muteHttpExceptions: true });
  if (quota.getResponseCode() !== 200 || usage.getResponseCode() !== 200) return null;
  const q = JSON.parse(quota.getContentText());
  return { limit: q.type === 'limited' ? Number(q.value) : null, used: Number(JSON.parse(usage.getContentText()).totalUsage || 0) };
}

function formatLineQuota_(quota) {
  if (!quota) return '暫時查不到 LINE 額度，請稍後再試，或到 LINE 官方帳號後台 →「分析」查看。';
  if (quota.limit === null) return `📊 本月已推播 ${quota.used} 則（目前方案沒有上限）`;
  const left = Math.max(quota.limit - quota.used, 0);
  const percent = quota.limit ? Math.round((quota.used / quota.limit) * 100) : 0;
  return `📊 本月 LINE 推播額度\n已用 ${quota.used} / ${quota.limit} 則（${percent}%），剩 ${left} 則\n・機器人馬上回的那句不算額度\n・發到群組的訊息依群組人數計算\n・每月 1 日重新計算`;
}

// 由 processLineOutbox 順便檢查：用量達 80% 時寄一次提醒信（每月最多一次）
function checkLineQuota_() {
  const properties = PropertiesService.getScriptProperties();
  const month = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM');
  if (properties.getProperty('LINE_QUOTA_WARNED_MONTH') === month) return;
  const quota = getLineQuota_();
  if (!quota || quota.limit === null || quota.used < quota.limit * LINE_QUOTA_WARN_RATIO) return;
  properties.setProperty('LINE_QUOTA_WARNED_MONTH', month);
  MailApp.sendEmail({
    to: requiredProperty_('NOTIFY_EMAIL'),
    subject: `[LINE 額度] 本月已用 ${quota.used}/${quota.limit} 則`,
    htmlBody: `<p>${escapeHtml_(formatLineQuota_(quota)).replace(/\n/g, '<br>')}</p><p>額度用完後推播（代發回覆、修好通知、網站更新通知）會發不出去，不會扣款；機器人即時回覆不受影響。</p>`,
    name: 'Debug 小幫手'
  });
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
