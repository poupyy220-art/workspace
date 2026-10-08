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
 *   LINE_QUICK_LINKS          「#網站」常用網站，每行（或分號隔開）一筆「名稱|https://網址」，最多 8 筆；未設定時只列料號管理中心
 *   LINE_CALENDAR_ID          「#行程」使用的 Google 行事曆 ID；在編輯器執行 setupLineCalendar 自動填入（預設找名為「工作」的行事曆）
 *   LINE_CALENDAR_NAME        setupLineCalendar 要找的行事曆名稱，未設定時用「工作」
 *   LINE_CAL_SEQ              （自動寫入）行程編號 C001 起的流水號
 *   LINE_ICON_BASE_URL        卡片積木圖示的公開資料夾網址（https），底下放 report.png、calendar.png 等；未設定時卡片不放圖、選單改用符號
 *
 * Apps Script 讀不到 X-Line-Signature header，因此以「網址暗號＋群組白名單」代替簽章驗證。
 */

const LINE_REPORT_PREFIX = /^[#＃]\s*回報\s*/;
const LINE_CLOSE_PATTERN = /^[#＃]?\s*(F\d{3,})\s*(ok|好了|可以了|沒問題)/i;
// 維護者（或 Claude）改處理狀態：「F006 已解決」「U004 已完成」；選項與 Sheet 下拉選單一致
const LINE_STATUS_PATTERN = /^[#＃]?\s*([FU]\d{3,})\s*(新回饋|處理中|已解決|不處理|新需求|預覽完成|已完成)\s*$/i;
const REPORT_STATUSES = { F: ['新回饋', '處理中', '已解決', '不處理'], U: ['新需求', '預覽完成', '已完成', '不處理'] };
const LINE_SUPPLEMENT_PATTERN = /^[#＃]?\s*([FU]\d{3,})\s*[:：,，]?\s*(\S[\s\S]*)$/i;
// 同事補充記在每列最後兩欄：BOM Feedback R／S 欄、Data Requests L／M 欄
const SUPPLEMENT_COLUMNS = { F: { text: 18, time: 19 }, U: { text: 12, time: 13 } };
// 問題摘要（維護者／Claude 用自己的話寫一行，不放同事原文）與修好提醒時間：BOM Feedback T／U 欄
const FEEDBACK_EXTRA_COLUMNS = { summary: 20, remindedAt: 21 };
const FIXED_REMINDER_WORKDAYS = 3;
const FIXED_REMINDER_HOURS = { from: 9, to: 18 };
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
const DATA_COLUMNS = { type: 3, description: 4, fileLinks: 5, fileCount: 6, status: 7, group: 8, reply: 9, replyStatus: 10, replyTime: 11, project: 14 };
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
// 「#小幫手」選單卡片（所有人可用）＋卡片按鈕送出的「#狀況」「#說明」「#網站」
const LINE_MENU_PATTERN = /^[#＃]\s*(小幫手|選單|menu)\s*$/i;
const LINE_STATUS_LIST_PATTERN = /^[#＃]\s*(狀況|進度|問題狀況)\s*$/;
const LINE_HELP_PATTERN = /^[#＃]\s*((使用)?說明|help)\s*$/i;
const LINE_LINKS_PATTERN = /^[#＃]\s*(常用)?網站\s*$/;
const LINE_QUICK_LINKS_MAX = 8;
const LINE_STATUS_LIST_MAX = 10;
// 「#行程」Google「工作」行事曆：所有人可查、可新增；改／刪只限建立者與維護者。只用回覆（reply），不吃推播額度
const LINE_CAL_MENU_PATTERN = /^[#＃]\s*(行事曆|行程選單)\s*$/;
const LINE_CAL_LIST_PATTERN = /^[#＃]\s*(行程|行事曆)(?:\s+(\S[\s\S]*))?$/;
const LINE_CAL_ADD_PREFIX = /^[#＃]\s*(新增行程|加行程)\s*/;
const LINE_CAL_EDIT_PATTERN = /^[#＃]\s*改行程\s*(C\d{3,})?\s*([\s\S]*)$/i;
const LINE_CAL_DELETE_PATTERN = /^[#＃]\s*(確認)?刪行程\s*(C\d{3,})?\s*$/i;
const LINE_CAL_LIST_MAX = 25;
const LINE_CAL_RANGE_MAX_DAYS = 31;
const LINE_CAL_PAST_DAYS = 90;
const LINE_CAL_FUTURE_DAYS = 400;
const LINE_CAL_WEEKDAYS = '日一二三四五六';
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
  // Claude 改處理狀態：同一把 CLAUDE_REPLY_KEY 驗證，只改 G 欄，不發 LINE
  if (payload.claudeStatus) return json_(handleClaudeStatus_(payload.claudeStatus));
  if (payload.claudeLog) return json_(handleClaudeLog_(payload.claudeLog));
  // 本機門鈴：只查有沒有新編號或新補充，不含描述、補充內容、群組或連結
  if (payload.claudePending) return json_(handleClaudePending_(payload.claudePending));

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
    lineReply_(event.replyToken, '大家好，我是 Debug 小幫手 🤖\n・網站有問題或想調整：打「#回報」從選單選擇，或直接打「#回報 問題描述」，可以接著貼截圖。\n・要更新資料：打「#更新」，從選單選擇資料類型後傳 Excel 檔。\n・查進度、看說明、常用網站：打「#小幫手」。\n一般聊天我不會回、也不會記錄。');
    return;
  }
  // 卡片上的日期時間轉盤（datetimepicker）選完後送回 postback，不是文字訊息
  if (event.type === 'postback' && event.postback) {
    handleLinePostback_(event, groupId, source.userId || 'unknown');
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
  const current = getLinePending_(groupId, userId);
  if (current && (current.kind === 'calAdd' || current.kind === 'calRange') &&
      (LINE_MENU_PATTERN.test(text) || LINE_CAL_MENU_PATTERN.test(text) || LINE_CAL_ADD_PREFIX.test(text) || LINE_REPORT_PREFIX.test(text) || LINE_UPDATE_PREFIX.test(text) || /^[#＃]\s*取消\s*$/.test(text))) {
    CacheService.getScriptCache().remove(`LINE_PENDING_${groupId}_${userId}`);
    if (/^[#＃]\s*取消\s*$/.test(text)) {
      lineReply_(event.replyToken, '已取消這次行程新增。');
      return;
    }
  }

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

  if (LINE_MENU_PATTERN.test(text)) {
    const open = (collectOpenItems_()[groupId] || []).length;
    lineReplyMessages_(event.replyToken, [{ type: 'flex', altText: 'Debug 小幫手選單', contents: buildHelperMenuCard_(open, isLineAdmin_(userId)) }]);
    return;
  }
  if (LINE_STATUS_LIST_PATTERN.test(text)) {
    showOpenItems_(event, groupId);
    return;
  }
  if (LINE_HELP_PATTERN.test(text)) {
    lineReplyMessages_(event.replyToken, [{ type: 'flex', altText: 'Debug 小幫手使用說明', contents: buildHelpCard_() }]);
    return;
  }
  if (LINE_LINKS_PATTERN.test(text)) {
    lineReplyMessages_(event.replyToken, [{ type: 'flex', altText: '常用網站', contents: buildQuickLinksCard_(readQuickLinks_()) }]);
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

  if (LINE_CAL_MENU_PATTERN.test(text)) {
    lineReplyMessages_(event.replyToken, [{ type: 'flex', altText: '工作行事曆：查詢或新增行程', contents: buildCalendarMenuCard_() }]);
    return;
  }
  const calListMatch = text.match(LINE_CAL_LIST_PATTERN);
  if (calListMatch) {
    showCalendarEvents_(event, calListMatch[2] || '');
    return;
  }
  if (LINE_CAL_ADD_PREFIX.test(text)) {
    createCalendarEvent_(event, userId, text.replace(LINE_CAL_ADD_PREFIX, ''));
    return;
  }
  const calEditMatch = text.match(LINE_CAL_EDIT_PATTERN);
  if (calEditMatch) {
    editCalendarEvent_(event, userId, calEditMatch[1], calEditMatch[2]);
    return;
  }
  const calDeleteMatch = text.match(LINE_CAL_DELETE_PATTERN);
  if (calDeleteMatch) {
    deleteCalendarEvent_(event, userId, calDeleteMatch[2], Boolean(calDeleteMatch[1]));
    return;
  }

  // 從 #回報 選單按了「回報問題／提出需求」：這句就是描述
  const waiting = getLinePending_(groupId, userId);
  if (waiting && waiting.kind === 'awaitReport') {
    createLineReport_(event, groupId, userId, text, waiting.mode);
    return;
  }

  // 只有維護者能改狀態；同事打一樣的字照舊當作補充記錄
  const statusMatch = text.match(LINE_STATUS_PATTERN);
  if (statusMatch && isLineAdmin_(userId)) {
    const result = setReportStatus_(statusMatch[1], statusMatch[2]);
    if (result.ok) lineReply_(event.replyToken, `${result.id} 處理狀態：${result.unchanged ? '原本就是' : result.previous + ' → '}${result.status}`);
    else if (result.error === 'invalid status') lineReply_(event.replyToken, `${result.id} 不能用「${statusMatch[2]}」，可用：${REPORT_STATUSES[result.id.charAt(0)].join('／')}`);
    else lineReply_(event.replyToken, `找不到 ${String(statusMatch[1]).toUpperCase()}，請確認編號。`);
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

  // 用轉盤選好日期／時間後，下一句就是行程名稱
  const calPending = getLinePending_(groupId, userId);
  if (calPending && calPending.kind === 'calAdd') {
    if (/^[#＃]/.test(text)) return;
    if (addCalendarEventFromPicker_(event, userId, calPending, text)) {
      CacheService.getScriptCache().remove(`LINE_PENDING_${groupId}_${userId}`);
    }
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

// PN_Project_Map 更新紀錄（另一份 Sheet，指令碼屬性 UPDATE_LOG_SHEET_ID）：Claude 寫入 PN_Project_Map 後追加本次每一筆。
// payload：{ events: [], claudeLog: { key, rows: [[需求編號, 更新日期, 類型, 料號, 這次加入的專案, 更新後專案清單], ...] } }
// 同一「需求編號＋類型＋料號」已存在就略過，重跑不會重複；不發 LINE。
const UPDATE_LOG_TYPES = ['新增', '補標籤', '移除標籤'];
const UPDATE_LOG_MAX_ROWS = 2000;
function handleClaudeLog_(request) {
  const expected = PropertiesService.getScriptProperties().getProperty('CLAUDE_REPLY_KEY');
  if (!expected || String(request.key || '') !== expected) return { ok: false, error: 'unauthorized' };
  const sheetId = PropertiesService.getScriptProperties().getProperty('UPDATE_LOG_SHEET_ID');
  if (!sheetId) return { ok: false, error: 'UPDATE_LOG_SHEET_ID missing' };
  const rows = Array.isArray(request.rows) ? request.rows : [];
  const valid = rows.length > 0 && rows.length <= UPDATE_LOG_MAX_ROWS && rows.every(function (row) {
    return Array.isArray(row) && row.length === 6 && /^U\d{3,}$/.test(String(row[0])) && UPDATE_LOG_TYPES.indexOf(String(row[2])) >= 0 && String(row[3]).trim();
  });
  if (!valid) return { ok: false, error: 'invalid rows' };
  return withLock_(function () {
    const sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    const last = sheet.getLastRow();
    const keyOf = function (row) { return [row[0], row[2], row[3]].map(function (v) { return String(v).trim(); }).join('|'); };
    const seen = {};
    if (last >= 2) sheet.getRange(2, 1, last - 1, 6).getValues().forEach(function (row) { seen[keyOf(row)] = true; });
    const fresh = [];
    rows.forEach(function (row) { const key = keyOf(row); if (seen[key]) return; seen[key] = true; fresh.push(row.map(function (v) { return sheetText_(String(v)); })); });
    if (fresh.length) sheet.getRange(last + 1, 1, fresh.length, 6).setValues(fresh);
    return { ok: true, before: Math.max(last - 1, 0), appended: fresh.length, skipped: rows.length - fresh.length, after: Math.max(last - 1, 0) + fresh.length };
  });
}

function handleClaudeStatus_(request) {
  const expected = PropertiesService.getScriptProperties().getProperty('CLAUDE_REPLY_KEY');
  if (!expected || String(request.key || '') !== expected) return { ok: false, error: 'unauthorized' };
  return setReportStatus_(request.id, request.status, request.project, request.summary);
}

/**
 * 本機門鈴每分鐘呼叫：回傳 F／U 每列的編號、處理狀態、同事補充時間，讓本機比對 processed.json 決定要不要叫醒 Claude。
 * payload：{ events: [], claudePending: { key } }；只讀，不寫 Sheet、不發 LINE。
 */
function handleClaudePending_(request) {
  const expected = PropertiesService.getScriptProperties().getProperty('CLAUDE_REPLY_KEY');
  if (!expected || String(request.key || '') !== expected) return { ok: false, error: 'unauthorized' };
  const book = SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID'));
  const items = [];
  [[FEEDBACK_SHEET, 'F'], [DATA_REQUEST_SHEET, 'U']].forEach(function (pair) {
    const sheet = book.getSheetByName(pair[0]);
    const lastRow = sheet ? sheet.getLastRow() : 0;
    if (lastRow < 5) return;
    const timeColumn = SUPPLEMENT_COLUMNS[pair[1]].time;
    sheet.getRange(5, 1, lastRow - 4, timeColumn).getValues().forEach(function (row) {
      const id = String(row[0] || '').trim();
      if (!/^[FU]\d{3,}$/.test(id) || id.charAt(0) !== pair[1]) return;
      const time = row[timeColumn - 1];
      items.push({ id: id, status: String(row[6] || ''), supplementAt: time instanceof Date ? time.toISOString() : String(time || '') });
    });
  });
  return { ok: true, items: items };
}

/** 改 BOM Feedback／Data Requests 的處理狀態（G 欄）；只接受該分頁下拉選單有的值。U 列可另帶 project 寫入「判定專案」欄（N 欄），F 列可另帶 summary 寫入「問題摘要」欄（T 欄），其他欄位不動。 */
function setReportStatus_(rawId, rawStatus, rawProject, rawSummary) {
  const id = String(rawId || '').trim().toUpperCase();
  if (!/^[FU]\d{3,}$/.test(id)) return { ok: false, error: 'invalid id' };
  const status = String(rawStatus || '').trim();
  const isData = id.charAt(0) === 'U';
  const columns = isData ? DATA_COLUMNS : LINE_COLUMNS;
  return withLock_(function () {
    const sheet = isData
      ? SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID')).getSheetByName(DATA_REQUEST_SHEET)
      : getSheet_(FEEDBACK_SHEET);
    const rowNumber = sheet ? findFeedbackRow_(sheet, id) : 0;
    if (!rowNumber) return { ok: false, id: id, error: 'id not found' };
    if (REPORT_STATUSES[id.charAt(0)].indexOf(status) < 0) return { ok: false, id: id, error: 'invalid status' };
    const project = isData ? String(rawProject || '').trim().slice(0, 100) : '';
    if (project) {
      if (!sheet.getRange(4, columns.project).getValue()) sheet.getRange(4, columns.project).setValue('判定專案');
      sheet.getRange(rowNumber, columns.project).setValue(sheetText_(project));
    }
    const summary = isData ? '' : String(rawSummary || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (summary) {
      if (!sheet.getRange(4, FEEDBACK_EXTRA_COLUMNS.summary).getValue()) sheet.getRange(4, FEEDBACK_EXTRA_COLUMNS.summary, 1, 2).setValues([['問題摘要', '修好提醒時間']]);
      sheet.getRange(rowNumber, FEEDBACK_EXTRA_COLUMNS.summary).setValue(sheetText_(summary));
    }
    const extra = Object.assign(project ? { project: project } : {}, summary ? { summary: summary } : {});
    const cell = sheet.getRange(rowNumber, columns.status);
    const previous = String(cell.getValue() || '');
    if (previous === status) return Object.assign({ ok: true, id: id, previous: previous, status: status, unchanged: true }, extra);
    cell.setValue(status);
    return Object.assign({ ok: true, id: id, previous: previous, status: status }, extra);
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
        { type: 'text', text: `${String(card.project || '資料')} 更新完成`, weight: 'bold', wrap: true },
        { type: 'text', text: `${id} · PN_Project_Map${card.date ? ' · ' + String(card.date) : ''}`, size: 'xs' }
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
        { type: 'text', text: footerText, size: 'xxs', color: '#5F6368', align: 'center' }
      ].filter(Boolean)
    }
  };
  return toyCard_(bubble, { tone: 'g', icon: 'done', source: '維護人員已確認', state: { kind: 'done', text: '已完成更新' } });
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
        { type: 'text', text: todo.status === '進行中' ? '🔄 進行中' : '⬜ 待辦', size: 'xs', weight: 'bold', align: 'end', flex: 3 }
      ]
    };
  });
  if (todos.length > shown.length) rows.push({ type: 'text', text: `…另有 ${todos.length - shown.length} 項，請看 Sheet「${TODO_SHEET}」分頁`, size: 'xs', color: '#5F6368', wrap: true });
  return toyCard_({
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: `📝 待辦清單（${todos.length} 項未完成）`, weight: 'bold' },
        { type: 'text', text: '只有維護者看得到', size: 'xs' }
      ]
    },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: rows },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: '完成打「T001 完成」，也可以打「T001 進行中」「T001 取消」', size: 'xxs', color: '#5F6368', align: 'center', wrap: true }]
    }
  }, { tone: 'n', icon: 'todo', source: `${TODO_SHEET} 分頁`, state: { kind: 'work', text: `未完成 ${todos.length} 項` } });
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

// ---------- 行事曆（Google「工作」行事曆，LINE_CALENDAR_ID） ----------
// 日期以「台北日序號」計算（1970-01-01 起第幾天，UTC+8、無夏令時間），不依賴指令碼時區。
// 每筆行程在 Google 日曆的私人標籤記 lineId（C001 起）與 lineCreator（建立者的 LINE 使用者 ID）；日曆畫面看不到標籤。
// 跟群組的 LINE「活動」是兩套：LINE 沒有開放機器人讀寫「活動」，兩邊不會自動同步。

function calendarNow_() {
  return new Date();
}

function taipeiDayToYmd_(day) {
  const date = new Date(day * 86400000);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

function ymdToTaipeiDay_(y, m, d) {
  const time = Date.UTC(y, m - 1, d);
  const date = new Date(time);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return Math.floor(time / 86400000);
}

function taipeiInstant_(day, minutes) {
  return new Date(day * 86400000 + minutes * 60000 - 8 * 3600000);
}

// 全天行程用台北中午：CalendarApp 只取日期部分，中午在任何時區都不會跑到前一天或後一天
function taipeiNoon_(day) {
  return taipeiInstant_(day, 12 * 60);
}

function taipeiMinutes_(date) {
  const shifted = new Date(date.getTime() + 8 * 3600000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** 今天／明天／後天、週五（今天起最近一個）、下週一、10/15、2027/1/5 → 台北日序號；看不懂回 null。 */
function parseCalendarDay_(token, today) {
  const text = String(token || '').trim();
  const relative = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 後天: 2 };
  if (Object.prototype.hasOwnProperty.call(relative, text)) return today + relative[text];
  const week = text.match(/^(下)?(?:週|周|星期|禮拜)([一二三四五六日天])$/);
  if (week) {
    const target = (LINE_CAL_WEEKDAYS.indexOf(week[2] === '天' ? '日' : week[2]) + 6) % 7;
    const current = (new Date(today * 86400000).getUTCDay() + 6) % 7;
    return week[1] ? today - current + 7 + target : today + (target - current + 7) % 7;
  }
  const date = text.match(/^(?:(\d{4})[\/.])?(\d{1,2})[\/.](\d{1,2})$/);
  if (!date) return null;
  const thisYear = taipeiDayToYmd_(today).y;
  let day = ymdToTaipeiDay_(date[1] ? Number(date[1]) : thisYear, Number(date[2]), Number(date[3]));
  // 沒寫年份又早於 60 天前，當作明年（12 月排 1/5 的行程）
  if (day !== null && !date[1] && day < today - 60) day = ymdToTaipeiDay_(thisYear + 1, Number(date[2]), Number(date[3]));
  return day;
}

/** 「10/15」或「10/15-10/17」（也收 ~ ～ 到 至）→ { start, end }；日期本身不用「-」，才不會跟區間混淆。 */
function parseCalendarDayRange_(token, today) {
  const parts = String(token || '').split(/[~～到至-]/);
  if (parts.length > 2) return null;
  const start = parseCalendarDay_(parts[0], today);
  if (start === null) return null;
  if (parts.length === 1) return { start: start, end: start };
  const end = parseCalendarDay_(parts[1], today);
  return end === null ? null : { start: start, end: end };
}

/** 「14:00」「9:30-10:30」「14點半」「14:00-16」→ { start, end } 分鐘數；開始時間一定要有冒號或「點」，避免把「3 號產線」當時間。 */
function parseCalendarTimeRange_(token) {
  const parts = String(token || '').split(/[~～到至-]/);
  if (parts.length > 2) return null;
  const toMinutes = function (value, isEnd) {
    const match = String(value).trim().match(isEnd ? /^(\d{1,2})(?:[:：](\d{2})|點(半)?)?$/ : /^(\d{1,2})(?:[:：](\d{2})|點(半)?)$/);
    if (!match) return null;
    const hour = Number(match[1]), minute = match[3] ? 30 : Number(match[2] || 0);
    if (minute > 59 || hour > 24 || (hour === 24 && (!isEnd || minute))) return null;
    return hour * 60 + minute;
  };
  const start = toMinutes(parts[0], false);
  if (start === null) return null;
  if (parts.length === 1) return { start: start, end: null };
  const end = toMinutes(parts[1], true);
  return end === null ? null : { start: start, end: end };
}

/** 新增／修改共用：［日期或日期區間］［時間］［名稱］，三段都可省略，由呼叫端判斷缺什麼。 */
function parseCalendarSpec_(text, today) {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  const spec = { range: null, time: null, title: '', error: '' };
  let index = 0;
  if (index < tokens.length) {
    spec.range = parseCalendarDayRange_(tokens[index], today);
    if (spec.range) index += 1;
  }
  if (index < tokens.length) {
    spec.time = parseCalendarTimeRange_(tokens[index]);
    if (spec.time) index += 1;
  }
  spec.title = tokens.slice(index).join(' ');
  if (spec.range && spec.range.end < spec.range.start) spec.error = '結束日期要晚於開始日期';
  else if (spec.range && spec.range.end - spec.range.start + 1 > LINE_CAL_RANGE_MAX_DAYS) spec.error = `一筆行程最多 ${LINE_CAL_RANGE_MAX_DAYS} 天`;
  else if (spec.range && !isInCalendarWindow_(spec.range.start, spec.range.end, today)) spec.error = `日期只能在今天前 ${LINE_CAL_PAST_DAYS} 天到後 ${LINE_CAL_FUTURE_DAYS} 天內`;
  else if (spec.range && spec.time && spec.range.end !== spec.range.start) spec.error = '跨天行程請不要寫時間（會建成全天）';
  else if (spec.time && spec.time.end !== null && spec.time.end <= spec.time.start) spec.error = '結束時間要晚於開始時間';
  return spec;
}

/** 「#行程」後面的查詢範圍：空白＝今天起 7 天；本週／下週／本月；單日或日期區間（最多 31 天）。 */
function parseCalendarListRange_(arg, today) {
  const text = String(arg || '').trim();
  const monday = today - (new Date(today * 86400000).getUTCDay() + 6) % 7;
  if (!text) return { start: today, end: today + 6 };
  if (/^(本|這)(週|周)$/.test(text)) return { start: today, end: monday + 6 };
  if (/^下(週|周)$/.test(text)) return { start: monday + 7, end: monday + 13 };
  if (/^(本月|這個月)$/.test(text)) {
    const ymd = taipeiDayToYmd_(today);
    return { start: today, end: ymdToTaipeiDay_(ymd.m === 12 ? ymd.y + 1 : ymd.y, ymd.m === 12 ? 1 : ymd.m + 1, 1) - 1 };
  }
  const range = parseCalendarDayRange_(text, today);
  if (!range || range.end < range.start || range.end - range.start + 1 > LINE_CAL_RANGE_MAX_DAYS) return null;
  return isInCalendarWindow_(range.start, range.end, today) ? range : null;
}

/** 卡片上顯示的行事曆名稱：跟 setupLineCalendar 找的名稱一致（LINE_CALENDAR_NAME，預設「工作」）。 */
function calendarDisplayName_() {
  return String(PropertiesService.getScriptProperties().getProperty('LINE_CALENDAR_NAME') || '工作').trim() || '工作';
}

function getLineCalendar_(event) {
  const id = PropertiesService.getScriptProperties().getProperty('LINE_CALENDAR_ID');
  const calendar = id ? CalendarApp.getCalendarById(id) : null;
  if (!calendar) lineReply_(event.replyToken, '行事曆還沒設定好，請維護人員在 Apps Script 執行 setupLineCalendar。');
  return calendar;
}

// 在 Google 日曆設成「私人」的行程不給 LINE 看，也不能從 LINE 改
function isHiddenCalendarEvent_(calEvent) {
  const visibility = calEvent.getVisibility();
  return visibility === CalendarApp.Visibility.PRIVATE || visibility === CalendarApp.Visibility.CONFIDENTIAL;
}

/** 沒有編號的行程（例如直接在 Google 日曆建的）補上 C 編號；重複行程不編號，只能在 Google 日曆改。 */
function ensureCalendarIds_(calEvents) {
  if (calEvents.some(function (calEvent) { return !calEvent.isRecurringEvent() && !calEvent.getTag('lineId'); })) {
    withLock_(function () { assignCalendarIdsLocked_(calEvents); });
  }
  cacheCalendarIds_(calEvents);
}

/** 呼叫端必須已拿到 withLock_。 */
function assignCalendarIdsLocked_(calEvents) {
  const properties = PropertiesService.getScriptProperties();
  let next = Number(properties.getProperty('LINE_CAL_SEQ') || 0);
  const start = next;
  calEvents.forEach(function (calEvent) {
    if (calEvent.isRecurringEvent() || calEvent.getTag('lineId')) return;
    next += 1;
    calEvent.setTag('lineId', `C${String(next).padStart(3, '0')}`);
  });
  if (next !== start) properties.setProperty('LINE_CAL_SEQ', String(next));
}

function cacheCalendarIds_(calEvents) {
  const cache = CacheService.getScriptCache();
  calEvents.forEach(function (calEvent) {
    const id = calEvent.getTag('lineId');
    if (id) cache.put(`cal:${id}`, calEvent.getId(), 21600);
  });
}

// 查詢、新增、修改都只限這段期間，編號過期後掃描找得回來
function isInCalendarWindow_(startDay, endDay, today) {
  return startDay >= today - LINE_CAL_PAST_DAYS && endDay < today + LINE_CAL_FUTURE_DAYS;
}

function findCalendarEvent_(calendar, id) {
  const cached = CacheService.getScriptCache().get(`cal:${id}`);
  if (cached) {
    const hit = calendar.getEventById(cached);
    if (hit && hit.getTag('lineId') === id) return hit;
  }
  const today = taipeiParts_(calendarNow_()).day;
  return calendar.getEvents(taipeiInstant_(today - LINE_CAL_PAST_DAYS, 0), taipeiInstant_(today + LINE_CAL_FUTURE_DAYS, 0))
    .filter(function (calEvent) { return calEvent.getTag('lineId') === id; })[0] || null;
}

function calendarEventView_(calEvent) {
  const view = {
    id: String(calEvent.getTag('lineId') || ''),
    title: String(calEvent.getTitle() || '（無標題）'),
    allDay: calEvent.isAllDayEvent()
  };
  if (view.allDay) {
    // 全天行程的日期依指令碼時區給；Google 的結束日是「最後一天的隔天」
    const zone = Session.getScriptTimeZone();
    const toDay = function (date) {
      const parts = Utilities.formatDate(date, zone, 'yyyy-MM-dd').split('-').map(Number);
      return ymdToTaipeiDay_(parts[0], parts[1], parts[2]);
    };
    view.startDay = toDay(calEvent.getAllDayStartDate());
    view.endDay = Math.max(view.startDay, toDay(calEvent.getAllDayEndDate()) - 1);
  } else {
    const start = calEvent.getStartTime(), end = calEvent.getEndTime();
    view.startDay = taipeiParts_(start).day;
    view.startMinutes = taipeiMinutes_(start);
    view.endDay = taipeiParts_(end).day;
    view.endMinutes = taipeiMinutes_(end);
    view.durationMs = end.getTime() - start.getTime();
  }
  return view;
}

function formatCalendarDay_(day) {
  const ymd = taipeiDayToYmd_(day);
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return `${pad(ymd.m)}/${pad(ymd.d)}（${LINE_CAL_WEEKDAYS.charAt(new Date(day * 86400000).getUTCDay())}）`;
}

function formatCalendarClock_(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function formatCalendarTime_(view) {
  if (view.allDay) return view.endDay > view.startDay ? `全天，到 ${formatCalendarDay_(view.endDay)}` : '全天';
  const end = view.endDay > view.startDay ? `${formatCalendarDay_(view.endDay)} ${formatCalendarClock_(view.endMinutes)}` : formatCalendarClock_(view.endMinutes);
  return `${formatCalendarClock_(view.startMinutes)}-${end}`;
}

function describeCalendarEvent_(view) {
  return `${view.id ? view.id + ' ' : ''}${formatCalendarDay_(view.startDay)} ${formatCalendarTime_(view)} ${view.title}`;
}

function showCalendarEvents_(event, arg) {
  const today = taipeiParts_(calendarNow_()).day;
  const range = parseCalendarListRange_(arg, today);
  if (!range) {
    lineReply_(event.replyToken, `看不懂要查哪幾天，可以打：\n#行程（今天起 7 天）\n#行程 明天／本週／下週／本月\n#行程 10/15 或 #行程 10/15-10/20\n一次最多 ${LINE_CAL_RANGE_MAX_DAYS} 天，可查今天前 ${LINE_CAL_PAST_DAYS} 天到後 ${LINE_CAL_FUTURE_DAYS} 天內`);
    return;
  }
  const calendar = getLineCalendar_(event);
  if (!calendar) return;
  const calEvents = calendar.getEvents(taipeiInstant_(range.start, 0), taipeiInstant_(range.end + 1, 0))
    .filter(function (calEvent) { return !isHiddenCalendarEvent_(calEvent); });
  ensureCalendarIds_(calEvents);
  const views = calEvents.map(calendarEventView_);
  const label = range.start === range.end ? formatCalendarDay_(range.start) : `${formatCalendarDay_(range.start)}～${formatCalendarDay_(range.end)}`;
  if (!views.length) {
    lineReply_(event.replyToken, `${label} 沒有行程 📅\n要新增打「#新增行程 10/15 14:00 會議名稱」`);
    return;
  }
  lineReplyMessages_(event.replyToken, [{ type: 'flex', altText: `行程 ${label}：${views.length} 筆`, contents: buildCalendarListCard_(views, range, label) }]);
}

function buildCalendarListCard_(views, range, label) {
  const shown = views.slice(0, LINE_CAL_LIST_MAX);
  const rows = [];
  let lastDay = null;
  shown.forEach(function (view) {
    // 從查詢範圍之前就開始的跨天行程，列在第一天
    const day = Math.max(view.startDay, range.start);
    if (day !== lastDay) {
      rows.push({ type: 'text', text: formatCalendarDay_(day), size: 'sm', weight: 'bold', color: '#1A56B8', margin: rows.length ? 'lg' : 'none' });
      lastDay = day;
    }
    rows.push({
      type: 'box', layout: 'horizontal', spacing: 'sm',
      contents: [
        { type: 'text', text: view.id || '🔁 重複', size: 'xs', weight: 'bold', color: '#1449A3', flex: 2 },
        { type: 'text', text: formatCalendarTime_(view), size: 'xs', color: '#5F6368', wrap: true, flex: 3 },
        { type: 'text', text: view.title.slice(0, 60), size: 'sm', wrap: true, flex: 6 }
      ]
    });
  });
  if (views.length > shown.length) rows.push({ type: 'text', text: `…另有 ${views.length - shown.length} 筆，請縮小日期範圍或看 Google 日曆`, size: 'xs', color: '#5F6368', wrap: true, margin: 'lg' });
  return toyCard_({
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: `📅 工作行程（${views.length} 筆）`, weight: 'bold' },
        { type: 'text', text: label, size: 'xs', wrap: true }
      ]
    },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
          helperButton_('secondary', '', '下週', '#行程 下週'),
          helperButton_('primary', '', '＋ 新增', '#行事曆')
        ] },
        { type: 'text', text: '改：#改行程 C001 10/16　刪：#刪行程 C001\n🔁 重複行程請到 Google 日曆修改', size: 'xxs', color: '#5F6368', wrap: true, align: 'center' }
      ]
    }
  }, { tone: 'b', icon: 'calendar', source: `Google「${calendarDisplayName_()}」行事曆`, state: { kind: 'info', text: `${views.length} 筆` } });
}

function createCalendarEvent_(event, userId, rawText) {
  const today = taipeiParts_(calendarNow_()).day;
  const spec = parseCalendarSpec_(rawText, today);
  if (!spec.range || !spec.title) {
    lineReply_(event.replyToken, '請照這個格式：\n#新增行程 10/15 14:00-15:00 P3 BOM 會議\n・不寫時間＝全天：#新增行程 10/15 出差\n・日期可寫 今天／明天／週五／下週一\n・跨天：#新增行程 10/15-10/17 出差\n・只寫開始時間＝1 小時');
    return;
  }
  if (spec.error) {
    lineReply_(event.replyToken, `${spec.error}，請再送一次。`);
    return;
  }
  insertCalendarEvent_(event, userId, spec, spec.title);
}

/** 轉盤選好日期後回的名稱：日期、時間已在 pending，這句只當名稱。 */
function addCalendarEventFromPicker_(event, userId, pending, rawTitle) {
  const today = taipeiParts_(calendarNow_()).day;
  if (!isInCalendarWindow_(pending.range.start, pending.range.end, today)) {
    lineReply_(event.replyToken, '日期已超出可新增範圍，請打「#行事曆」重新選擇。');
    return false;
  }
  return insertCalendarEvent_(event, userId, { range: pending.range, time: pending.time }, rawTitle);
}

/** 打字與轉盤共用：檢查名稱 → 同一把鎖內查重複並建立 → 回完成卡片。 */
function insertCalendarEvent_(event, userId, spec, rawTitle) {
  let title;
  try {
    title = safeText_(rawTitle, 100, true);
    if (!title.trim()) throw new Error('Empty title');
  } catch (lengthError) {
    lineReply_(event.replyToken, '行程名稱不可空白、最多 100 字，請調整後再送一次。');
    return;
  }
  const calendar = getLineCalendar_(event);
  if (!calendar) return;
  let start = null, end = null;
  if (spec.time) {
    start = taipeiInstant_(spec.range.start, spec.time.start);
    end = spec.time.end !== null ? taipeiInstant_(spec.range.start, spec.time.end) : new Date(start.getTime() + 3600000);
  }
  // 檢查重複到建立放在同一把鎖裡：兩人同時送出或 LINE 重送 webhook，也只會建一筆
  const result = withLock_(function () {
    // 同一天同名、同開始時間（或同為全天）視為重複，避免 LINE「活動」和這裡各記一次時又多一筆；私人行程不比對，免得在群組露出
    const duplicate = calendar.getEvents(taipeiInstant_(spec.range.start, 0), taipeiInstant_(spec.range.start + 1, 0)).filter(function (calEvent) {
      if (isHiddenCalendarEvent_(calEvent) || calEvent.getTitle() !== title) return false;
      return start ? !calEvent.isAllDayEvent() && calEvent.getStartTime().getTime() === start.getTime() : calEvent.isAllDayEvent();
    })[0];
    if (duplicate) {
      assignCalendarIdsLocked_([duplicate]);
      return { calEvent: duplicate, duplicate: true };
    }
    const options = { description: '由 LINE Debug 小幫手新增' };
    const created = start
      ? calendar.createEvent(title, start, end, options)
      : calendar.createAllDayEvent(title, taipeiNoon_(spec.range.start), taipeiNoon_(spec.range.end + 1), options);
    // LINE 沒給使用者 ID 時不記建立者（大家都會是 unknown），這筆只有維護者能改
    if (userId && userId !== 'unknown') created.setTag('lineCreator', userId);
    assignCalendarIdsLocked_([created]);
    return { calEvent: created, duplicate: false };
  });
  cacheCalendarIds_([result.calEvent]);
  if (result.duplicate) {
    lineReply_(event.replyToken, `已經有一樣的行程，沒有重複新增：\n${describeCalendarEvent_(calendarEventView_(result.calEvent))}`);
    return true;
  }
  const view = calendarEventView_(result.calEvent);
  lineReplyMessages_(event.replyToken, [{ type: 'flex', altText: `已新增到工作行事曆：${describeCalendarEvent_(view)}`.slice(0, 390), contents: buildCalendarDoneCard_(view) }]);
  return true;
}

/** 找出可以改／刪的行程：找不到、私人、重複行程或不是自己建的，都直接回覆原因並回 null。 */
function loadEditableCalendarEvent_(event, userId, id) {
  const calendar = getLineCalendar_(event);
  if (!calendar) return null;
  const calEvent = findCalendarEvent_(calendar, id);
  if (!calEvent || isHiddenCalendarEvent_(calEvent)) {
    lineReply_(event.replyToken, `找不到 ${id}，請先打「#行程」看編號。`);
    return null;
  }
  if (calEvent.isRecurringEvent()) {
    lineReply_(event.replyToken, `${id} 是重複行程，請到 Google 日曆修改。`);
    return null;
  }
  const creator = String(calEvent.getTag('lineCreator') || '');
  if (!isLineAdmin_(userId) && (!creator || creator === 'unknown' || creator !== userId)) {
    lineReply_(event.replyToken, `${id} 不是你在 LINE 新增的，只有建立的人或維護人員能改；需要調整請跟維護人員說 🙏`);
    return null;
  }
  return calEvent;
}

function editCalendarEvent_(event, userId, rawId, rest) {
  const usage = '改行程請寫編號和要改的內容，例如：\n#改行程 C001 10/16（改日期）\n#改行程 C001 15:00-16:00（改時間）\n#改行程 C001 10/16 15:00 新名稱（一起改）\n編號打「#行程」查';
  const today = taipeiParts_(calendarNow_()).day;
  const spec = parseCalendarSpec_(rest, today);
  if (!rawId || (!spec.range && !spec.time && !spec.title)) {
    lineReply_(event.replyToken, usage);
    return;
  }
  if (spec.error) {
    lineReply_(event.replyToken, `${spec.error}，請再送一次。`);
    return;
  }
  let title = '';
  try {
    if (spec.title) title = safeText_(spec.title, 100, true);
  } catch (lengthError) {
    lineReply_(event.replyToken, '行程名稱最多 100 字，請精簡後再送一次。');
    return;
  }
  const id = rawId.toUpperCase();
  const calEvent = loadEditableCalendarEvent_(event, userId, id);
  if (!calEvent) return;
  const before = calendarEventView_(calEvent);
  if (spec.time) {
    // 只改時間：日期不變；沒寫結束時間就保留原本長度（全天改成有時間的預設 1 小時）
    const day = spec.range ? spec.range.start : before.startDay;
    const start = taipeiInstant_(day, spec.time.start);
    const end = spec.time.end !== null ? taipeiInstant_(day, spec.time.end) : new Date(start.getTime() + (before.allDay ? 3600000 : before.durationMs));
    calEvent.setTime(start, end);
  } else if (spec.range) {
    if (before.allDay || spec.range.end > spec.range.start) {
      // 全天行程改日期保留原本天數；寫了日期區間就照區間
      const length = spec.range.end > spec.range.start ? spec.range.end - spec.range.start : (before.allDay ? before.endDay - before.startDay : 0);
      calEvent.setAllDayDates(taipeiNoon_(spec.range.start), taipeiNoon_(spec.range.start + length + 1));
    } else {
      // 有時間的行程只改日期：整段平移，時間不變
      const shift = (spec.range.start - before.startDay) * 86400000;
      calEvent.setTime(new Date(calEvent.getStartTime().getTime() + shift), new Date(calEvent.getEndTime().getTime() + shift));
    }
  }
  if (title) calEvent.setTitle(title);
  lineReply_(event.replyToken, `已更新 ✏️\n原本：${describeCalendarEvent_(before)}\n現在：${describeCalendarEvent_(calendarEventView_(calEvent))}`);
}

function deleteCalendarEvent_(event, userId, rawId, confirmed) {
  if (!rawId) {
    lineReply_(event.replyToken, '刪除請寫編號，例如「#刪行程 C001」；編號打「#行程」查。');
    return;
  }
  const id = rawId.toUpperCase();
  const calEvent = loadEditableCalendarEvent_(event, userId, id);
  if (!calEvent) return;
  const view = calendarEventView_(calEvent);
  // 先回確認卡片，按了「確認刪除」才真的刪
  if (!confirmed) {
    lineReplyMessages_(event.replyToken, [{ type: 'flex', altText: `確定要刪除 ${id}？`, contents: buildCalendarDeleteCard_(view) }]);
    return;
  }
  calEvent.deleteEvent();
  CacheService.getScriptCache().remove(`cal:${id}`);
  lineReply_(event.replyToken, `已刪除 🗑️\n${describeCalendarEvent_(view)}\n刪錯了可以到 Google 日曆的「垃圾桶」在 30 天內還原。`);
}

function buildCalendarDeleteCard_(view) {
  return toyCard_({
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: '🗑️ 確定要刪除這筆行程？', weight: 'bold' },
        { type: 'text', text: '按「確認刪除」才會刪', size: 'xs' }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: [
        { type: 'text', text: view.title, size: 'md', weight: 'bold', wrap: true },
        { type: 'text', text: `${view.id}　${formatCalendarDay_(view.startDay)} ${formatCalendarTime_(view)}`, size: 'sm', color: '#5F6368', wrap: true }
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: [
        helperButton_('primary', '', `確認刪除 ${view.id}`, `#確認刪行程 ${view.id}`),
        { type: 'text', text: '不刪就不用理它；刪錯可在 Google 日曆垃圾桶 30 天內還原', size: 'xxs', color: '#5F6368', align: 'center' }
      ]
    }
  }, { tone: 'c', icon: 'trash', source: `「${calendarDisplayName_()}」行事曆`, state: { kind: 'ask', text: '等你確認' } });
}

/** 在編輯器執行一次：找名為「工作」（或 LINE_CALENDAR_NAME）的行事曆，ID 存進 LINE_CALENDAR_ID；第一次執行會要求日曆授權。 */
function setupLineCalendar() {
  const properties = PropertiesService.getScriptProperties();
  const name = properties.getProperty('LINE_CALENDAR_NAME') || '工作';
  const calendars = CalendarApp.getCalendarsByName(name);
  if (calendars.length !== 1) {
    return logSetupResult_(`找到 ${calendars.length} 本名為「${name}」的行事曆；請確認名稱，可在指令碼屬性 LINE_CALENDAR_NAME 填正確名稱後再執行一次`);
  }
  properties.setProperty('LINE_CALENDAR_ID', calendars[0].getId());
  const zone = Session.getScriptTimeZone();
  return logSetupResult_(`已連結行事曆「${name}」；指令碼時區 ${zone}${zone === 'Asia/Taipei' ? '' : '（建議到「專案設定」改成 Asia/Taipei）'}`);
}

// ---------- 行事曆轉盤（datetimepicker → postback） ----------

function taipeiDateString_(day) {
  const ymd = taipeiDayToYmd_(day);
  return `${ymd.y}-${String(ymd.m).padStart(2, '0')}-${String(ymd.d).padStart(2, '0')}`;
}

function calendarPicker_(style, label, data, mode, initialDay, minDay, maxDay) {
  const tail = mode === 'datetime' ? 'T09:00' : '';
  const action = { type: 'datetimepicker', label: label, data: data, mode: mode, initial: taipeiDateString_(initialDay) + tail, min: taipeiDateString_(minDay) + (mode === 'datetime' ? 'T00:00' : ''), max: taipeiDateString_(maxDay) + (mode === 'datetime' ? 'T23:59' : '') };
  // LINE 要求 min < max；只剩一天時省略 min，回傳仍由伺服端檢查。
  if (action.min === action.max) delete action.min;
  const button = { type: 'button', style: style, height: 'sm', action: action };
  return button;
}

function parsePostbackData_(raw) {
  const out = Object.create(null);
  try {
    String(raw || '').split('&').forEach(function (pair) {
      const index = pair.indexOf('=');
      if (index <= 0) throw new Error('Invalid pair');
      const key = decodeURIComponent(pair.slice(0, index));
      if (Object.prototype.hasOwnProperty.call(out, key)) throw new Error('Duplicate key');
      out[key] = decodeURIComponent(pair.slice(index + 1));
    });
  } catch (error) {
    return Object.create(null);
  }
  return out;
}

/** 轉盤回傳 date「2026-10-15」或 datetime「2026-10-15T14:00」→ { day, minutes }；minutes 只有選時間時才有。 */
function parsePickerValue_(params) {
  if (!params || (typeof params.date === 'string') === (typeof params.datetime === 'string')) return null;
  const timed = typeof params.datetime === 'string';
  const match = String(timed ? params.datetime : params.date).match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2}))?$/);
  if (!match) return null;
  if (timed !== (match[4] !== undefined) || Number(match[1]) < 1900 || Number(match[1]) > 2100 || Number(match[4]) > 23 || Number(match[5]) > 59) return null;
  const day = ymdToTaipeiDay_(Number(match[1]), Number(match[2]), Number(match[3]));
  if (day === null) return null;
  return { day: day, minutes: match[4] === undefined ? null : Number(match[4]) * 60 + Number(match[5]) };
}

function handleLinePostback_(event, groupId, userId) {
  const data = parsePostbackData_(event.postback.data);
  if (data.cal) handleCalendarPostback_(event, groupId, userId, data, event.postback.params || {});
}

function handleCalendarPostback_(event, groupId, userId, data, params) {
  if (['list', 'edit', 'add'].indexOf(data.cal) < 0) return;
  if (data.cal === 'add' && ['allday', 'timed', 'range1', 'range2'].indexOf(data.mode) < 0) return;
  if (data.cal === 'add' && (!userId || userId === 'unknown')) {
    lineReply_(event.replyToken, '無法識別使用者，請用「#新增行程 日期 名稱」一次輸入。');
    return;
  }
  const today = taipeiParts_(calendarNow_()).day;
  const picked = parsePickerValue_(params);
  if (!picked || (data.cal === 'list' && picked.minutes !== null) ||
      (data.cal === 'add' && (data.mode === 'timed') !== (picked.minutes !== null))) {
    lineReply_(event.replyToken, '沒有收到日期，請再按一次按鈕選日期。');
    return;
  }
  const outside = `日期只能在今天前 ${LINE_CAL_PAST_DAYS} 天到後 ${LINE_CAL_FUTURE_DAYS} 天內，請再選一次。`;
  if (data.cal === 'list') {
    const ymd = taipeiDayToYmd_(picked.day);
    showCalendarEvents_(event, `${ymd.y}/${ymd.m}/${ymd.d}`);
    return;
  }
  if (data.cal === 'edit') {
    const id = String(data.id || '').toUpperCase();
    if (!/^C\d{3,}$/.test(id)) return;
    const ymd = taipeiDayToYmd_(picked.day);
    const rest = `${ymd.y}/${ymd.m}/${ymd.d}${picked.minutes === null ? '' : ' ' + formatCalendarClock_(picked.minutes)}`;
    editCalendarEvent_(event, userId, id, rest);
    return;
  }
  if (data.cal !== 'add') return;
  if (data.mode === 'range1') {
    if (!isInCalendarWindow_(picked.day, picked.day, today)) {
      lineReply_(event.replyToken, outside);
      return;
    }
    const token = Utilities.getUuid();
    putLinePending_(groupId, userId, { kind: 'calRange', start: picked.day, token: token });
    lineReplyMessages_(event.replyToken, [{ type: 'flex', altText: `開始日 ${formatCalendarDay_(picked.day)}，請選結束日`, contents: buildCalendarRangeEndCard_(picked.day, today, token) }]);
    return;
  }
  let range, time = null;
  if (data.mode === 'allday') {
    range = { start: picked.day, end: picked.day };
  } else if (data.mode === 'timed' && picked.minutes !== null) {
    range = { start: picked.day, end: picked.day };
    time = { start: picked.minutes, end: null };
  } else if (data.mode === 'range2') {
    const start = Number(data.start);
    const pending = getLinePending_(groupId, userId);
    if (!/^\d+$/.test(String(data.start || '')) || !Number.isSafeInteger(start) || !pending || pending.kind !== 'calRange' || pending.start !== start || !pending.token || data.token !== pending.token) {
      lineReply_(event.replyToken, '請由同一人在 10 分鐘內選結束日；請打「#行事曆」重新選開始日。');
      return;
    }
    if (picked.day < start) {
      lineReply_(event.replyToken, '結束日要在開始日之後，請再選一次。');
      return;
    }
    if (picked.day - start + 1 > LINE_CAL_RANGE_MAX_DAYS) {
      lineReply_(event.replyToken, `一筆行程最多 ${LINE_CAL_RANGE_MAX_DAYS} 天，請再選一次。`);
      return;
    }
    range = { start: start, end: picked.day };
  } else {
    return;
  }
  if (!isInCalendarWindow_(range.start, range.end, today)) {
    lineReply_(event.replyToken, outside);
    return;
  }
  putLinePending_(groupId, userId, { kind: 'calAdd', range: range, time: time });
  lineReply_(event.replyToken, `${formatCalendarPick_(range, time)}\n要記什麼行程？直接回名稱（10 分鐘內有效）\n不新增請打「#取消」或「#小幫手」`);
}

function formatCalendarPick_(range, time) {
  if (time) return `${formatCalendarDay_(range.start)} ${formatCalendarClock_(time.start)} 起（1 小時）`;
  return range.end > range.start ? `${formatCalendarDay_(range.start)}～${formatCalendarDay_(range.end)} 全天` : `${formatCalendarDay_(range.start)} 全天`;
}

// ---------- 積木 UI：統一外框（圖示、來源、狀態、返回選單）；只改呈現，不改指令與權限 ----------

const LINE_TOY_TONES = {
  c: { bg: '#FDEBE8', ink: '#A8322A', btn: '#C9443A' },
  y: { bg: '#FEF6D8', ink: '#7A5A00', btn: '#8A6500' },
  g: { bg: '#E8F5EC', ink: '#17602E', btn: '#1E7A3A' },
  b: { bg: '#E5F0FD', ink: '#1449A3', btn: '#1C5BC4' },
  n: { bg: '#F4F1EA', ink: '#5A5246', btn: '#5A5246' }
};
// 狀態一律「符號＋文字」，不只靠顏色
const LINE_TOY_STATES = {
  wait: ['#E5F0FD', '#1449A3', '✏️'],
  work: ['#E5F0FD', '#1449A3', '⏳'],
  ask: ['#FEF6D8', '#7A5A00', '⏳'],
  done: ['#E8F5EC', '#17602E', '✓'],
  info: ['#F1F3F4', '#3C4043', 'ℹ️']
};
// 沒設定 LINE_ICON_BASE_URL 時，積木格改用這些符號
const LINE_TOY_FALLBACK = { report: '🐞', progress: '📋', data: '🗂️', calendar: '📅', calPlus: '📅', calRange: '📅', more: '🤖', link: '🔗', help: '📖', todo: '📝', quota: '📊', trash: '🗑️', done: '✅' };

/** LINE_ICON_BASE_URL（https，結尾可省略 /）＋圖示名稱.png；未設定就回空字串，卡片不放圖。 */
function lineIconUrl_(name) {
  const base = String(PropertiesService.getScriptProperties().getProperty('LINE_ICON_BASE_URL') || '').trim();
  if (!/^https:\/\/\S+$/i.test(base)) return '';
  return `${base.replace(/\/?$/, '/')}${name}.png`;
}

function toyStatePill_(state) {
  const colors = LINE_TOY_STATES[state.kind] || LINE_TOY_STATES.info;
  return {
    type: 'box', layout: 'vertical', flex: 0, backgroundColor: colors[0], cornerRadius: '12px',
    paddingStart: '8px', paddingEnd: '8px', paddingTop: '2px', paddingBottom: '2px',
    contents: [{ type: 'text', text: `${colors[2]} ${state.text}`, size: 'xs', weight: 'bold', color: colors[1] }]
  };
}

/** 把既有卡片套上積木外框：標題左邊放圖示、內容最上方放「來源／狀態」、底部放「返回功能選單」。 */
function toyCard_(bubble, options) {
  const tone = LINE_TOY_TONES[options.tone] || LINE_TOY_TONES.n;
  const icon = options.icon ? lineIconUrl_(options.icon) : '';
  const polish = function (node) {
    if (!node) return;
    if (node.type === 'text') {
      if (node.size === 'xxs') node.size = 'xs';
      node.wrap = true;
    }
    if (node.type === 'button') {
      if (node.height === 'sm') node.height = 'md';
      if (node.style === 'primary') node.color = tone.btn;
    }
    (node.contents || []).forEach(polish);
  };
  const titles = (bubble.header && bubble.header.contents) || [];
  titles.forEach(polish);
  if (titles[0] && titles[0].type === 'text') {
    titles[0].color = tone.ink;
    titles[0].size = 'lg';
    // 有圖示時，標題前面的表情符號就不重複放
    if (icon) titles[0].text = titles[0].text.replace(/^[^\p{L}\p{N}#＃]+\s*/u, '') || titles[0].text;
  }
  titles.slice(1).forEach(function (node) { if (node.type === 'text') node.color = '#49534F'; });
  bubble.header = {
    type: 'box', layout: 'horizontal', spacing: 'md', alignItems: 'center', backgroundColor: tone.bg, paddingAll: '16px',
    contents: (icon ? [{ type: 'image', url: icon, size: '64px', aspectRatio: '1:1', aspectMode: 'fit', flex: 0 }] : [])
      .concat([{ type: 'box', layout: 'vertical', spacing: 'xs', flex: 1, contents: titles }])
  };
  bubble.body = bubble.body || { type: 'box', layout: 'vertical', contents: [] };
  polish(bubble.body);
  const meta = [];
  if (options.source) meta.push({ type: 'text', text: `來源：${options.source}`, size: 'xs', color: '#5F6368', wrap: true, flex: 1, gravity: 'center' });
  if (options.state) meta.push(toyStatePill_(options.state));
  if (meta.length) bubble.body.contents.unshift({ type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center', contents: meta });
  bubble.footer = bubble.footer || { type: 'box', layout: 'vertical', contents: [] };
  polish(bubble.footer);
  bubble.footer.spacing = bubble.footer.spacing || 'sm';
  if (options.back !== false) bubble.footer.contents.push({ type: 'button', style: 'link', height: 'sm', action: { type: 'message', label: '↩ 返回功能選單', text: '#小幫手' } });
  return bubble;
}

/** 選單上的一顆積木：圖示（或符號）＋大字＋小註記，整格可點。 */
function toyTile_(icon, tone, label, note, text) {
  const url = lineIconUrl_(icon);
  const contents = [url
    ? { type: 'image', url: url, size: '52px', aspectRatio: '1:1', aspectMode: 'fit' }
    : { type: 'text', text: LINE_TOY_FALLBACK[icon] || '🧩', size: 'xl', align: 'center' }];
  contents.push({ type: 'text', text: label, size: 'sm', weight: 'bold', color: '#2B2B2B', align: 'center', wrap: true });
  if (note) contents.push({ type: 'text', text: note, size: 'xs', color: '#5F6368', align: 'center', wrap: true });
  return {
    type: 'box', layout: 'vertical', flex: 1, spacing: 'xs', paddingAll: '8px', cornerRadius: '12px',
    backgroundColor: (LINE_TOY_TONES[tone] || LINE_TOY_TONES.n).bg, justifyContent: 'center',
    action: { type: 'message', label: label.slice(0, 20), text: text }, contents: contents
  };
}

function toyRow_(tiles) {
  const filled = tiles.slice();
  while (filled.length < 3) filled.push({ type: 'box', layout: 'vertical', flex: 1, contents: [{ type: 'filler' }] });
  return { type: 'box', layout: 'horizontal', spacing: 'sm', contents: filled };
}

function buildCalendarMenuCard_() {
  const today = taipeiParts_(calendarNow_()).day;
  const minDay = today - LINE_CAL_PAST_DAYS, maxDay = today + LINE_CAL_FUTURE_DAYS - 1;
  const row = function (items) { return { type: 'box', layout: 'horizontal', spacing: 'sm', contents: items }; };
  return toyCard_({
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', contents: [
      { type: 'text', text: '工作行事曆', weight: 'bold' },
      { type: 'text', text: '查行程或新增，按鈕會跳出日期轉盤', size: 'xs' }
    ] },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: [
        row([helperButton_('secondary', '', '今天', '#行程 今天'), helperButton_('secondary', '', '明天', '#行程 明天')]),
        row([helperButton_('secondary', '', '本週', '#行程 本週'), helperButton_('secondary', '', '下週', '#行程 下週')]),
        calendarPicker_('secondary', '📅 選日期查', 'cal=list', 'date', today, minDay, maxDay),
        { type: 'separator', margin: 'md' },
        { type: 'text', text: '新增行程', size: 'sm', weight: 'bold', color: '#1449A3', margin: 'md' },
        row([
          calendarPicker_('primary', '全天', 'cal=add&mode=allday', 'date', today, minDay, maxDay),
          calendarPicker_('primary', '指定時間', 'cal=add&mode=timed', 'datetime', today, minDay, maxDay)
        ]),
        calendarPicker_('primary', '跨天（先選開始日、再選結束日）', 'cal=add&mode=range1', 'date', today, minDay, maxDay)
      ]
    },
    footer: { type: 'box', layout: 'vertical', contents: [
      { type: 'text', text: '全天：選日期｜指定時間：選日期＋時間｜跨天：先選開始日、再選結束日；選完回一句名稱', size: 'xxs', color: '#5F6368', align: 'center' }
    ] }
  }, { tone: 'b', icon: 'calendar', source: `Google「${calendarDisplayName_()}」行事曆` });
}

function buildCalendarRangeEndCard_(startDay, today, token) {
  const maxDay = Math.min(startDay + LINE_CAL_RANGE_MAX_DAYS - 1, today + LINE_CAL_FUTURE_DAYS - 1);
  return toyCard_({
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', contents: [
      { type: 'text', text: `開始日 ${formatCalendarDay_(startDay)}`, weight: 'bold' },
      { type: 'text', text: '第 2 步／共 3 步：選結束日', size: 'xs' }
    ] },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      calendarPicker_('primary', '📅 選結束日', `cal=add&mode=range2&start=${startDay}&token=${encodeURIComponent(token)}`, 'date', startDay, startDay, maxDay),
      calendarPicker_('secondary', '改開始日', 'cal=add&mode=range1', 'date', startDay, today - LINE_CAL_PAST_DAYS, today + LINE_CAL_FUTURE_DAYS - 1)
    ] },
    footer: { type: 'box', layout: 'vertical', contents: [
      { type: 'text', text: `結束日要在開始日之後，最多 ${LINE_CAL_RANGE_MAX_DAYS} 天；選完回一句名稱`, size: 'xxs', color: '#5F6368', align: 'center' }
    ] }
  }, { tone: 'b', icon: 'calRange', source: `「${calendarDisplayName_()}」行事曆`, state: { kind: 'wait', text: '等你選結束日' }, back: false });
}

function buildCalendarDoneCard_(view) {
  const today = taipeiParts_(calendarNow_()).day;
  const kv = function (label, value) {
    return { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
      { type: 'text', text: label, size: 'sm', color: '#5F6368', flex: 2 },
      { type: 'text', text: value, size: 'sm', wrap: true, flex: 7 }
    ] };
  };
  const timeLabel = view.allDay ? formatCalendarTime_(view) : `${formatCalendarTime_(view)}`;
  const editButton = calendarPicker_('secondary', '🕒 改時間', `cal=edit&id=${view.id}`, view.allDay ? 'date' : 'datetime', view.startDay, today - LINE_CAL_PAST_DAYS, today + LINE_CAL_FUTURE_DAYS - 1);
  if (!view.allDay) editButton.action.initial = taipeiDateString_(view.startDay) + 'T' + formatCalendarClock_(view.startMinutes);
  return toyCard_({
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', contents: [
      { type: 'text', text: `已新增 ${view.id}`, weight: 'bold' },
      { type: 'text', text: `已寫入 Google「${calendarDisplayName_()}」行事曆`, size: 'xs' }
    ] },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'text', text: view.title, size: 'md', weight: 'bold', wrap: true },
      kv('時間', `${formatCalendarDay_(view.startDay)} ${timeLabel}`),
      kv('編號', view.id)
    ] },
    footer: { type: 'box', layout: 'vertical', contents: [
      { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [editButton, helperButton_('secondary', '', '🗑️ 刪除', `#刪行程 ${view.id}`)] },
      { type: 'text', text: `只有建立的人和維護者能改；也可以打「#改行程 ${view.id} 10/16 15:00」`, size: 'xxs', color: '#5F6368', align: 'center' }
    ] }
  }, { tone: 'g', icon: 'done', source: '由 LINE 新增', state: { kind: 'done', text: '已建立' } });
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
  try { sendDailySummary_(new Date()); } catch (error) { console.error(error); }
  try { sendFixedReminders_(new Date()); } catch (error) { console.error(error); }
  sendApprovedLineReplies_();
}

// 每日總表：台北時間 18:00 後第一次執行時，把各群組自己的未結案回報（F）與更新需求（U）推到該群組，每天一次；沒有未結案就不發。
const DAILY_SUMMARY_HOUR = 18;
const DAILY_SUMMARY_MAX_ITEMS = 20;
// 手動提前發總表：在 Apps Script 編輯器選這個函式按「執行」；當天 18:00 的自動發送不會再重複。
function sendDailySummaryNow() {
  sendDailySummary_(new Date(), true);
}

function sendDailySummary_(now, force) {
  const props = PropertiesService.getScriptProperties();
  const hour = Number(Utilities.formatDate(now, 'Asia/Taipei', 'H'));
  const today = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');
  if (!force && (!(hour >= DAILY_SUMMARY_HOUR) || props.getProperty('LINE_SUMMARY_LAST_DATE') === today)) return;
  props.setProperty('LINE_SUMMARY_LAST_DATE', today);

  const byGroup = collectOpenItems_();
  Object.keys(byGroup).forEach(function (groupId) {
    const items = byGroup[groupId];
    const shown = items.slice(0, DAILY_SUMMARY_MAX_ITEMS).map(function (item) { return item.line; });
    const more = items.length > shown.length ? [`…其餘 ${items.length - shown.length} 筆略`] : [];
    const text = [`📋 回報處理進度（${Utilities.formatDate(now, 'Asia/Taipei', 'MM/dd')}）未結案 ${items.length} 筆`, '━━━━━━━━━━━━']
      .concat(shown, more, ['━━━━━━━━━━━━', '有問題打「#回報 問題描述」']).join('\n');
    linePush_(groupId, text);
  });
}

/**
 * 各白名單群組的未結案項目（F：新回饋／處理中；U：新需求／預覽完成），每日總表與「#狀況」共用。
 * 只放編號、工具、問題摘要與狀態，不放同事原文。
 */
function collectOpenItems_() {
  const props = PropertiesService.getScriptProperties();
  const allowed = String(props.getProperty('LINE_GROUP_IDS') || '').split(',').map(function (id) { return id.trim(); }).filter(Boolean);
  const byGroup = {};
  const add = function (groupId, item) { if (allowed.indexOf(groupId) < 0) return; (byGroup[groupId] = byGroup[groupId] || []).push(item); };
  const readRows = function (sheet, width) { return sheet && sheet.getLastRow() >= 5 ? sheet.getRange(5, 1, sheet.getLastRow() - 4, width).getValues() : []; };

  readRows(getSheet_(FEEDBACK_SHEET), FEEDBACK_EXTRA_COLUMNS.summary).forEach(function (row) {
    const id = String(row[0]), status = String(row[LINE_COLUMNS.status - 1]), replyStatus = String(row[LINE_COLUMNS.replyStatus - 1]);
    if (!/^F\d{3,}$/.test(id) || (status !== '新回饋' && status !== '處理中')) return;
    const tool = String(row[4] || '').replace(/^工具：/, '') || '待確認';
    const fixed = replyStatus.indexOf('修好') === 0, replied = replyStatus === '已發送';
    const state = fixed ? `已修好，請試用後回「${id} OK」`
      : replied ? `已回覆，等你回覆或補充（打「${id} 補充內容」）` : '維護者處理中';
    const summary = String(row[FEEDBACK_EXTRA_COLUMNS.summary - 1] || '').trim();
    add(String(row[LINE_COLUMNS.group - 1]), {
      id: id, title: tool, summary: summary, tag: fixed ? '修好待 OK' : replied ? '等你回覆' : '處理中',
      line: `🔸 ${id}｜${tool}${summary ? `\n　${summary}` : ''}\n　${state}`
    });
  });
  const dataSheet = SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID')).getSheetByName(DATA_REQUEST_SHEET);
  readRows(dataSheet, DATA_COLUMNS.project).forEach(function (row) {
    const id = String(row[0]), status = String(row[DATA_COLUMNS.status - 1]);
    if (!/^U\d{3,}$/.test(id) || (status !== '新需求' && status !== '預覽完成')) return;
    const state = status === '預覽完成' ? '比對完成，待維護者確認寫入' : '待維護者處理';
    const project = String(row[DATA_COLUMNS.project - 1] || '').trim();
    const label = project ? `${project}（更新 ${row[DATA_COLUMNS.type - 1] || '待確認'}）` : `更新 ${row[DATA_COLUMNS.type - 1] || '待確認'}`;
    add(String(row[DATA_COLUMNS.group - 1]), {
      id: id, title: label, summary: '', tag: status === '預覽完成' ? '待確認寫入' : '處理中',
      line: `🔸 ${id}｜${label}\n　${state}`
    });
  });
  return byGroup;
}

// 修好提醒：修好通知發出後滿 3 個工作天（週一～週五，不含國定假日）同事還沒回 OK → 在原群組提醒一次，交代前因後果。
// 只在台北時間工作日 09:00～18:00 發；不自動結案，之後仍列在每日總表。
function sendFixedReminders_(now) {
  const taipei = taipeiParts_(now);
  if (taipei.weekday === 0 || taipei.weekday === 6 || taipei.hour < FIXED_REMINDER_HOURS.from || taipei.hour >= FIXED_REMINDER_HOURS.to) return;
  const allowed = String(PropertiesService.getScriptProperties().getProperty('LINE_GROUP_IDS') || '').split(',').map(function (id) { return id.trim(); }).filter(Boolean);
  const sheet = getSheet_(FEEDBACK_SHEET);
  if (sheet.getLastRow() < 5) return;
  const rows = sheet.getRange(5, 1, sheet.getLastRow() - 4, FEEDBACK_EXTRA_COLUMNS.remindedAt).getValues();
  rows.forEach(function (row, index) {
    const id = String(row[0]);
    const status = String(row[LINE_COLUMNS.status - 1]);
    const groupId = String(row[LINE_COLUMNS.group - 1] || '');
    const notifiedAt = row[LINE_COLUMNS.replyTime - 1];
    if (!/^F\d{3,}$/.test(id) || (status !== '新回饋' && status !== '處理中')) return;
    if (String(row[LINE_COLUMNS.replyStatus - 1]) !== '修好已通知' || row[FEEDBACK_EXTRA_COLUMNS.remindedAt - 1]) return;
    if (allowed.indexOf(groupId) < 0 || !isSheetDate_(notifiedAt)) return;
    if (fullWorkdaysBetween_(notifiedAt, now) < FIXED_REMINDER_WORKDAYS) return;
    const reportedAt = isSheetDate_(row[1]) ? row[1] : null;
    const text = buildFixedReminderText_(id, reportedAt, String(row[4] || ''), String(row[FEEDBACK_EXTRA_COLUMNS.summary - 1] || ''), notifiedAt, String(row[LINE_COLUMNS.reply - 1] || ''));
    // 發送失敗不寫時間，下次（10 分鐘後）再試
    if (linePush_(groupId, text)) withLock_(function () { sheet.getRange(index + 5, FEEDBACK_EXTRA_COLUMNS.remindedAt).setValue(new Date()); });
  });
}

function buildFixedReminderText_(id, reportedAt, toolCell, summary, notifiedAt, reply) {
  const tool = toolCell.replace(/^工具：/, '').trim();
  const what = summary.trim() || (tool && tool !== '待確認' ? `${tool} 的問題` : '問題');
  const fix = reply.replace(/\n?（PR #\d+）\s*$/, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return [
    `${id} 提醒 🔔`,
    `・你 ${reportedAt ? taipeiParts_(reportedAt).mmdd + ' ' : ''}回報：${what}`,
    `・${taipeiParts_(notifiedAt).mmdd} 已修好：${fix || '已更新網站'}`,
    `・請重新整理網頁試用：沒問題回「${id} OK」結案；還有問題請回「${id} ＋狀況」`,
    '・這是最後一次提醒，之後仍會列在每日總表'
  ].join('\n');
}

// Sheet 讀出的日期格（不用 instanceof，跨執行環境也判斷得到）
function isSheetDate_(value) {
  return Boolean(value) && typeof value.getTime === 'function' && !isNaN(value.getTime());
}

// 台北時間（UTC+8，無夏令時間）的星期、小時、MM/dd 與日期序號；不依賴 Utilities.formatDate，方便測試
function taipeiParts_(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return { weekday: shifted.getUTCDay(), hour: shifted.getUTCHours(), mmdd: pad(shifted.getUTCMonth() + 1) + '/' + pad(shifted.getUTCDate()), day: Math.floor(shifted.getTime() / 86400000) };
}

// from 與 to 之間（兩端當天都不算）完整經過的工作天數：週三通知 → 週四、週五、週一滿 3 天 → 週二才提醒
function fullWorkdaysBetween_(from, to) {
  const start = taipeiParts_(from).day, end = taipeiParts_(to).day;
  let count = 0;
  for (let day = start + 1; day < end; day += 1) {
    const weekday = (day + 4) % 7; // 1970-01-01 是週四
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

// 網站有新版本（main 上 index.html 的 commit 標題含 vX.Y.Z）→ 部署 5 分鐘後推到所有白名單群組。
// 第一次執行只記下目前最新的 commit，不補發舊版本。
function notifySiteUpdates_() {
  const props = PropertiesService.getScriptProperties();
  const repo = props.getProperty('LINE_GITHUB_REPO') || 'poupyy220-art/workspace';
  const response = UrlFetchApp.fetch(`https://api.github.com/repos/${repo}/commits?sha=main&path=index.html&per_page=10`, {
    headers: githubHeaders_(),
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

// GitHub API 未帶 token 時共用 Google IP 的每小時 60 次額度，常被擋（403）；指令碼屬性 GITHUB_TOKEN（只讀公開 repo 即可）有設定就帶上。
function githubHeaders_() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function collectMergedPullRequests_() {
  const repo = PropertiesService.getScriptProperties().getProperty('LINE_GITHUB_REPO') || 'poupyy220-art/workspace';
  const response = UrlFetchApp.fetch(`https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=20`, {
    headers: githubHeaders_(),
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
    return { type: 'button', style: 'primary', height: 'sm', action: { type: 'message', label: `🗂️ ${item.name}`.slice(0, 20), text: `#更新 ${item.name}` } };
  });
  return toyCard_({
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: '🗂️ 要更新哪一種資料？', weight: 'bold' },
        { type: 'text', text: '點選後請在 30 分鐘內傳 Excel 檔', size: 'xs' }
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
      contents: [{ type: 'text', text: '🔒 AI 會先比對預覽，維護人員確認後才更新', size: 'xxs', color: '#5F6368', align: 'center', wrap: true }]
    }
  }, { tone: 'g', icon: 'data', source: 'Debug 小幫手・資料更新', state: { kind: 'wait', text: '等你選擇' } });
}

// ---------- 「#小幫手」選單 ----------

function helperButton_(style, color, label, text) {
  const item = { type: 'button', style: style, height: 'sm', action: { type: 'message', label: label, text: text } };
  if (color) item.color = color;
  return item;
}

/** 「#小幫手」主選單：積木格，整格可點；待辦清單、推播額度只顯示給 LINE_ADMIN_USER_IDS。 */
function buildHelperMenuCard_(openCount, isAdmin) {
  const rows = [
    toyRow_([
      toyTile_('report', 'c', '回報問題', '', '#回報'),
      toyTile_('progress', 'y', '問題進度', `未結案 ${openCount}`, '#狀況'),
      toyTile_('data', 'g', '更新資料', '', '#更新')
    ]),
    toyRow_([
      toyTile_('calendar', 'b', '工作行程', '查詢・新增', '#行事曆'),
      toyTile_('help', 'y', '使用說明', '', '#說明'),
      toyTile_('link', 'g', '常用網站', '', '#網站')
    ])
  ];
  if (isAdmin) {
    rows.push({ type: 'separator', margin: 'md' });
    rows.push({ type: 'text', text: '🔒 只有維護者看得到', size: 'xs', color: '#5F6368', margin: 'sm' });
    rows.push(toyRow_([
      toyTile_('todo', 'n', '待辦清單', '', '#待辦清單'),
      toyTile_('quota', 'n', '推播額度', '', '#額度')
    ]));
  }
  return toyCard_({
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: '🤖 Debug 小幫手', weight: 'bold' },
        { type: 'text', text: '點積木就能用，不用記指令', size: 'xs' }
      ]
    },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: '隨時打「#小幫手」叫出這個選單', size: 'xxs', color: '#5F6368', align: 'center' }]
    }
  }, { tone: 'n', icon: 'more', source: '本群組', back: false });
}

function showOpenItems_(event, groupId) {
  const items = collectOpenItems_()[groupId] || [];
  if (!items.length) {
    lineReply_(event.replyToken, '目前沒有未結案的回報或更新需求 🎉\n有問題打「#回報」');
    return;
  }
  lineReplyMessages_(event.replyToken, [{ type: 'flex', altText: `目前問題狀況：未結案 ${items.length} 筆`, contents: buildOpenItemsCard_(items, new Date()) }]);
}

function buildOpenItemsCard_(items, now) {
  // 狀態標籤：顏色＋符號＋文字，不只靠顏色
  const tagStyles = { '修好待 OK': ['#E8F5EC', '#17602E', '✓'], '等你回覆': ['#FEF6D8', '#7A5A00', '💬'], '待確認寫入': ['#FEF6D8', '#7A5A00', '🔍'], '處理中': ['#E5F0FD', '#1449A3', '⏳'] };
  const shown = items.slice(0, LINE_STATUS_LIST_MAX);
  const rows = shown.map(function (item) {
    const style = tagStyles[item.tag] || tagStyles['處理中'];
    const source = /^U/.test(item.id) ? '資料更新' : 'LINE 回報';
    return {
      type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '10px', cornerRadius: '12px', borderWidth: '1px', borderColor: '#E3E6EA',
      contents: [
        { type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center', contents: [
          { type: 'text', text: item.id, size: 'sm', weight: 'bold', color: '#1449A3', flex: 2 },
          { type: 'box', layout: 'vertical', backgroundColor: style[0], cornerRadius: '10px', paddingAll: '3px', flex: 4,
            contents: [{ type: 'text', text: `${style[2]} ${item.tag}`, size: 'xs', weight: 'bold', color: style[1], align: 'center' }] }
        ] },
        { type: 'text', text: String(item.summary || item.title).slice(0, 40), size: 'sm', wrap: true },
        { type: 'text', text: `來源：${source}`, size: 'xs', color: '#5F6368' }
      ]
    };
  });
  if (items.length > shown.length) rows.push({ type: 'text', text: `…另有 ${items.length - shown.length} 筆，請看回饋 Sheet`, size: 'xs', color: '#5F6368', wrap: true });
  return toyCard_({
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: `📋 問題進度（未結案 ${items.length}）`, weight: 'bold', wrap: true },
        { type: 'text', text: `只列本群組 · ${Utilities.formatDate(now, 'Asia/Taipei', 'MM/dd HH:mm')}`, size: 'xs' }
      ]
    },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: rows },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [
        helperButton_('primary', '', '＋ 我也要回報', '#回報'),
        { type: 'text', text: '修好了回「F0XX OK」，還有狀況回「F0XX＋說明」', size: 'xxs', color: '#5F6368', align: 'center', wrap: true }
      ]
    }
  }, { tone: 'y', icon: 'progress', source: '回饋 Sheet', state: { kind: 'work', text: `未結案 ${items.length}` } });
}

function buildHelpCard_() {
  const line = function (title, body) {
    return { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
      { type: 'text', text: title, size: 'sm', weight: 'bold', flex: 3 },
      { type: 'text', text: body, size: 'sm', wrap: true, flex: 7 }
    ] };
  };
  return toyCard_({
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: '📖 怎麼用 Debug 小幫手', weight: 'bold' }]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        line('回報問題', '#回報 問題描述，接著貼截圖（最多 3 張）'),
        line('補充說明', 'F022 ＋ 你要補的話'),
        line('修好確認', 'F022 OK'),
        line('更新資料', '#更新 → 選類型 → 傳 Excel'),
        line('查進度', '#狀況'),
        line('行事曆選單', '#行事曆（按鈕查詢、轉盤新增）'),
        line('查行程', '#行程（今天起 7 天）、#行程 明天／下週／10/15'),
        line('新增行程', '#新增行程 10/15 14:00-15:00 會議名稱（不寫時間＝全天）'),
        line('改／刪行程', '#改行程 C001 10/16 15:00、#刪行程 C001（只限建立的人）'),
        line('叫出選單', '#小幫手')
      ]
    },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: '一般聊天不會回、也不會記錄', size: 'xxs', color: '#5F6368', align: 'center' }]
    }
  }, { tone: 'y', icon: 'help', source: 'Debug 小幫手' });
}

/** LINE_QUICK_LINKS：每行或分號隔開一筆「名稱|https://網址」；只收 https，最多 8 筆。網址放指令碼屬性，不寫進公開程式。 */
function readQuickLinks_() {
  const raw = String(PropertiesService.getScriptProperties().getProperty('LINE_QUICK_LINKS') || '');
  const links = raw.split(/[\n;；]/).map(function (entry) {
    const parts = entry.split('|');
    const name = String(parts[0] || '').trim(), url = parts.slice(1).join('|').trim();
    return name && /^https:\/\/\S+$/i.test(url) ? { name: name.slice(0, 40), url: url } : null;
  }).filter(Boolean).slice(0, LINE_QUICK_LINKS_MAX);
  return links.length ? links : [{ name: '料號管理中心', url: LINE_SITE_URL }];
}

function buildQuickLinksCard_(links) {
  return toyCard_({
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: '🔗 常用網站', weight: 'bold' }]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: links.map(function (link) {
        return { type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: link.name, uri: link.url } };
      })
    },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: '點按鈕直接開啟網頁', size: 'xxs', color: '#5F6368', align: 'center' }]
    }
  }, { tone: 'g', icon: 'link', source: '維護者設定的常用網站' });
}

function buildReportMenuCard_() {
  return toyCard_({
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: '🛠️ 要回報什麼？', weight: 'bold' },
        { type: 'text', text: '點選後直接打文字說明，可接著貼截圖', size: 'xs', wrap: true }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: [
        helperButton_('primary', '', '🐞 回報問題', '#回報 選擇:問題'),
        helperButton_('primary', '', '💡 提出需求／格式調整', '#回報 選擇:需求'),
        helperButton_('secondary', '', '🗂️ 更新資料', '#更新')
      ]
    },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: '也可以直接打「#回報 問題描述」一次送出', size: 'xxs', color: '#5F6368', align: 'center', wrap: true }]
    }
  }, { tone: 'c', icon: 'report', source: 'Debug 小幫手・問題回報', state: { kind: 'wait', text: '等你選擇' } });
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
