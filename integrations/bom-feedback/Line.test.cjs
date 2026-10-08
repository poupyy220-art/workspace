const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GROUP = 'Cgroup-work';
const OTHER_GROUP = 'Cgroup-family';
const KEY = 'secret-key';
const pngBytes = Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

function createWorld() {
  const properties = {
    SPREADSHEET_ID: 'sheet', NOTIFY_EMAIL: 'owner@example.com', FEEDBACK_IMAGE_FOLDER_ID: 'folder',
    LINE_CHANNEL_ACCESS_TOKEN: 'token', LINE_WEBHOOK_KEY: KEY, LINE_GROUP_IDS: GROUP,
    // formatDate 假資料固定回 20260923：預設當天總表已發過，避免干擾其他測試的推播次數
    LINE_SUMMARY_LAST_DATE: '20260923'
  };
  const cache = {};
  const ttls = {};
  const calls = { replies: [], pushes: [], mails: [], files: [], github: [] };
  let pulls = [];
  let commits = [];
  const quota = { limit: 200, used: 12 };

  function makeSheet(startRow) {
    const data = {};
    let last = startRow;
    const cell = (r, c) => (data[r] || [])[c - 1] ?? '';
    const setCell = (r, c, v) => { data[r] = data[r] || []; data[r][c - 1] = v; if (r > last) last = r; };
    return {
      data,
      setCell,
      getLastRow: () => last,
      appendRow(values) { last = Math.max(last, 4) + 1; data[last] = values.slice(); },
      getRange(r, c, nr = 1, nc = 1) {
        return {
          getValue: () => cell(r, c),
          setValue: (v) => setCell(r, c, v),
          getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
          setValues: (values) => values.forEach((line, i) => line.forEach((v, j) => setCell(r + i, c + j, v)))
        };
      }
    };
  }
  const sheets = { 'BOM Feedback': makeSheet(4) };
  const sheet = sheets['BOM Feedback'];
  const rows = sheet.data;
  const setCell = sheet.setCell;
  const xlsxBytes = Array.from(Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.alloc(60)]));
  const textBytes = Array.from(Buffer.from('not an excel file'));

  const response = (code, body, blob) => ({
    getResponseCode: () => code,
    getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)),
    getBlob: () => blob
  });

  const context = {
    console: { log() {}, error() {} },
    Utilities: {
      base64Decode: (v) => Array.from(Buffer.from(v, 'base64')),
      formatDate: () => '20260923',
      computeDigest: (_a, text) => Array.from(require('crypto').createHash('sha256').update(text).digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => 'uuid',
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      Charset: { UTF_8: 'UTF-8' },
      DigestAlgorithm: { SHA_256: 'SHA-256' }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => properties[k] ?? null, setProperty: (k, v) => { properties[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v, ttl) => { cache[k] = v; ttls[k] = ttl; }, remove: (k) => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: (name) => sheets[name] || null, insertSheet: (name) => (sheets[name] = makeSheet(0)), getSheets: () => (sheets.__log ? [sheets.__log] : []) }) },
    DriveApp: { getFolderById: () => ({ createFile(blob) { calls.files.push(blob.name); return { setDescription() {}, getUrl: () => `https://drive/${blob.name}`, setTrashed() {} }; } }) },
    MailApp: { sendEmail: (m) => calls.mails.push(m) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
    UrlFetchApp: {
      fetch(url, options = {}) {
        if (url.includes('/message/reply')) { calls.replies.push(JSON.parse(options.payload)); return response(200, '{}'); }
        if (url.includes('/message/push')) { calls.pushes.push(JSON.parse(options.payload)); return response(200, '{}'); }
        if (url.includes('api-data.line.me/v2/bot/message/file')) return response(200, '', { getContentType: () => 'application/octet-stream', getBytes: () => xlsxBytes });
        if (url.includes('api-data.line.me/v2/bot/message/bad')) return response(200, '', { getContentType: () => 'application/octet-stream', getBytes: () => textBytes });
        if (url.includes('api-data.line.me')) return response(200, '', { getContentType: () => 'image/png', getBytes: () => pngBytes });
        if (url.endsWith('/message/quota')) return response(200, quota.limit === null ? { type: 'none' } : { type: 'limited', value: quota.limit });
        if (url.endsWith('/message/quota/consumption')) return response(200, { totalUsage: quota.used });
        if (url.includes('api.github.com')) calls.github.push(options.headers || {});
        if (url.includes('api.github.com') && url.includes('/commits')) return response(200, commits);
        if (url.includes('api.github.com')) return response(200, pulls);
        throw new Error(`Unexpected fetch ${url}`);
      }
    }
  };
  vm.createContext(context);
  const code = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
  const line = fs.readFileSync(path.join(__dirname, 'Line.gs'), 'utf8');
  vm.runInContext(`${code}\n${line}\nthis.api={doPost,processLineOutbox,detectLineTool_,extractLineReply_,sendDailySummary_:typeof sendDailySummary_==='function'?sendDailySummary_:undefined,sendDailySummaryNow:typeof sendDailySummaryNow==='function'?sendDailySummaryNow:undefined,sendFixedReminders_:typeof sendFixedReminders_==='function'?sendFixedReminders_:undefined,setupLineCalendar:typeof setupLineCalendar==='function'?setupLineCalendar:undefined,parseCalendarSpec_:typeof parseCalendarSpec_==='function'?parseCalendarSpec_:undefined};`, context, { filename: 'Line.gs' });

  let tokenSeq = 0;
  const post = (events, key = KEY) => context.api.doPost({
    parameter: { k: key },
    postData: { type: 'application/json', contents: JSON.stringify({ destination: 'bot', events }) }
  });
  const text = (value, user = 'Ualice', group = GROUP) => ({ type: 'message', replyToken: `r${++tokenSeq}`, source: { type: 'group', groupId: group, userId: user }, message: { type: 'text', id: `m${tokenSeq}`, text: value } });
  const image = (user = 'Ualice', group = GROUP) => ({ type: 'message', replyToken: `r${++tokenSeq}`, source: { type: 'group', groupId: group, userId: user }, message: { type: 'image', id: `img${tokenSeq}` } });
  const file = (fileName, { user = 'Ualice', kind = 'file', size = 2048 } = {}) => ({ type: 'message', replyToken: `r${++tokenSeq}`, source: { type: 'group', groupId: GROUP, userId: user }, message: { type: 'file', id: `${kind}${tokenSeq}`, fileName, fileSize: size } });
  // 卡片回覆沒有 text，改看 altText（摘要文字）
  const lastReply = () => { const m = (calls.replies.at(-1) || { messages: [{ text: '' }] }).messages[0]; return m.text ?? m.altText; };
  const row = (n) => rows[n] || [];
  const dataRow = (n) => (sheets['Data Requests'] ? sheets['Data Requests'].data[n] || [] : []);

  return { ttls, api: context.api, post, text, image, file, calls, rows, row, dataRow, sheets, properties, lastReply, setPulls: (p) => { pulls = p; }, setCommits: (c) => { commits = c; }, quota, setCell, context, clearCache: () => Object.keys(cache).forEach((k) => delete cache[k]) };
}

const tests = [];
function test(name, callback) { tests.push({ name, callback }); }
function assert(condition, message) { if (!condition) throw new Error(message || 'Assertion failed'); }

test('ignores requests with the wrong webhook key', () => {
  const w = createWorld();
  w.post([w.text('#回報 BOM 轉檔錯誤')], 'wrong');
  assert(w.calls.replies.length === 0 && !w.row(5).length, 'Wrong key must do nothing');
});

test('ignores groups that are not whitelisted, but reveals group ID in setup mode', () => {
  const w = createWorld();
  w.post([w.text('#回報 BOM 轉檔錯誤', 'Ualice', OTHER_GROUP)]);
  assert(w.calls.replies.length === 0 && !w.row(5).length, 'Other group must be ignored');
  w.properties.LINE_SETUP_MODE = 'true';
  w.post([w.text('#群組ID', 'Ualice', OTHER_GROUP)]);
  assert(w.lastReply().includes(OTHER_GROUP), 'Setup mode should reply the group ID');
});

test('ignores normal chat and images without a pending report', () => {
  const w = createWorld();
  w.post([w.text('中午吃什麼'), w.image()]);
  assert(w.calls.replies.length === 0 && w.calls.files.length === 0 && !w.row(5).length, 'Normal chat must be ignored');
});

test('creates a report with detected tool and replies with the ID', () => {
  const w = createWorld();
  w.post([w.text('#回報 BOM 轉檔後第 35 列品名變亂碼')]);
  const r = w.row(5);
  assert(r[0] === 'F001', `Unexpected ID ${r[0]}`);
  assert(r[4] === '工具：BOM 轉檔與安檢', `Tool not detected: ${r[4]}`);
  assert(r[6] === '新回饋' && r[10] === 'LINE' && r[13] === GROUP, 'Status/source/group columns wrong');
  assert(w.lastReply().includes('收到 F001') && !w.lastReply().includes('哪一個工具'), 'Reply wrong');
  assert(w.calls.mails.length === 1 && w.calls.mails[0].subject.includes('F001'), 'Maintainer email missing');
});

test('asks which tool when unknown, then fills it from the next message', () => {
  const w = createWorld();
  w.post([w.text('＃回報 按下去沒有反應')]);
  assert(w.row(5)[4] === '工具：待確認' && w.lastReply().includes('哪一個工具'), 'Should ask for tool');
  w.post([w.text('出勤表')]);
  assert(w.row(5)[4] === '工具：出勤表自動填寫', `Tool not filled: ${w.row(5)[4]}`);
  assert(w.lastReply().includes('已補上'), 'Should confirm tool');
});

test('attaches up to three screenshots from the same reporter only', () => {
  const w = createWorld();
  w.post([w.text('#回報 PIM 合併少一列')]);
  w.post([w.image('Ubob')]);
  assert(w.calls.files.length === 0, 'Other user image must be ignored');
  w.post([w.image(), w.image(), w.image()]);
  assert(w.calls.files.length === 3 && w.row(5)[12] === 3, 'Three images should be stored');
  assert(String(w.row(5)[11]).split('\n').length === 3, 'Image links should be listed');
  w.post([w.image()]);
  assert(w.calls.files.length === 3 && w.lastReply().includes('最多附 3 張'), 'Fourth image must be refused');
});

test('handles empty and duplicate reports', () => {
  const w = createWorld();
  w.post([w.text('#回報')]);
  assert(!w.row(5).length && w.calls.replies.at(-1).messages[0].type === 'flex', 'Empty report should show the menu');
  w.post([w.text('#回報 EC 受限制分析器當掉')]);
  w.post([w.text('#回報 EC 受限制分析器當掉')]);
  assert(!w.row(6).length && w.lastReply().includes('已經回報過'), 'Duplicate should be refused');
});

test('merged PR sends the fix notice, then colleague OK closes the report', () => {
  const w = createWorld();
  w.post([w.text('#回報 BOM 轉檔品名亂碼')]);
  w.post([w.text('F001 OK')]);
  assert(w.lastReply().includes('還在處理中'), 'Cannot close before fix notice');

  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  w.setPulls([{ number: 42, title: 'fix: 簡體品名轉換漏字 [F001]', merged_at: old, body: 'x\n<!-- line-reply -->原因是簡體品名轉換漏字，網站已更新到 v2.16.3，請重新整理再試一次。<!-- /line-reply -->' }]);
  w.api.processLineOutbox();
  const push = w.calls.pushes.at(-1);
  assert(push && push.to === GROUP, 'Fix notice not pushed to group');
  assert(push.messages[0].text.includes('簡體品名轉換漏字') && push.messages[0].text.includes('F001 OK'), 'Push text wrong');
  assert(w.row(5)[6] === '處理中' && w.row(5)[15] === '修好已通知', 'Row status not updated');

  w.api.processLineOutbox();
  assert(w.calls.pushes.length === 1, 'Must not push twice');

  w.post([w.text('F001 ok 謝謝')]);
  assert(w.row(5)[6] === '已解決' && w.row(5)[15] === '同事已確認' && w.lastReply().includes('已結案'), 'OK should close');
  assert(['新回饋', '處理中', '已解決', '不處理'].includes(w.row(5)[6]), 'Status must stay within Sheet dropdown options');
});

test('waits five minutes after merge before notifying', () => {
  const w = createWorld();
  w.post([w.text('#回報 BOM 轉檔錯誤')]);
  w.setPulls([{ number: 43, title: 'fix [F001]', merged_at: new Date().toISOString(), body: '' }]);
  w.api.processLineOutbox();
  assert(w.calls.pushes.length === 0, 'Should wait for deployment');
});

test('manually approved reply is pushed without asking for OK', () => {
  const w = createWorld();
  w.post([w.text('#回報 MTM 查詢不知道怎麼批次上傳')]);
  w.setCell(5, 15, '請按「Excel 批次上傳」，第一欄放 MTM code。');
  w.setCell(5, 16, '核准發送');
  w.api.processLineOutbox();
  const text = w.calls.pushes.at(-1).messages[0].text;
  assert(text.startsWith('F001：請按') && !text.includes('OK'), `Unexpected push ${text}`);
  assert(w.row(5)[15] === '已發送' && w.row(5)[6] === '新回饋', 'Only reply status should change');
});

test('join event introduces the bot in an allowed group', () => {
  const w = createWorld();
  w.post([{ type: 'join', replyToken: 'rj', source: { type: 'group', groupId: GROUP } }]);
  assert(w.lastReply().includes('#回報'), 'Join intro missing');
});

test('#更新 creates U001 in a new Data Requests sheet without touching feedback rows', () => {
  const w = createWorld();
  w.post([w.text('#更新 PN_Project_Map Neo50q G6 漏了幾顆料')]);
  const r = w.dataRow(5);
  assert(r[0] === 'U001' && r[2] === 'PN_Project_Map' && r[6] === '新需求' && r[7] === GROUP, `Unexpected data row ${JSON.stringify(r)}`);
  assert(w.sheets['Data Requests'].data[4][0] === '需求編號', 'Header row not created');
  assert(!w.row(5).length, 'Feedback sheet must stay untouched');
  assert(w.lastReply().includes('收到 U001') && w.lastReply().includes('確認前不會改動資料'), 'Reply wrong');
  assert(w.calls.mails.at(-1).subject.includes('U001'), 'Maintainer email missing');
});

test('#更新 accepts Excel files from the same requester only, max three', () => {
  const w = createWorld();
  w.post([w.text('＃更新 PN_Project_Map')]);
  w.post([w.file('BOM_TREE_20260922_001.xlsx', { user: 'Ubob' })]);
  assert(w.calls.files.length === 0, 'Other user file must be ignored');
  w.post([w.file('BOM_TREE_1.xlsx'), w.file('BOM_TREE_2.xlsx'), w.file('BOM_TREE_3.xlsx')]);
  assert(w.calls.files.length === 3 && w.dataRow(5)[5] === 3, 'Three files should be stored');
  assert(w.calls.files[0] === 'U001_BOM_TREE_1.xlsx', `File naming wrong: ${w.calls.files[0]}`);
  w.post([w.file('BOM_TREE_4.xlsx')]);
  assert(w.calls.files.length === 3 && w.lastReply().includes('最多附 3 個'), 'Fourth file must be refused');
});

test('#更新 rejects non-Excel, fake Excel, oversized files and screenshots', () => {
  const w = createWorld();
  w.post([w.text('#更新 PN_Project_Map')]);
  w.post([w.file('notes.pdf')]);
  assert(w.lastReply().includes('只收 Excel'), 'PDF should be refused');
  w.post([w.file('fake.xlsx', { kind: 'bad' })]);
  assert(w.lastReply().includes('不是有效的 Excel'), 'Fake Excel should be refused');
  w.post([w.file('huge.xlsx', { size: 20 * 1024 * 1024 })]);
  assert(w.lastReply().includes('超過 10 MB'), 'Oversized file should be refused');
  w.post([w.image()]);
  assert(w.lastReply().includes('需要的是 Excel'), 'Screenshot for data request should be refused');
  assert(w.calls.files.length === 0, 'Nothing should be stored');
});

test('files without a pending #更新, or after #回報, are ignored', () => {
  const w = createWorld();
  w.post([w.file('BOM_TREE.xlsx')]);
  w.post([w.text('#回報 BOM 轉檔錯誤'), w.file('BOM_TREE.xlsx')]);
  assert(w.calls.files.length === 0, 'Files outside #更新 must be ignored');
  assert(!w.sheets['Data Requests'], 'Data sheet must not be created');
});

test('unknown update type is recorded as 待確認 and approved data replies are pushed', () => {
  const w = createWorld();
  w.post([w.text('#更新 國別 DB 新增一個代碼')]);
  assert(w.dataRow(5)[2] === '待確認' && w.lastReply().includes('只支援 PN_Project_Map'), 'Unknown type handling wrong');
  w.sheets['Data Requests'].setCell(5, 9, '已請維護人員處理');
  w.sheets['Data Requests'].setCell(5, 10, '核准發送');
  w.api.processLineOutbox();
  const push = w.calls.pushes.at(-1);
  assert(push && push.messages[0].text === 'U001：已請維護人員處理', `Push wrong: ${push && push.messages[0].text}`);
  assert(w.dataRow(5)[9] === '已發送', 'Data reply status not updated');
});

test('#更新 waits 30 minutes for files while #回報 screenshots stay 10 minutes', () => {
  const w = createWorld();
  w.post([w.text('#回報 PIM 合併少一列')]);
  const pendingTtls = () => Object.keys(w.ttls).filter((k) => k.startsWith('LINE_PENDING_')).map((k) => w.ttls[k]);
  assert(pendingTtls().length === 1 && pendingTtls()[0] === 600, '#回報 window must stay 10 minutes');
  w.post([w.text('#更新 PN_Project_Map')]);
  assert(pendingTtls()[0] === 1800, '#更新 window must be 30 minutes');
  assert(w.lastReply().includes('30 分鐘內'), 'Reply should say 30 minutes');
});

test('Claude reply entry: wrong key or unknown id does nothing', () => {
  const w = createWorld();
  w.properties.CLAUDE_REPLY_KEY = 'claude-key';
  w.post([w.text('#更新 PN_Project_Map 測試')]);
  const pushesBefore = w.calls.pushes.length;
  const bad = w.api.doPost({ parameter: {}, postData: { type: 'text/plain', contents: JSON.stringify({ events: [], claudeReply: { key: 'wrong', id: 'U001', text: 'x' } }) } });
  assert(JSON.parse(bad).error === 'unauthorized', 'Wrong key must be rejected');
  const missing = w.api.doPost({ parameter: {}, postData: { type: 'text/plain', contents: JSON.stringify({ events: [], claudeReply: { key: 'claude-key', id: 'U999', text: 'x' } }) } });
  assert(JSON.parse(missing).error === 'id not found', 'Unknown id must be rejected');
  const noKeySet = createWorld();
  const unset = noKeySet.api.doPost({ parameter: {}, postData: { type: 'text/plain', contents: JSON.stringify({ events: [], claudeReply: { key: '', id: 'U001', text: 'x' } }) } });
  assert(JSON.parse(unset).error === 'unauthorized', 'Missing CLAUDE_REPLY_KEY must reject');
  assert(w.calls.pushes.length === pushesBefore, 'Nothing must be pushed');
});

test('Claude reply entry: pushes to the row group, records the reply, and never double-sends', () => {
  const w = createWorld();
  w.properties.CLAUDE_REPLY_KEY = 'claude-key';
  w.post([w.text('#更新 PN_Project_Map 多檔測試')]);
  const call = (text) => JSON.parse(w.api.doPost({ parameter: {}, postData: { type: 'text/plain', contents: JSON.stringify({ events: [], claudeReply: { key: 'claude-key', id: 'u001', text } }) } }));
  const first = call('多檔測試完成，不需要更新 👍');
  assert(first.ok && first.sent, `First call should send: ${JSON.stringify(first)}`);
  const push = w.calls.pushes.at(-1);
  assert(push.to === GROUP && push.messages[0].text === 'U001：多檔測試完成，不需要更新 👍', `Push wrong: ${JSON.stringify(push)}`);
  assert(w.dataRow(5)[8] === '多檔測試完成，不需要更新 👍' && w.dataRow(5)[9] === '已發送' && w.dataRow(5)[10], 'Row not recorded');
  const again = call('多檔測試完成，不需要更新 👍');
  assert(again.duplicate && w.calls.pushes.length === 1, 'Same text must not be sent twice');
});

test('Claude reply entry: fixed notice on F rows asks for OK and enables closing', () => {
  const w = createWorld();
  w.properties.CLAUDE_REPLY_KEY = 'claude-key';
  w.post([w.text('#回報 BOM 轉檔錯誤')]);
  const result = JSON.parse(w.api.doPost({ parameter: {}, postData: { type: 'text/plain', contents: JSON.stringify({ events: [], claudeReply: { key: 'claude-key', id: 'F001', text: '已修好', fixed: true } }) } }));
  assert(result.sent && w.calls.pushes.at(-1).messages[0].text.includes('F001 OK'), 'Fixed notice should ask for OK');
  assert(w.row(5)[15] === '修好已通知', 'Reply status should allow closing');
  w.post([w.text('F001 OK')]);
  assert(w.row(5)[6] === '已解決', 'OK should close after Claude fixed notice');
});

test('Claude reply entry: sends a Flex card with stats and link when card data is given', () => {
  const w = createWorld();
  w.properties.CLAUDE_REPLY_KEY = 'claude-key';
  w.post([w.text('#更新 PN_Project_Map Yoga mini')]);
  const card = { project: 'Yoga mini', added: ['SBB1', 'SBB2', 'SBB3', 'SBB4', 'SBB5', 'SBB6', 'SBB7'], tagged: 50, unchanged: 184, rowsBefore: 4571, rowsAfter: 4617, link: 'https://docs.google.com/spreadsheets/d/x/edit', date: '2026/09/24' };
  const result = JSON.parse(w.api.doPost({ parameter: {}, postData: { type: 'text/plain', contents: JSON.stringify({ events: [], claudeReply: { key: 'claude-key', id: 'U001', text: 'Yoga mini 已更新', card } }) } }));
  assert(result.sent, 'Card should be sent');
  const message = w.calls.pushes.at(-1).messages[0];
  assert(message.type === 'flex' && message.altText.startsWith('U001：Yoga mini 已更新'), `Expected flex message: ${JSON.stringify(message).slice(0, 120)}`);
  const json = JSON.stringify(message.contents);
  assert(json.includes('Yoga mini 更新完成') && json.includes('"7"') && json.includes('"50"') && json.includes('"184"'), 'Card stats missing');
  assert(json.includes('…等 7 筆') && json.includes('查看完整清單') && json.includes('4571 → 4617'), 'Card preview/link/footer missing');
  assert(w.dataRow(5)[8] === 'Yoga mini 已更新' && w.dataRow(5)[9] === '已發送', 'Row must record the text version');
});

test('Claude status entry: wrong key, unknown id, or invalid status changes nothing', () => {
  const w = createWorld();
  w.properties.CLAUDE_REPLY_KEY = 'claude-key';
  w.post([w.text('#回報 BOM 轉檔錯誤')]);
  const call = (body) => JSON.parse(w.api.doPost({ parameter: {}, postData: { type: 'text/plain', contents: JSON.stringify({ events: [], claudeStatus: body }) } }));
  assert(call({ key: 'wrong', id: 'F001', status: '已解決' }).error === 'unauthorized', 'Wrong key must be rejected');
  assert(call({ key: 'claude-key', id: 'F999', status: '已解決' }).error === 'id not found', 'Unknown id must be rejected');
  assert(call({ key: 'claude-key', id: 'F001', status: '已完成' }).error === 'invalid status', 'F rows only accept feedback statuses');
  const noKeySet = createWorld();
  noKeySet.post([noKeySet.text('#回報 BOM 轉檔錯誤')]);
  const unset = JSON.parse(noKeySet.api.doPost({ parameter: {}, postData: { type: 'text/plain', contents: JSON.stringify({ events: [], claudeStatus: { key: '', id: 'F001', status: '已解決' } }) } }));
  assert(unset.error === 'unauthorized', 'Missing CLAUDE_REPLY_KEY must reject');
  assert(w.row(5)[6] === '新回饋', 'Status must stay unchanged');
});

test('Claude status entry: updates F and U status columns only, without pushing to LINE', () => {
  const w = createWorld();
  w.properties.CLAUDE_REPLY_KEY = 'claude-key';
  w.post([w.text('#回報 BOM 轉檔錯誤')]);
  w.post([w.text('#更新 PN_Project_Map 測試')]);
  const pushesBefore = w.calls.pushes.length;
  const repliesBefore = w.calls.replies.length;
  const rowBefore = w.row(5).slice();
  const call = (body) => JSON.parse(w.api.doPost({ parameter: {}, postData: { type: 'text/plain', contents: JSON.stringify({ events: [], claudeStatus: Object.assign({ key: 'claude-key' }, body) }) } }));
  const f = call({ id: 'f001', status: '已解決' });
  assert(f.ok && f.id === 'F001' && f.previous === '新回饋' && f.status === '已解決', `F result wrong: ${JSON.stringify(f)}`);
  assert(w.row(5)[6] === '已解決', 'F status not written');
  rowBefore.forEach((value, i) => { if (i !== 6) assert(w.row(5)[i] === value, `F column ${i + 1} must not change`); });
  const u = call({ id: 'U001', status: '已完成' });
  assert(u.ok && u.previous === '新需求' && w.dataRow(5)[6] === '已完成', `U result wrong: ${JSON.stringify(u)}`);
  assert(call({ id: 'U001', status: '已解決' }).error === 'invalid status', 'U rows only accept data request statuses');
  const same = call({ id: 'F001', status: '已解決' });
  assert(same.ok && same.unchanged, 'Same status should report unchanged');
  assert(w.calls.pushes.length === pushesBefore && w.calls.replies.length === repliesBefore, 'Status change must not message LINE');
});

test('Claude pending check: returns only ids, statuses and supplement times, key required, no LINE', () => {
  const w = createWorld();
  w.properties.CLAUDE_REPLY_KEY = 'claude-key';
  w.post([w.text('#回報 BOM 轉檔錯誤 機密描述')]);
  w.post([w.text('#更新 PN_Project_Map 測試')]);
  w.post([w.text('F001 補充說明內容')]);
  const pushesBefore = w.calls.pushes.length;
  const repliesBefore = w.calls.replies.length;
  const call = (body) => JSON.parse(w.api.doPost({ parameter: {}, postData: { type: 'text/plain', contents: JSON.stringify({ events: [], claudePending: body }) } }));
  assert(call({ key: 'wrong' }).error === 'unauthorized', 'Wrong key must be rejected');
  const result = call({ key: 'claude-key' });
  assert(result.ok && Array.isArray(result.items), `Pending result wrong: ${JSON.stringify(result)}`);
  const f = result.items.find((item) => item.id === 'F001');
  const u = result.items.find((item) => item.id === 'U001');
  assert(f && f.status === '新回饋' && /^\d{4}-\d{2}-\d{2}T/.test(f.supplementAt), `F item wrong: ${JSON.stringify(f)}`);
  assert(u && u.status === '新需求' && u.supplementAt === '', `U item wrong: ${JSON.stringify(u)}`);
  result.items.forEach((item) => assert(Object.keys(item).sort().join() === 'id,status,supplementAt', 'Only id/status/supplementAt allowed'));
  const raw = JSON.stringify(result);
  assert(!raw.includes('機密描述') && !raw.includes('補充說明內容') && !raw.includes('PN_Project_Map'), 'Pending check must not expose report text');
  assert(w.calls.pushes.length === pushesBefore && w.calls.replies.length === repliesBefore, 'Pending check must not message LINE');
});

test('LINE status command: only maintainers can change status; others are recorded as supplements', () => {
  const w = createWorld();
  w.properties.LINE_ADMIN_USER_IDS = 'Umaintainer';
  w.post([w.text('#回報 BOM 轉檔錯誤')]);
  w.post([w.text('#更新 PN_Project_Map 測試')]);
  w.post([w.text('F001 已解決', 'Ubob')]);
  assert(w.row(5)[6] === '新回饋', 'Non-maintainer must not change status');
  assert(String(w.row(5)[17]).includes('已解決'), 'Non-maintainer text should be a supplement');
  w.post([w.text('F001 已解決', 'Umaintainer')]);
  assert(w.row(5)[6] === '已解決' && w.lastReply().includes('F001') && w.lastReply().includes('已解決'), `Maintainer change failed: ${w.lastReply()}`);
  w.post([w.text('u001 已完成', 'Umaintainer')]);
  assert(w.dataRow(5)[6] === '已完成', 'Maintainer should update U status');
  w.post([w.text('U001 已解決', 'Umaintainer')]);
  assert(w.dataRow(5)[6] === '已完成' && w.lastReply().includes('不能用'), `Invalid status must be refused: ${w.lastReply()}`);
});

test('#更新 alone shows a button menu and creates nothing; tapping a button starts the request', () => {
  const w = createWorld();
  w.post([w.text('#更新')]);
  const message = w.calls.replies.at(-1).messages[0];
  assert(message.type === 'flex', 'Menu must be a flex card');
  const json = JSON.stringify(message.contents);
  assert(json.includes('"text":"#更新 PN_Project_Map"') && json.includes('#更新 其他資料'), 'Menu buttons missing');
  assert(!w.sheets['Data Requests'], 'Menu must not create a request');
  w.post([w.text('#更新 PN_Project_Map')]);
  assert(w.dataRow(5)[0] === 'U001' && w.dataRow(5)[2] === 'PN_Project_Map', 'Button text should create U001');
});

test('#回報 alone shows a menu; picking 問題／需求 turns the next message into the report', () => {
  const w = createWorld();
  w.post([w.text('#回報')]);
  const json = JSON.stringify(w.calls.replies.at(-1).messages[0].contents);
  assert(json.includes('#回報 選擇:問題') && json.includes('#回報 選擇:需求') && json.includes('"text":"#更新"'), 'Menu buttons missing');
  assert(!w.row(5).length, 'Menu must not create a report');
  w.post([w.text('#回報 選擇:需求')]);
  assert(!w.row(5).length && w.lastReply().includes('10 分鐘內'), 'Picking should ask for the description');
  w.post([w.image()]);
  assert(w.lastReply().includes('請先用文字描述') && !w.row(5).length, 'Image before description must not attach');
  w.post([w.text('PN 工具的 Excel 希望多一欄序號')]);
  assert(w.row(5)[0] === 'F001' && w.row(5)[3] === 'LINE 需求' && w.row(5)[4] === '工具：PN 工具', `Request row wrong: ${w.row(5).slice(0, 6)}`);
  w.post([w.text('#回報 選擇:問題')]);
  w.post([w.text('PIM 合併少一列')]);
  assert(w.row(6)[3] === 'LINE 回報' && w.row(6)[5] === 'PIM 合併少一列', 'Problem mode should create a normal report');
  w.post([w.text('今天午餐吃什麼')]);
  assert(!w.row(7).length, 'After the report, normal chat stays ignored');
});

test('#回報 without a tool offers quick-reply tool buttons that fill the tool', () => {
  const w = createWorld();
  w.post([w.text('#回報 畫面一直轉圈圈')]);
  const message = w.calls.replies.at(-1).messages[0];
  const labels = (message.quickReply && message.quickReply.items || []).map((item) => item.action.text);
  assert(labels.includes('BOM 轉檔與安檢') && labels.includes('出勤表自動填寫') && labels.length <= 13, `Quick replies wrong: ${labels.join(',')}`);
  labels.forEach((label) => assert(label.length <= 20, `Label too long: ${label}`));
  w.post([w.text('萬用專案查詢')]);
  assert(w.row(5)[4] === '工具：萬用專案查詢', `Quick reply should fill tool: ${w.row(5)[4]}`);
});

test('every quick-reply tool name maps back to itself', () => {
  const w = createWorld();
  const names = ['PIM 合併', 'SPB vs L10', 'EC 受限制物料分析器', 'CTO EDI 新專案維護', 'BOM 轉檔與安檢', 'MTM 國別查詢', '國別 DB 維護', '萬用專案查詢', '出勤表自動填寫', 'SOP 知識庫', 'PN 工具'];
  names.forEach((name) => assert(w.api.detectLineTool_(name) === name, `${name} maps to ${w.api.detectLineTool_(name)}`));
});

test('EC Tracking wording maps to PN 工具, not EC 受限制', () => {
  const w = createWorld();
  assert(w.api.detectLineTool_('8️⃣ EC Tracking 待貼入報表產生異常數據') === 'PN 工具', 'EC Tracking should map to PN 工具');
  assert(w.api.detectLineTool_('EC 受限制清單錯誤') === 'EC 受限制物料分析器', 'EC 受限 should stay');
});

test('colleague supplement "F001 ②" is recorded, acknowledged, and emailed', () => {
  const w = createWorld();
  w.post([w.text('#回報 PIM 合併少一列')]);
  w.post([w.text('F001 ②', 'Ubob')]);
  assert(w.lastReply() === '收到 F001 的補充 👍 維護人員會接著處理', `Ack wrong: ${w.lastReply()}`);
  assert(String(w.row(5)[17]).endsWith('] ②') && w.row(5)[18], `Supplement not recorded: ${w.row(5)[17]}`);
  assert(w.rows[4][17] === '同事補充' && w.rows[4][18] === '補充時間', 'Supplement headers missing');
  assert(w.calls.mails.at(-1).subject === '[LINE 補充] F001', 'Maintainer email missing');
  w.post([w.text('F001：希望加在 A 欄')]);
  assert(String(w.row(5)[17]).split('\n').length === 2, 'Second supplement should append');
});

test('supplements for U rows, unknown ids, and F00x OK keep their own behaviour', () => {
  const w = createWorld();
  w.post([w.text('#更新 PN_Project_Map 測試')]);
  w.post([w.text('U001 還有一個檔案晚點補')]);
  assert(String(w.dataRow(5)[11]).includes('還有一個檔案晚點補') && w.lastReply().includes('U001 的補充'), 'U supplement failed');
  const repliesBefore = w.calls.replies.length;
  w.post([w.text('F999 這個編號不存在')]);
  assert(w.calls.replies.length === repliesBefore, 'Unknown id must be ignored silently');
  w.post([w.text('#回報 BOM 轉檔錯誤')]);
  w.post([w.text('F001 OK')]);
  assert(w.lastReply().includes('還在處理中'), 'F00x OK must still go to the close flow');
});

test('site update: first run only remembers, later versions are pushed once after 5 minutes', () => {
  const w = createWorld();
  const at = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const commit = (sha, message, minutes) => ({ sha, commit: { message, committer: { date: at(minutes) } } });
  w.setCommits([commit('a1', 'fix: 舊版本 (v2.16.4)', 60)]);
  w.api.processLineOutbox();
  assert(w.calls.pushes.length === 0 && w.properties.LINE_SITE_LAST_SHA === 'a1', 'First run must not announce old versions');

  w.setCommits([commit('c3', 'feat: 剛推還在部署 (v2.16.7)', 1), commit('b2', 'fix: BOM 轉檔按鈕不再誤顯示完成 (v2.16.5)\n\nbody', 10), commit('a1', 'fix: 舊版本 (v2.16.4)', 60)]);
  w.api.processLineOutbox();
  const push = w.calls.pushes.at(-1);
  assert(push && push.to === GROUP, 'Site update should go to the allowed group');
  const text = push.messages[0].text;
  assert(text.startsWith('🆕 料號管理中心已更新到 v2.16.5') && text.includes('・v2.16.5 BOM 轉檔按鈕不再誤顯示完成') && !text.includes('v2.16.7') && !text.includes('body'), `Text wrong: ${text}`);
  assert(text.includes('https://poupyy220-art.github.io/workspace/'), 'Site link missing');

  w.api.processLineOutbox();
  assert(w.calls.pushes.length === 1, 'Same version must not be pushed twice');

  w.setCommits([commit('d4', 'chore: 文件調整', 10), commit('c3', 'feat: 剛推還在部署 (v2.16.7)', 10), commit('b2', 'fix: x (v2.16.5)', 20)]);
  w.api.processLineOutbox();
  assert(w.calls.pushes.length === 2 && w.calls.pushes.at(-1).messages[0].text.includes('v2.16.7') && !w.calls.pushes.at(-1).messages[0].text.includes('文件調整'), 'Only versioned commits are announced');
  w.setCommits([commit('e5', 'docs: 沒有版本號', 10), commit('d4', 'chore: 文件調整', 20)]);
  w.api.processLineOutbox();
  assert(w.calls.pushes.length === 2, 'Commits without a version stay silent');
});

test('#待辦 is admin-only: add, list, change status; others get a polite refusal', () => {
  const w = createWorld();
  w.post([w.text('#待辦 PN Database 清單跟公司系統比對')]);
  assert(w.lastReply().includes('只有維護人員') && !w.sheets['To Do'], 'Non-admin must not create todos');

  w.properties.LINE_ADMIN_USER_IDS = 'Ualice';
  w.post([w.text('#待辦')]);
  assert(w.lastReply().includes('後面寫內容') && !w.sheets['To Do'], 'Empty todo shows usage');
  w.post([w.text('#待辦 PN Database 清單跟公司系統比對')]);
  assert(w.lastReply().startsWith('已記下 T001'), `Todo reply wrong: ${w.lastReply()}`);
  const sheet = w.sheets['To Do'];
  assert(sheet && sheet.data[5][0] === 'T001' && sheet.data[5][2] === 'PN Database 清單跟公司系統比對' && sheet.data[5][3] === '待辦', 'Todo row wrong');
  assert(sheet.data[4][0] === '待辦編號', 'Todo headers missing');
  w.post([w.text('＃待辦 國別 DB 補 XT')]);
  assert(sheet.data[6][0] === 'T002', 'Second todo should be T002');

  w.post([w.text('#待辦清單')]);
  const card = w.calls.replies.at(-1).messages[0];
  assert(card.type === 'flex' && card.altText.includes('2 項') && JSON.stringify(card.contents).includes('國別 DB 補 XT'), 'List card wrong');

  w.post([w.text('T001 完成')]);
  assert(w.lastReply() === 'T001 已完成 ✅' && sheet.data[5][3] === '已完成' && sheet.data[5][4], 'Done status wrong');
  w.post([w.text('T002 進行中')]);
  assert(sheet.data[6][3] === '進行中', 'In-progress status wrong');
  w.post([w.text('T009 完成')]);
  assert(w.lastReply().includes('找不到 T009'), 'Unknown todo should say not found');

  w.post([w.text('T002 完成', 'Ubob')]);
  assert(sheet.data[6][3] === '進行中' && w.lastReply().includes('只有維護人員'), 'Non-admin cannot change status');
  w.post([w.text('#待辦清單', 'Ubob')]);
  assert(w.lastReply().includes('只有維護人員'), 'Non-admin cannot list');
});

test('#我的ID only answers in setup mode', () => {
  const w = createWorld();
  w.post([w.text('#我的ID')]);
  assert(w.calls.replies.length === 0, 'Must stay silent outside setup mode');
  w.properties.LINE_SETUP_MODE = 'true';
  w.post([w.text('#我的ID')]);
  assert(w.lastReply().includes('Ualice') && w.lastReply().includes('LINE_ADMIN_USER_IDS'), 'Setup mode should reveal user ID');
});

test('#額度 shows monthly push usage to the admin only', () => {
  const w = createWorld();
  w.post([w.text('#額度')]);
  assert(w.lastReply().includes('只有維護人員'), 'Non-admin must be refused');
  w.properties.LINE_ADMIN_USER_IDS = 'Ualice';
  w.post([w.text('#額度')]);
  assert(w.lastReply().includes('已用 12 / 200 則（6%），剩 188 則'), `Quota reply wrong: ${w.lastReply()}`);
  w.quota.limit = null;
  w.post([w.text('＃額度')]);
  assert(w.lastReply().includes('沒有上限'), 'Unlimited plan wording missing');
});

test('quota warning email is sent once a month at 80%', () => {
  const w = createWorld();
  w.api.processLineOutbox();
  assert(!w.calls.mails.some((m) => m.subject.startsWith('[LINE 額度]')), 'No warning below 80%');
  w.quota.used = 165;
  w.api.processLineOutbox();
  w.api.processLineOutbox();
  const warnings = w.calls.mails.filter((m) => m.subject.startsWith('[LINE 額度]'));
  assert(warnings.length === 1 && warnings[0].subject.includes('165/200'), `Warning count wrong: ${warnings.length}`);
});

test('line-reply extraction and tool ordering', () => {
  const w = createWorld();
  assert(w.api.extractLineReply_('a<!-- line-reply --> 已修好 <!-- /line-reply -->b') === '已修好', 'Extraction failed');
  assert(w.api.detectLineTool_('PIM 合併 BOM 少一列') === 'PIM 合併', 'PIM must win over BOM');
  assert(w.api.detectLineTool_('今天天氣很好') === '', 'Unrelated text must not match');
});

test('daily summary: after 18:00 Taipei pushes open items once per day per group', () => {
  const w = createWorld();
  assert(typeof w.api.sendDailySummary_ === 'function', 'sendDailySummary_ missing');
  w.properties.LINE_GROUP_IDS = GROUP + ',' + OTHER_GROUP;
  let clock = { date: '2026-10-01', hour: '17' };
  w.context.Utilities.formatDate = (_d, _tz, fmt) => (fmt === 'H' ? clock.hour : fmt === 'MM/dd' ? '10/01' : clock.date);
  const fb = w.sheets['BOM Feedback'];
  const put = (sheet, r, values) => values.forEach((v, i) => sheet.setCell(r, i + 1, v));
  put(fb, 5, ['範例（啟用前刪除）', '', '', '', '範例', '僅示範', '新回饋']);
  put(fb, 6, ['F001', '', '', 'LINE 回報', '工具：PIM 合併', '少一列', '新回饋', '', '', '', 'LINE', '', 0, GROUP]);
  put(fb, 7, ['F002', '', '', 'LINE 回報', '工具：BOM 轉檔與安檢', '品名亂碼', '新回饋', '', '', '', 'LINE', '', 0, GROUP, '想確認一下', '已發送']);
  put(fb, 8, ['F003', '', '', 'LINE 回報', '工具：CTO EDI 新專案維護', '接續', '處理中', '', '', '', 'LINE', '', 0, GROUP, '已修好', '修好已通知']);
  put(fb, 9, ['F004', '', '', 'LINE 回報', '工具：PN 工具', '已好', '已解決', '', '', '', 'LINE', '', 0, GROUP]);
  put(fb, 10, ['F005', '', '', 'LINE 回報', '工具：PN 工具', '別群組', '新回饋', '', '', '', 'LINE', '', 0, OTHER_GROUP]);
  put(fb, 11, ['F006', '', '', 'LINE 回報', '工具：PN 工具', '未授權群組', '新回饋', '', '', '', 'LINE', '', 0, 'Cunknown']);
  w.sheets['Data Requests'] = (function () { const s = w.context.SpreadsheetApp.openById().insertSheet('Data Requests'); return s; })();
  put(w.sheets['Data Requests'], 5, ['U001', '', 'PN_Project_Map', 'x', '', 1, '預覽完成', GROUP]);
  put(w.sheets['Data Requests'], 6, ['U002', '', 'PN_Project_Map', 'x', '', 1, '已完成', GROUP]);

  w.api.sendDailySummary_(new Date());
  assert(w.calls.pushes.length === 0, 'Must not push before 18:00');

  clock.hour = '18';
  w.api.sendDailySummary_(new Date());
  const toWork = w.calls.pushes.filter((p) => p.to === GROUP);
  const toOther = w.calls.pushes.filter((p) => p.to === OTHER_GROUP);
  assert(toWork.length === 1 && toOther.length === 1 && w.calls.pushes.length === 2, 'One push per group with open items: ' + JSON.stringify(w.calls.pushes.map((p) => p.to)));
  const text = toWork[0].messages[0].text;
  assert(text.includes('10/01') && text.includes('F001') && text.includes('F002') && text.includes('F003') && text.includes('U001'), 'Open items missing: ' + text);
  assert(!text.includes('F004') && !text.includes('U002') && !text.includes('F005') && !text.includes('範例'), 'Closed, other-group or sample rows leaked: ' + text);
  assert(text.includes('PIM 合併') && text.includes('F003 OK') && text.includes('待維護者確認'), 'Status wording wrong: ' + text);
  assert(!toOther[0].messages[0].text.includes('F001') && toOther[0].messages[0].text.includes('F005'), 'Groups must only see their own items');

  w.api.sendDailySummary_(new Date());
  assert(w.calls.pushes.length === 2, 'Must send only once per day');
  clock = { date: '2026-10-02', hour: '19' };
  w.api.sendDailySummary_(new Date());
  assert(w.calls.pushes.length === 4, 'Next day should send again');
});

test('daily summary: nothing open means no push', () => {
  const w = createWorld();
  w.context.Utilities.formatDate = (_d, _tz, fmt) => (fmt === 'H' ? '18' : fmt === 'MM/dd' ? '10/01' : '2026-10-01');
  w.sheets['BOM Feedback'].setCell(5, 1, 'F001'); w.sheets['BOM Feedback'].setCell(5, 7, '已解決'); w.sheets['BOM Feedback'].setCell(5, 14, GROUP);
  w.api.sendDailySummary_(new Date());
  assert(w.calls.pushes.length === 0, 'No open items must stay silent');
});

test('GitHub calls send the token only when GITHUB_TOKEN is set', () => {
  const w = createWorld();
  w.api.processLineOutbox();
  assert(w.calls.github.length === 2 && w.calls.github.every((h) => !h.Authorization), 'No token: must not send Authorization');
  w.properties.GITHUB_TOKEN = 'ghp-test';
  w.api.processLineOutbox();
  const withToken = w.calls.github.slice(2);
  assert(withToken.length === 2 && withToken.every((h) => h.Authorization === 'Bearer ghp-test' && h.Accept === 'application/vnd.github+json'), 'Token must be sent to both GitHub calls: ' + JSON.stringify(withToken));
});
test('sendDailySummaryNow sends before 18:00 and the 18:00 run does not repeat it', () => {
  const w = createWorld();
  assert(typeof w.api.sendDailySummaryNow === 'function', 'sendDailySummaryNow missing');
  let hour = '10';
  w.context.Utilities.formatDate = (_d, _tz, fmt) => (fmt === 'H' ? hour : fmt === 'MM/dd' ? '10/01' : '2026-10-01');
  const fb = w.sheets['BOM Feedback'];
  ['F001', '', '', 'LINE 回報', '工具：PIM 合併', 'x', '新回饋', '', '', '', 'LINE', '', 0, GROUP].forEach((v, i) => fb.setCell(5, i + 1, v));
  w.api.sendDailySummaryNow();
  assert(w.calls.pushes.length === 1 && w.calls.pushes[0].messages[0].text.includes('F001'), 'Manual send must push now');
  hour = '18';
  w.api.sendDailySummary_(new Date());
  assert(w.calls.pushes.length === 1, 'Scheduled run must not repeat after manual send');
});
test('Claude status entry writes 判定專案 for U rows, and the daily summary shows it', () => {
  const w = createWorld();
  w.properties.CLAUDE_REPLY_KEY = 'claude-key';
  w.post([w.text('#更新 PN_Project_Map')]);
  const call = (body) => JSON.parse(w.api.doPost({ parameter: {}, postData: { type: 'text/plain', contents: JSON.stringify({ events: [], claudeStatus: Object.assign({ key: 'claude-key' }, body) }) } }));
  const r = call({ id: 'U001', status: '預覽完成', project: 'Demo Project X' });
  assert(r.ok && r.project === 'Demo Project X', `Result wrong: ${JSON.stringify(r)}`);
  const sheet = w.sheets['Data Requests'];
  assert(w.dataRow(5)[6] === '預覽完成' && w.dataRow(5)[13] === 'Demo Project X', `Project not written: ${JSON.stringify(w.dataRow(5))}`);
  assert(sheet.data[4][13] === '判定專案', 'Header 判定專案 missing');
  const f = call({ id: 'F001', status: '處理中', project: 'ignored' });
  assert(!f.ok || f.project === undefined, 'F rows must not take a project');

  w.context.Utilities.formatDate = (_d, _tz, fmt) => (fmt === 'H' ? '18' : fmt === 'MM/dd' ? '10/01' : '2026-10-01');
  w.api.sendDailySummary_(new Date());
  const text = w.calls.pushes.at(-1).messages[0].text;
  assert(text.includes('U001｜Demo Project X') && text.includes('待維護者確認寫入'), `Summary must show project: ${text}`);
});

test('Claude update-log entry appends U rows once, rejects bad key/rows, and needs UPDATE_LOG_SHEET_ID', () => {
  const w = createWorld();
  w.properties.CLAUDE_REPLY_KEY = 'claude-key';
  const call = (body) => JSON.parse(w.api.doPost({ parameter: {}, postData: { type: 'text/plain', contents: JSON.stringify({ events: [], claudeLog: Object.assign({ key: 'claude-key' }, body) }) } }));
  const rows = [['U009', '2026-10-01', '新增', 'SBB0TEST01', 'Demo P', 'Demo P'], ['U009', '2026-10-01', '補標籤', 'SBB0TEST02', 'Demo P', 'Old,Demo P']];
  assert(call({ rows }).error === 'UPDATE_LOG_SHEET_ID missing', 'Must require the log sheet property');
  w.properties.UPDATE_LOG_SHEET_ID = 'log-sheet';
  const log = w.sheets.__log = (function () { const s = w.context.SpreadsheetApp.openById().insertSheet('__log'); return s; })();
  log.setCell(1, 1, '需求編號'); log.setCell(1, 2, '更新日期'); log.setCell(1, 3, '類型'); log.setCell(1, 4, '料號'); log.setCell(1, 5, '這次加入的專案'); log.setCell(1, 6, '更新後專案清單');
  ['U001', '2026-09-24', '新增', 'SBB0OLD001', 'Old', 'Old'].forEach((v, i) => log.setCell(2, i + 1, v));
  assert(call({ key: 'wrong', rows }).error === 'unauthorized', 'Wrong key must be rejected');
  assert(call({ rows: [['X1', '2026-10-01', '新增', 'SBB0TEST01', 'P', 'P']] }).error === 'invalid rows', 'Non-U id must be rejected');
  assert(call({ rows: [['U009', '2026-10-01', '刪除', 'SBB0TEST01', 'P', 'P']] }).error === 'invalid rows', 'Unknown type must be rejected');
  const r = call({ rows });
  assert(r.ok && r.before === 1 && r.appended === 2 && r.skipped === 0 && r.after === 3, `Append result wrong: ${JSON.stringify(r)}`);
  assert(log.data[3][3] === 'SBB0TEST01' && log.data[4][5] === 'Old,Demo P' && log.data[2][3] === 'SBB0OLD001', 'Rows not appended after existing data');
  const again = call({ rows });
  assert(again.ok && again.appended === 0 && again.skipped === 2 && again.after === 3, `Re-run must not duplicate: ${JSON.stringify(again)}`);
  assert(w.calls.pushes.length === 0, 'Log entry must not push to LINE');
});

test('fixed reminder: after 3 full workdays without OK, reminds once in working hours with context', () => {
  const w = createWorld();
  assert(typeof w.api.sendFixedReminders_ === 'function', 'sendFixedReminders_ missing');
  const fb = w.sheets['BOM Feedback'];
  const put = (r, values) => values.forEach((v, i) => fb.setCell(r, i + 1, v));
  const taipei = (iso) => new Date(`${iso}+08:00`);
  // 週二回報、週三 13:00 修好通知 → 週四、週五、週一滿 3 個工作天 → 週二 09:00 後才提醒
  put(5, ['F001', taipei('2026-09-30T10:00:00'), '', 'LINE 回報', '工具：PN 工具', '同事原文不可出現', '處理中', '', '', '', 'LINE', '', 0, GROUP,
    '已加上搜尋筆數顯示，網站已更新到 v2.16.17。\n（PR #39）', '修好已通知', taipei('2026-10-01T13:00:00'), '', '', '快速搜尋看不出幾筆、結果區太小']);
  put(6, ['F002', taipei('2026-09-20T10:00:00'), '', 'LINE 回報', '工具：BOM 轉檔與安檢', '原文', '已解決', '', '', '', 'LINE', '', 0, GROUP, '修好', '同事已確認', taipei('2026-09-21T10:00:00')]);
  put(7, ['F003', taipei('2026-09-20T10:00:00'), '', 'LINE 回報', '工具：PN 工具', '原文', '處理中', '', '', '', 'LINE', '', 0, 'Cunknown', '修好', '修好已通知', taipei('2026-09-21T10:00:00')]);
  put(8, ['F004', taipei('2026-09-20T10:00:00'), '', 'LINE 回報', '工具：PN 工具', '原文', '處理中', '', '', '', 'LINE', '', 0, GROUP, '想確認一下', '已發送', taipei('2026-09-21T10:00:00')]);

  w.api.sendFixedReminders_(taipei('2026-10-06T10:00:00'));
  assert(w.calls.pushes.length === 0, 'Monday is only 2 full workdays: must wait');
  w.api.sendFixedReminders_(taipei('2026-10-04T10:00:00'));
  assert(w.calls.pushes.length === 0, 'Weekend: must not push');
  w.api.sendFixedReminders_(taipei('2026-10-07T08:30:00'));
  assert(w.calls.pushes.length === 0, 'Before 09:00: must not push');

  w.api.sendFixedReminders_(taipei('2026-10-07T09:10:00'));
  assert(w.calls.pushes.length === 1 && w.calls.pushes[0].to === GROUP, 'Exactly one reminder to the report group: ' + JSON.stringify(w.calls.pushes.map((p) => p.to)));
  const text = w.calls.pushes[0].messages[0].text;
  assert(text.includes('F001 提醒') && text.includes('09/30 回報：快速搜尋看不出幾筆、結果區太小'), 'Must say what was reported and when: ' + text);
  assert(text.includes('10/01 已修好：已加上搜尋筆數顯示') && !text.includes('PR #39'), 'Must say what was fixed, without PR number: ' + text);
  assert(text.includes('「F001 OK」') && text.includes('最後一次提醒') && !text.includes('同事原文'), 'Must ask for OK, mark last reminder, never quote original: ' + text);
  assert(w.row(5)[20] && typeof w.row(5)[20].getTime === 'function' && w.row(5)[6] === '處理中', 'Reminder time recorded; status unchanged');

  w.api.sendFixedReminders_(taipei('2026-10-08T10:00:00'));
  assert(w.calls.pushes.length === 1, 'Only one reminder ever');
  w.post([w.text('F001 OK')]);
  assert(w.row(5)[6] === '已解決' && w.lastReply().includes('已結案'), 'OK after reminder still closes');
});

test('fixed reminder: without a summary falls back to the tool name; failed push retries later', () => {
  const w = createWorld();
  const fb = w.sheets['BOM Feedback'];
  const taipei = (iso) => new Date(`${iso}+08:00`);
  ['F001', taipei('2026-09-28T10:00:00'), '', 'LINE 回報', '工具：CTO EDI 新專案維護', '原文', '處理中', '', '', '', 'LINE', '', 0, GROUP, '已修好。', '修好已通知', taipei('2026-09-29T10:00:00')]
    .forEach((v, i) => fb.setCell(5, i + 1, v));
  const fetch = w.context.UrlFetchApp.fetch;
  w.context.UrlFetchApp.fetch = (url, options) => { if (url.includes('/message/push')) throw new Error('LINE down'); return fetch(url, options); };
  try { w.api.sendFixedReminders_(taipei('2026-10-05T10:00:00')); } catch (e) { /* linePush_ 失敗 */ }
  assert(!w.row(5)[20], 'Failed push must not record reminder time');
  w.context.UrlFetchApp.fetch = fetch;
  w.api.sendFixedReminders_(taipei('2026-10-05T10:20:00'));
  const text = (w.calls.pushes.at(-1) || { messages: [{ text: '' }] }).messages[0].text;
  assert(text.includes('09/28 回報：CTO EDI 新專案維護 的問題') && text.includes('09/29 已修好：已修好。'), 'Fallback wording wrong: ' + text);
});

test('Claude status entry writes 問題摘要 for F rows only, and the daily summary shows it', () => {
  const w = createWorld();
  w.properties.CLAUDE_REPLY_KEY = 'claude-key';
  w.post([w.text('#回報 PN 工具搜尋看不出筆數')]);
  w.post([w.text('#更新 PN_Project_Map')]);
  const call = (body) => JSON.parse(w.api.doPost({ parameter: {}, postData: { type: 'text/plain', contents: JSON.stringify({ events: [], claudeStatus: Object.assign({ key: 'claude-key' }, body) }) } }));
  const r = call({ id: 'F001', status: '處理中', summary: '  快速搜尋看不出幾筆\n結果區太小 ' });
  assert(r.ok && r.summary === '快速搜尋看不出幾筆 結果區太小', `Result wrong: ${JSON.stringify(r)}`);
  assert(w.row(5)[19] === '快速搜尋看不出幾筆 結果區太小' && w.rows[4][19] === '問題摘要' && w.rows[4][20] === '修好提醒時間', 'Summary or headers not written');
  const u = call({ id: 'U001', status: '預覽完成', summary: 'ignored' });
  assert(u.ok && u.summary === undefined && !w.dataRow(5)[19], 'U rows must not take a summary');

  w.context.Utilities.formatDate = (_d, _tz, fmt) => (fmt === 'H' ? '18' : fmt === 'MM/dd' ? '10/01' : '2026-10-01');
  w.api.sendDailySummary_(new Date());
  const text = w.calls.pushes.at(-1).messages[0].text;
  assert(text.includes('F001｜PN 工具\n　快速搜尋看不出幾筆 結果區太小\n　維護者處理中'), `Summary must show 問題摘要: ${text}`);
});

function seedOpenItems(w) {
  const fb = w.sheets['BOM Feedback'];
  const put = (sheet, r, values) => values.forEach((v, i) => sheet.setCell(r, i + 1, v));
  put(fb, 5, ['F001', '', '', 'LINE 回報', '工具：PIM 合併', '少一列', '新回饋', '', '', '', 'LINE', '', 0, GROUP]);
  put(fb, 6, ['F002', '', '', 'LINE 回報', '工具：PN 工具', 'x', '處理中', '', '', '', 'LINE', '', 0, GROUP, '已修好', '修好已通知']);
  put(fb, 7, ['F003', '', '', 'LINE 回報', '工具：PN 工具', 'x', '新回饋', '', '', '', 'LINE', '', 0, GROUP, '想確認', '已發送']);
  put(fb, 8, ['F004', '', '', 'LINE 回報', '工具：PN 工具', 'x', '已解決', '', '', '', 'LINE', '', 0, GROUP]);
  put(fb, 9, ['F005', '', '', 'LINE 回報', '工具：PN 工具', 'x', '新回饋', '', '', '', 'LINE', '', 0, OTHER_GROUP]);
  fb.setCell(5, 20, '快速搜尋看不出幾筆');
  w.context.SpreadsheetApp.openById().insertSheet('Data Requests');
  put(w.sheets['Data Requests'], 5, ['U001', '', 'PN_Project_Map', 'x', '', 1, '預覽完成', GROUP]);
}
const lastMessage = (w) => w.calls.replies.at(-1).messages[0];

test('#小幫手 menu card: everyone can open it, admin-only buttons only for admins', () => {
  const w = createWorld();
  seedOpenItems(w);
  w.properties.LINE_ADMIN_USER_IDS = 'Uadmin';
  for (const cmd of ['#小幫手', '＃小幫手', '#選單', '#menu']) {
    w.post([w.text(cmd, 'Ubob')]);
    const card = lastMessage(w);
    const json = JSON.stringify(card.contents);
    assert(card.type === 'flex' && json.includes('#狀況') && json.includes('#說明') && json.includes('#網站') && json.includes('#回報') && json.includes('#更新'), cmd + ' menu missing buttons: ' + json);
    assert(json.includes('未結案 4'), cmd + ' menu should show this group open count: ' + json);
    assert(!json.includes('#待辦清單') && !json.includes('#額度'), 'Colleague must not see admin buttons');
  }
  w.post([w.text('#小幫手', 'Uadmin')]);
  const adminJson = JSON.stringify(lastMessage(w).contents);
  assert(adminJson.includes('#待辦清單') && adminJson.includes('#額度'), 'Admin should see admin buttons');
  w.post([w.text('小幫手你好', 'Ubob')]);
  assert(w.calls.replies.length === 5, 'Plain chat must stay silent');
});

test('#狀況 lists only this group open F／U items with state labels', () => {
  const w = createWorld();
  seedOpenItems(w);
  w.post([w.text('#狀況', 'Ubob')]);
  const card = lastMessage(w);
  const json = JSON.stringify(card.contents);
  assert(card.type === 'flex' && card.altText.includes('未結案 4'), 'altText wrong: ' + card.altText);
  assert(json.includes('F001') && json.includes('F002') && json.includes('F003') && json.includes('U001'), 'Open items missing: ' + json);
  assert(!json.includes('F004') && !json.includes('F005'), 'Closed or other-group items leaked: ' + json);
  assert(json.includes('快速搜尋看不出幾筆') && json.includes('修好待 OK') && json.includes('等你回覆') && json.includes('處理中') && json.includes('待確認寫入'), 'State labels wrong: ' + json);
  assert(!json.includes('少一列'), 'Must not show colleague original description');
  w.post([w.text('#狀況', 'Ubob', OTHER_GROUP)]);
  assert(w.calls.replies.length === 1, 'Other non-allowed group must stay silent');
  w.properties.LINE_GROUP_IDS = GROUP + ',' + OTHER_GROUP;
  w.post([w.text('#進度', 'Ubob', OTHER_GROUP)]);
  const other = JSON.stringify(lastMessage(w).contents);
  assert(other.includes('F005') && !other.includes('F001'), 'Groups must only see their own items: ' + other);
});

test('#狀況 with nothing open replies a short text', () => {
  const w = createWorld();
  w.post([w.text('#狀況')]);
  assert(w.lastReply().includes('目前沒有未結案'), 'Empty status wrong: ' + w.lastReply());
});

test('#說明 shows the usage card', () => {
  const w = createWorld();
  w.post([w.text('#說明')]);
  const json = JSON.stringify(lastMessage(w).contents);
  assert(lastMessage(w).type === 'flex' && json.includes('#回報') && json.includes('OK') && json.includes('#更新') && json.includes('#小幫手'), 'Help card wrong: ' + json);
  w.post([w.text('#使用說明')]);
  assert(lastMessage(w).type === 'flex', '#使用說明 alias should work');
});

test('#網站 reads links from LINE_QUICK_LINKS, keeps https only, falls back to the site', () => {
  const w = createWorld();
  w.post([w.text('#網站')]);
  let json = JSON.stringify(lastMessage(w).contents);
  assert(json.includes('https://poupyy220-art.github.io/workspace/'), 'Default link missing: ' + json);
  w.properties.LINE_QUICK_LINKS = '測試網站A|https://a.example.com/\n測試網站B | https://b.example.com/x?y=1 ; 壞連結|javascript:alert(1)\n沒網址';
  w.post([w.text('#常用網站')]);
  const card = lastMessage(w);
  json = JSON.stringify(card.contents);
  const uris = (json.match(/"uri":"[^"]+"/g) || []);
  assert(uris.length === 2 && json.includes('https://a.example.com/') && json.includes('https://b.example.com/x?y=1') && json.includes('測試網站B'), 'Links wrong: ' + json);
  assert(!json.includes('javascript'), 'Non-https link must be dropped');
  w.properties.LINE_QUICK_LINKS = Array.from({ length: 12 }, (_, i) => '站' + i + '|https://s' + i + '.example.com/').join('\n');
  w.post([w.text('#網站')]);
  assert((JSON.stringify(lastMessage(w).contents).match(/"uri":/g) || []).length === 8, 'At most 8 links');
});

// ---------- 行事曆 ----------
const DAY_MS = 86400000;
const TPE = 8 * 3600000;
const tpe = (iso) => new Date(`${iso}+08:00`);
// 全天行程：真實 API 回傳「指令碼時區的午夜」，這裡指令碼時區假設 Asia/Taipei
const tpeMidnight = (date) => new Date(Math.floor((date.getTime() + TPE) / DAY_MS) * DAY_MS - TPE);

function makeCalendar() {
  const events = [];
  let seq = 0;
  function add(title, start, end, allDay, opts = {}) {
    const tags = {};
    const ev = { id: `ev${++seq}`, title, start, end, allDay, recurring: Boolean(opts.recurring), visibility: opts.visibility || 'DEFAULT', deleted: false, options: opts.options || {}, tags };
    ev.api = {
      getId: () => ev.id, getTitle: () => ev.title, setTitle: (t) => { ev.title = t; },
      getStartTime: () => ev.start, getEndTime: () => ev.end, isAllDayEvent: () => ev.allDay,
      getAllDayStartDate: () => ev.start, getAllDayEndDate: () => ev.end,
      setTime: (s, e) => { ev.start = s; ev.end = e; ev.allDay = false; },
      setAllDayDates: (s, e) => { ev.start = tpeMidnight(s); ev.end = tpeMidnight(e); ev.allDay = true; },
      getTag: (k) => tags[k] ?? null, setTag: (k, v) => { tags[k] = v; },
      deleteEvent: () => { ev.deleted = true; }, isRecurringEvent: () => ev.recurring, getVisibility: () => ev.visibility
    };
    events.push(ev);
    return ev;
  }
  const calendar = {
    getId: () => 'work-cal',
    getEvents: (s, e) => events.filter((ev) => !ev.deleted && ev.start < e && ev.end > s).sort((a, b) => a.start - b.start).map((ev) => ev.api),
    getEventById: (id) => { const ev = events.find((x) => x.id === id && !x.deleted); return ev ? ev.api : null; },
    createEvent: (title, s, e, options) => add(title, s, e, false, { options }).api,
    createAllDayEvent: (title, s, e, options) => add(title, tpeMidnight(s), tpeMidnight(e), true, { options }).api
  };
  return { events, calendar, add };
}

function calendarWorld({ configured = true } = {}) {
  const w = createWorld();
  const cal = makeCalendar();
  w.context.CalendarApp = {
    Visibility: { DEFAULT: 'DEFAULT', PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE', CONFIDENTIAL: 'CONFIDENTIAL' },
    getCalendarById: (id) => (id === 'work-cal' ? cal.calendar : null),
    getCalendarsByName: (name) => (name === '工作' ? [cal.calendar] : [])
  };
  w.context.Session = { getScriptTimeZone: () => 'Asia/Taipei' };
  const fixed = w.context.Utilities.formatDate;
  w.context.Utilities.formatDate = (date, zone, pattern) => (pattern === 'yyyy-MM-dd' ? new Date(date.getTime() + TPE).toISOString().slice(0, 10) : fixed(date, zone, pattern));
  // 固定「現在」為 2026-10-02（五）09:00 台北時間
  w.context.calendarNow_ = () => tpe('2026-10-02T09:00:00');
  if (configured) w.properties.LINE_CALENDAR_ID = 'work-cal';
  w.properties.LINE_ADMIN_USER_IDS = 'Uadmin';
  return Object.assign(w, { cal });
}

test('#行程 before setup asks the maintainer to run setupLineCalendar', () => {
  const w = calendarWorld({ configured: false });
  w.post([w.text('#行程')]);
  assert(w.lastReply().includes('setupLineCalendar'), 'Setup hint missing: ' + w.lastReply());
});

test('setupLineCalendar finds the 工作 calendar and stores its ID', () => {
  const w = calendarWorld({ configured: false });
  const result = w.api.setupLineCalendar();
  assert(w.properties.LINE_CALENDAR_ID === 'work-cal' && result.includes('Asia/Taipei'), 'Setup wrong: ' + result);
  w.properties.LINE_CALENDAR_NAME = '不存在';
  assert(w.api.setupLineCalendar().includes('找到 0 本'), 'Missing calendar should be reported');
});

test('date and time parsing: relative days, weekdays, year rollover, 點半, numbers in titles', () => {
  const w = calendarWorld();
  const day = (iso) => Math.floor((tpe(`${iso}T00:00:00`).getTime() + TPE) / DAY_MS);
  const today = day('2026-10-02');
  const p = (s) => w.api.parseCalendarSpec_(s, today);
  assert(p('明天 會議').range.start === day('2026-10-03'), '明天 wrong');
  assert(p('週五 會議').range.start === day('2026-10-02'), '週五 should be today (Friday)');
  assert(p('下週一 會議').range.start === day('2026-10-05'), '下週一 wrong');
  assert(p('1/5 年初會議').range.start === day('2027-01-05'), 'Past date without year should roll to next year');
  assert(p('10/15 14點半 會議').time.start === 14 * 60 + 30, '點半 wrong');
  const numberTitle = p('10/15 3 號產線');
  assert(numberTitle.time === null && numberTitle.title === '3 號產線', 'Bare number must stay in title');
  assert(p('10/15 15:00-14:00 x').error.includes('結束時間'), 'End before start must error');
  assert(p('10/15-10/17 14:00 x').error.includes('跨天'), 'Range with time must error');
  assert(p('2/30 x').range === null, 'Invalid date must not parse');
});

test('#新增行程 creates a timed event with creator tag and C001, refuses duplicates', () => {
  const w = calendarWorld();
  w.post([w.text('#新增行程 明天 14:00-15:30 P3 BOM 會議')]);
  const ev = w.cal.events[0];
  assert(ev && ev.title === 'P3 BOM 會議' && !ev.allDay, 'Event not created');
  assert(ev.start.getTime() === tpe('2026-10-03T14:00:00').getTime() && ev.end.getTime() === tpe('2026-10-03T15:30:00').getTime(), 'Times wrong');
  assert(ev.tags.lineId === 'C001' && ev.tags.lineCreator === 'Ualice', 'Tags wrong: ' + JSON.stringify(ev.tags));
  assert(ev.options.description.includes('LINE'), 'Description missing');
  assert(w.lastReply().includes('C001') && w.lastReply().includes('10/03（六）') && w.lastReply().includes('14:00-15:30'), 'Reply wrong: ' + w.lastReply());
  w.post([w.text('#新增行程 10/3 14:00 P3 BOM 會議', 'Ubob')]);
  assert(w.cal.events.length === 1 && w.lastReply().includes('沒有重複新增'), 'Duplicate must be refused');
  w.post([w.text('#新增行程 10/3 9:00 早會')]);
  const second = w.cal.events[1];
  assert(second.end - second.start === 3600000 && second.tags.lineId === 'C002', 'Default 1 hour / next ID wrong');
});

test('#新增行程 all-day range, and usage when the title is missing', () => {
  const w = calendarWorld();
  w.post([w.text('#新增行程 10/15-10/17 深圳出差')]);
  const ev = w.cal.events[0];
  assert(ev.allDay && ev.start.getTime() === tpe('2026-10-15T00:00:00').getTime() && ev.end.getTime() === tpe('2026-10-18T00:00:00').getTime(), 'All-day dates wrong');
  assert(w.lastReply().includes('全天，到 10/17（六）'), 'All-day reply wrong: ' + w.lastReply());
  w.post([w.text('#新增行程 10/15')]);
  assert(w.lastReply().includes('請照這個格式') && w.cal.events.length === 1, 'Missing title must show usage');
});

test('#行程 lists 7 days, numbers Google-created events, hides private, marks recurring', () => {
  const w = calendarWorld();
  w.cal.add('EC 週會', tpe('2026-10-05T10:00:00'), tpe('2026-10-05T11:00:00'), false, { recurring: true });
  w.cal.add('直接在 Google 建的', tpe('2026-10-02T13:00:00'), tpe('2026-10-02T14:00:00'), false);
  w.cal.add('私人看診', tpe('2026-10-03T10:00:00'), tpe('2026-10-03T11:00:00'), false, { visibility: 'PRIVATE' });
  w.cal.add('下個月的', tpe('2026-11-20T10:00:00'), tpe('2026-11-20T11:00:00'), false);
  w.post([w.text('#行程', 'Ubob')]);
  const card = lastMessage(w);
  const json = JSON.stringify(card.contents);
  assert(card.type === 'flex' && card.altText.includes('2 筆'), 'altText wrong: ' + card.altText);
  assert(json.includes('直接在 Google 建的') && json.includes('C001') && json.includes('EC 週會') && json.includes('🔁'), 'List wrong: ' + json);
  assert(!json.includes('私人看診') && !json.includes('下個月的'), 'Private or out-of-range leaked: ' + json);
  assert(!w.cal.events[0].tags.lineId, 'Recurring events must not get an ID');
  w.post([w.text('#行程 11/20')]);
  assert(JSON.stringify(lastMessage(w).contents).includes('下個月的'), 'Single-day query wrong');
  w.post([w.text('#行程 12/25')]);
  assert(w.lastReply().includes('沒有行程'), 'Empty day wrong: ' + w.lastReply());
  w.post([w.text('#行程 隨便')]);
  assert(w.lastReply().includes('看不懂'), 'Bad range should explain');
});

test('#改行程: only creator or admin; time-only keeps date, date-only shifts, title changes', () => {
  const w = calendarWorld();
  w.post([w.text('#新增行程 10/15 14:00-15:00 P3 會議')]);
  const ev = w.cal.events[0];
  w.post([w.text('#改行程 C001 16:00', 'Ubob')]);
  assert(w.lastReply().includes('只有建立的人') && ev.start.getTime() === tpe('2026-10-15T14:00:00').getTime(), 'Other user must not edit');
  w.post([w.text('#改行程 C001 16:00')]);
  assert(ev.start.getTime() === tpe('2026-10-15T16:00:00').getTime() && ev.end.getTime() === tpe('2026-10-15T17:00:00').getTime(), 'Time-only edit wrong');
  assert(w.lastReply().includes('原本') && w.lastReply().includes('16:00-17:00'), 'Edit reply wrong: ' + w.lastReply());
  w.post([w.text('#改行程 c001 10/16 P3 會議（改期）')]);
  assert(ev.start.getTime() === tpe('2026-10-16T16:00:00').getTime() && ev.title === 'P3 會議（改期）', 'Date shift / title edit wrong');
  w.post([w.text('#改行程 C001 10/20-10/21', 'Uadmin')]);
  assert(ev.allDay && ev.start.getTime() === tpe('2026-10-20T00:00:00').getTime() && ev.end.getTime() === tpe('2026-10-22T00:00:00').getTime(), 'Admin range edit wrong');
  w.post([w.text('#改行程 C009 16:00')]);
  assert(w.lastReply().includes('找不到 C009'), 'Missing ID wrong');
  w.post([w.text('#改行程 C001')]);
  assert(w.lastReply().includes('改行程請寫編號'), 'Empty edit should show usage');
});

test('Google-created events: only admins can change them from LINE', () => {
  const w = calendarWorld();
  const ev = w.cal.add('主管會議', tpe('2026-10-02T15:00:00'), tpe('2026-10-02T16:00:00'), false);
  w.post([w.text('#行程')]);
  w.post([w.text('#改行程 C001 17:00')]);
  assert(w.lastReply().includes('只有建立的人'), 'Non-admin must not edit untagged-creator event');
  w.clearCache();
  w.post([w.text('#改行程 C001 17:00', 'Uadmin')]);
  assert(ev.start.getTime() === tpe('2026-10-02T17:00:00').getTime(), 'Admin edit (cache miss, scan) failed');
});

test('#刪行程 asks for confirmation first, then deletes', () => {
  const w = calendarWorld();
  w.post([w.text('#新增行程 10/15 出差')]);
  const ev = w.cal.events[0];
  w.post([w.text('#刪行程 C001', 'Ubob')]);
  assert(w.lastReply().includes('只有建立的人') && !ev.deleted, 'Other user must not delete');
  w.post([w.text('#刪行程 C001')]);
  const card = lastMessage(w);
  assert(card.type === 'flex' && JSON.stringify(card.contents).includes('#確認刪行程 C001') && !ev.deleted, 'Confirm card wrong');
  w.post([w.text('#確認刪行程 C001')]);
  assert(ev.deleted && w.lastReply().includes('垃圾桶'), 'Delete wrong: ' + w.lastReply());
  w.post([w.text('#確認刪行程 C001')]);
  assert(w.lastReply().includes('找不到 C001'), 'Deleted event must not be found again');
});

test('#小幫手 and #說明 mention the calendar commands', () => {
  const w = calendarWorld();
  w.post([w.text('#小幫手')]);
  assert(JSON.stringify(lastMessage(w).contents).includes('"text":"#行事曆"'), 'Menu button missing');
  w.post([w.text('#說明')]);
  const json = JSON.stringify(lastMessage(w).contents);
  assert(json.includes('#新增行程') && json.includes('#改行程') && json.includes('#刪行程'), 'Help lines missing');
});

test('events added without a LINE user ID have no creator, so other ID-less users cannot edit them', () => {
  const w = calendarWorld();
  const anonymous = (value) => { const e = w.text(value); delete e.source.userId; return e; };
  w.post([anonymous('#新增行程 10/15 14:00 匿名會議')]);
  const ev = w.cal.events[0];
  assert(ev && ev.tags.lineId === 'C001' && !('lineCreator' in ev.tags), 'unknown must not be stored as creator: ' + JSON.stringify(ev && ev.tags));
  w.post([anonymous('#改行程 C001 16:00')]);
  assert(w.lastReply().includes('只有建立的人') && ev.start.getTime() === tpe('2026-10-15T14:00:00').getTime(), 'ID-less user must not edit');
  ev.tags.lineCreator = 'unknown';
  w.post([anonymous('#刪行程 C001')]);
  assert(w.lastReply().includes('只有建立的人') && !ev.deleted, 'Legacy unknown creator must not match');
});

test('duplicate check ignores private events and never reveals them', () => {
  const w = calendarWorld();
  w.cal.add('看診', tpe('2026-10-15T00:00:00'), tpe('2026-10-16T00:00:00'), true, { visibility: 'PRIVATE' });
  w.post([w.text('#新增行程 10/15 看診')]);
  assert(w.cal.events.length === 2 && !w.lastReply().includes('沒有重複新增'), 'Private event must not count as duplicate');
  assert(!w.cal.events[0].tags.lineId, 'Private event must not get an ID');
  assert(w.lastReply().includes('C001') && w.cal.events[1].tags.lineId === 'C001', 'New event should be C001');
});

test('list, add and edit are limited to the window the ID lookup can scan', () => {
  const w = calendarWorld();
  w.post([w.text('#行程 2028/3/1')]);
  assert(w.lastReply().includes('看不懂') && w.lastReply().includes('400'), 'Far-future list must be refused: ' + w.lastReply());
  w.post([w.text('#新增行程 2028/3/1 遠期會議')]);
  assert(w.cal.events.length === 0 && w.lastReply().includes('400'), 'Far-future add must be refused: ' + w.lastReply());
  w.post([w.text('#新增行程 10/15 會議')]);
  w.post([w.text('#改行程 C001 2028/3/1')]);
  assert(w.lastReply().includes('400') && w.cal.events[0].start.getTime() === tpe('2026-10-15T00:00:00').getTime(), 'Far-future edit must be refused');
});

test('duplicate check and create run inside one lock', () => {
  const w = calendarWorld();
  let held = 0;
  w.context.LockService = { getScriptLock: () => ({ waitLock() { held += 1; }, releaseLock() { held -= 1; } }) };
  const create = w.cal.calendar.createEvent;
  let createdWhileLocked = null;
  w.cal.calendar.createEvent = (...args) => { createdWhileLocked = held > 0; return create(...args); };
  w.post([w.text('#新增行程 10/15 14:00 會議')]);
  assert(createdWhileLocked === true && held === 0, 'createEvent must run while the lock is held');
});

// ---------- 積木 UI 與轉盤 ----------
const postback = (w, data, params, user = 'Ualice') => ({ type: 'postback', replyToken: `pb${Math.random()}`, source: { type: 'group', groupId: GROUP, userId: user }, postback: { data, params } });
const findActions = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (node.action) out.push(node.action);
  Object.values(node).forEach((v) => { if (v && typeof v === 'object') findActions(v, out); });
  return out;
};

test('#行事曆 shows the calendar menu with today/week buttons and three date pickers', () => {
  const w = calendarWorld();
  w.post([w.text('#行事曆')]);
  const card = lastMessage(w);
  assert(card.type === 'flex', 'Menu should be flex');
  const actions = findActions(card.contents);
  const texts = actions.filter((a) => a.type === 'message').map((a) => a.text);
  assert(['#行程 今天', '#行程 明天', '#行程 本週', '#行程 下週'].every((t) => texts.includes(t)), 'Quick buttons missing: ' + texts);
  const pickers = actions.filter((a) => a.type === 'datetimepicker');
  const byData = Object.fromEntries(pickers.map((a) => [a.data, a]));
  assert(byData['cal=list'] && byData['cal=list'].mode === 'date', 'Pick-a-day query missing');
  assert(byData['cal=add&mode=allday'].mode === 'date' && byData['cal=add&mode=timed'].mode === 'datetime' && byData['cal=add&mode=range1'].mode === 'date', 'Add pickers wrong: ' + JSON.stringify(pickers));
  assert(byData['cal=add&mode=allday'].initial === '2026-10-02' && byData['cal=add&mode=timed'].initial === '2026-10-02T09:00', 'Initial date wrong');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(byData['cal=list'].min) && /T23:59$/.test(byData['cal=add&mode=timed'].max), 'min/max format wrong');
  w.post([w.text('#行事曆 明天')]);
  assert(JSON.stringify(lastMessage(w)).includes('沒有行程') || lastMessage(w).type === 'flex', '#行事曆 with a range still lists events');
});

test('all-day picker: choose a date, reply the name, event is created with a done card', () => {
  const w = calendarWorld();
  w.post([postback(w, 'cal=add&mode=allday', { date: '2026-10-15' })]);
  assert(w.lastReply().includes('10/15（四） 全天') && w.lastReply().includes('要記什麼行程'), 'Should ask for name: ' + w.lastReply());
  w.post([w.text('#狀況')]);
  assert(w.cal.events.length === 0, 'Commands during pending must not become the title');
  w.post([w.text('示範專案A 出差')]);
  const ev = w.cal.events[0];
  assert(ev && ev.allDay && ev.title === '示範專案A 出差' && ev.start.getTime() === tpe('2026-10-15T00:00:00').getTime() && ev.tags.lineCreator === 'Ualice', 'All-day event wrong');
  const card = lastMessage(w);
  const actions = findActions(card.contents);
  assert(card.type === 'flex' && card.altText.includes('C001'), 'Done card missing');
  assert(actions.some((a) => a.type === 'datetimepicker' && a.data === 'cal=edit&id=C001' && a.mode === 'date'), 'All-day edit picker should be date mode');
  assert(actions.some((a) => a.type === 'message' && a.text === '#刪行程 C001'), 'Delete button missing');
  w.post([w.text('下一句一般聊天')]);
  assert(w.cal.events.length === 1, 'Pending must be cleared after one name');
});

test('timed picker creates a one-hour event at the chosen time', () => {
  const w = calendarWorld();
  w.post([postback(w, 'cal=add&mode=timed', { datetime: '2026-10-15T14:30' })]);
  assert(w.lastReply().includes('14:30 起'), 'Prompt wrong: ' + w.lastReply());
  w.post([w.text('會議')]);
  const ev = w.cal.events[0];
  assert(!ev.allDay && ev.start.getTime() === tpe('2026-10-15T14:30:00').getTime() && ev.end.getTime() === tpe('2026-10-15T15:30:00').getTime(), 'Timed event wrong');
  assert(findActions(lastMessage(w).contents).some((a) => a.data === 'cal=edit&id=C001' && a.mode === 'datetime'), 'Timed edit picker should be datetime');
});

test('range picker: start day card, then end day, then name', () => {
  const w = calendarWorld();
  w.post([postback(w, 'cal=add&mode=range1', { date: '2026-10-15' })]);
  const card = lastMessage(w);
  const end = findActions(card.contents).find((a) => a.type === 'datetimepicker' && a.data.startsWith('cal=add&mode=range2'));
  assert(card.type === 'flex' && end && end.min === '2026-10-15' && end.initial === '2026-10-15', 'End picker wrong: ' + JSON.stringify(end));
  w.post([postback(w, end.data, { date: '2026-10-14' })]);
  assert(w.lastReply().includes('結束日要在開始日之後'), 'End before start must be refused');
  w.post([postback(w, end.data, { date: '2026-10-17' })]);
  assert(w.lastReply().includes('10/15（四）～10/17（六） 全天'), 'Range prompt wrong: ' + w.lastReply());
  w.post([w.text('深圳出差')]);
  const ev = w.cal.events[0];
  assert(ev.allDay && ev.start.getTime() === tpe('2026-10-15T00:00:00').getTime() && ev.end.getTime() === tpe('2026-10-18T00:00:00').getTime(), 'Range event wrong');
});

test('pickers respect the date window and ignore malformed data', () => {
  const w = calendarWorld();
  w.post([postback(w, 'cal=add&mode=allday', { date: '2028-03-01' })]);
  assert(w.lastReply().includes('400'), 'Far date must be refused');
  w.post([postback(w, 'cal=add&mode=allday', {})]);
  assert(w.lastReply().includes('沒有收到日期'), 'Missing params should explain');
  const before = w.calls.replies.length;
  w.post([postback(w, 'unknown=1', { date: '2026-10-15' })]);
  assert(w.calls.replies.length === before, 'Unknown postback must stay silent');
});

test('edit picker moves the event, keeps duration, and still checks permission', () => {
  const w = calendarWorld();
  w.post([w.text('#新增行程 10/15 14:00-15:30 會議')]);
  w.post([postback(w, 'cal=edit&id=C001', { datetime: '2026-10-16T10:00' }, 'Ubob')]);
  assert(w.lastReply().includes('只有建立的人'), 'Other user must not edit by picker');
  w.post([postback(w, 'cal=edit&id=C001', { datetime: '2026-10-16T10:00' })]);
  const ev = w.cal.events[0];
  assert(ev.start.getTime() === tpe('2026-10-16T10:00:00').getTime() && ev.end.getTime() === tpe('2026-10-16T11:30:00').getTime(), 'Picker edit wrong');
});

test('pick-a-day query lists that day', () => {
  const w = calendarWorld();
  w.cal.add('那天的會', tpe('2026-11-20T10:00:00'), tpe('2026-11-20T11:00:00'), false);
  w.post([postback(w, 'cal=list', { date: '2026-11-20' })]);
  assert(JSON.stringify(lastMessage(w).contents).includes('那天的會'), 'Picked-day list wrong');
});

test('block frame: icons only with LINE_ICON_BASE_URL, source/state row, back button', () => {
  const w = calendarWorld();
  w.post([w.text('#回報')]);
  let json = JSON.stringify(lastMessage(w).contents);
  assert(!json.includes('"type":"image"'), 'No icon images without LINE_ICON_BASE_URL');
  assert(json.includes('來源：') && json.includes('等你選擇') && json.includes('"text":"#小幫手"'), 'Frame parts missing: ' + json);
  w.properties.LINE_ICON_BASE_URL = 'https://icons.example.com/line';
  w.post([w.text('#回報')]);
  json = JSON.stringify(lastMessage(w).contents);
  assert(json.includes('https://icons.example.com/line/report.png'), 'Header icon missing: ' + json);
  assert(json.includes('"text":"要回報什麼？"'), 'Leading emoji should be dropped when an icon is shown');
  w.post([w.text('#小幫手')]);
  json = JSON.stringify(lastMessage(w).contents);
  assert(['report', 'progress', 'data', 'calendar', 'help', 'link'].every((n) => json.includes(`/line/${n}.png`)), 'Menu tile icons missing');
  assert(!json.includes('↩ 返回功能選單'), 'Main menu must not have a back button');
  w.properties.LINE_ICON_BASE_URL = 'http://insecure.example.com/';
  w.post([w.text('#說明')]);
  assert(!JSON.stringify(lastMessage(w).contents).includes('"type":"image"'), 'Non-https icon base must be ignored');
});

test('all toy builders emit nonempty boxes and valid image sizes with and without icons', () => {
  const w = calendarWorld();
  const check = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'box') assert(Array.isArray(node.contents) && node.contents.length > 0, 'Empty box: ' + JSON.stringify(node));
    if (node.type === 'image') assert(/^(xxs|xs|sm|md|lg|xl|xxl|3xl|4xl|5xl|full|\d+(\.\d+)?(px|%))$/.test(node.size), 'Invalid image size');
    Object.values(node).forEach(check);
  };
  for (const base of ['', 'https://icons.example.com/line']) {
    w.properties.LINE_ICON_BASE_URL = base;
    const c = w.context;
    [c.buildHelperMenuCard_(2, false), c.buildHelperMenuCard_(2, true), c.buildReportMenuCard_(),
      c.buildUpdateMenuCard_(), c.buildHelpCard_(), c.buildQuickLinksCard_([]), c.buildTodoListCard_([]),
      c.buildOpenItemsCard_([], new Date()), c.buildDataUpdateCard_('U001', {}),
      c.buildCalendarMenuCard_(), c.buildCalendarListCard_([], {}, '今天')].forEach(check);
    w.post([w.text('#新增行程 10/15 14:30 會議')]);
    check(lastMessage(w));
    w.post([w.text('#刪行程 C001')]);
    check(lastMessage(w));
    w.post([postback(w, 'cal=add&mode=range1', { date: '2026-10-15' })]);
    check(lastMessage(w));
  }
});

test('pickers have correctly formatted ordered bounds including the final selectable day', () => {
  const w = calendarWorld();
  w.post([w.text('#行事曆')]);
  const menu = findActions(lastMessage(w)).filter(a => a.type === 'datetimepicker');
  const finalDay = menu.find(a => a.data === 'cal=add&mode=range1').max;
  w.post([postback(w, 'cal=add&mode=range1', { date: finalDay })]);
  const range = findActions(lastMessage(w)).filter(a => a.type === 'datetimepicker');
  for (const a of [...menu, ...range]) {
    const pattern = a.mode === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
    for (const key of ['initial', 'min', 'max']) if (a[key]) assert(pattern.test(a[key]), key + ' has wrong format');
    assert(!a.min || !a.max || a.min < a.max, 'LINE requires min < max');
    assert((!a.min || a.initial >= a.min) && (!a.max || a.initial <= a.max), 'initial out of bounds');
  }
  const end = range.find(a => a.data.includes('range2'));
  w.post([postback(w, end.data, { date: '2026-10-15' })]);
  assert(w.lastReply().includes('結束日要'), 'Server must enforce omitted minimum');
  w.post([postback(w, end.data, { date: finalDay })]);
  w.post([w.text('最後一天')]);
  assert(w.cal.events.length === 1, 'Last allowed day should still work');
});

test('done datetime picker starts at the actual event time', () => {
  const w = calendarWorld();
  w.post([w.text('#新增行程 10/15 14:30 會議')]);
  assert(findActions(lastMessage(w)).find(a => a.data === 'cal=edit&id=C001').initial === '2026-10-15T14:30', 'Edit must not reset to 09:00');
});

test('picker parsing rejects invalid clocks, dates, conflicting params and mode mismatches', () => {
  for (const params of [{ datetime: '2026-10-15T24:00' }, { datetime: '2026-10-15T12:60' },
    { datetime: '2026-02-30T12:00' }, { datetime: '2026-10-15' }, { date: '2026-10-15T12:00' },
    { datetime: '2026-10-15T12:00', date: '2026-10-15' }, { date: '2026-10-15' }]) {
    const w = calendarWorld();
    w.post([postback(w, 'cal=add&mode=timed', params)]);
    w.post([w.text('不得新增')]);
    assert(w.cal.events.length === 0 && w.lastReply().includes('沒有收到日期'), 'Invalid params accepted: ' + JSON.stringify(params));
  }
  const w = calendarWorld();
  w.post([postback(w, 'cal=add&mode=allday', { datetime: '2026-10-15T12:00' })]);
  w.post([w.text('不得新增')]);
  assert(w.cal.events.length === 0, 'All-day picker must reject datetime params');
  assert(w.context.parsePickerValue_({ datetime: '2026-10-15t23:59' }).minutes === 1439, 'Lowercase t is valid');
});

test('malformed percent escapes and duplicate postback keys are ignored without generic errors', () => {
  const w = calendarWorld();
  for (const data of ['cal=add&mode=%ZZ', 'cal=add&cal=edit&mode=allday', 'cal=%E0%A4', '__proto__=x', 'cal=unknown', 'cal=add&mode=unknown']) {
    w.post([postback(w, data, { date: '2026-10-15' })]);
  }
  assert(w.calls.replies.length === 0 && w.cal.events.length === 0, 'Malformed payload should do nothing');
  assert(w.context.parsePostbackData_('cal=%61dd&mode=allday').cal === 'add', 'Valid URI encoding should parse');
});

test('invalid names retain the selected date for retry; success and duplicates clear it', () => {
  const w = calendarWorld();
  w.post([postback(w, 'cal=add&mode=allday', { date: '2026-10-15' })]);
  for (const title of ['長'.repeat(101), ' ', '<>']) {
    w.post([w.text(title)]);
    assert(w.cal.events.length === 0 && w.lastReply().includes('名稱'), 'Invalid title must be rejected');
  }
  w.post([w.text('重試成功')]);
  assert(w.cal.events.length === 1 && w.cal.events[0].title === '重試成功', 'Pending date lost on validation failure');
  w.post([postback(w, 'cal=add&mode=allday', { date: '2026-10-15' })]);
  w.post([w.text('重試成功')]);
  assert(w.lastReply().includes('沒有重複新增'), 'Duplicate check missing');
  w.post([w.text('一般聊天')]);
  assert(w.cal.events.length === 1, 'Duplicate completion must clear pending');
});

test('calendar setup and transient create failures allow a name retry', () => {
  const w = calendarWorld({ configured: false });
  w.post([postback(w, 'cal=add&mode=allday', { date: '2026-10-15' })]);
  w.post([w.text('會議')]);
  assert(w.cal.events.length === 0, 'Unconfigured calendar must not create');
  w.properties.LINE_CALENDAR_ID = 'work-cal';
  const create = w.cal.calendar.createAllDayEvent;
  w.cal.calendar.createAllDayEvent = () => { throw new Error('Synthetic failure'); };
  w.post([w.text('會議')]);
  assert(w.lastReply().includes('暫時無法'), 'Failure should be visible');
  w.cal.calendar.createAllDayEvent = create;
  w.post([w.text('會議')]);
  assert(w.cal.events.length === 1, 'Retry lost pending state');
});

test('unknown hash commands never become event names', () => {
  const w = calendarWorld();
  w.post([postback(w, 'cal=add&mode=allday', { date: '2026-10-15' })]);
  w.post([w.text('#未知指令'), w.text('＃未知指令')]);
  assert(w.cal.events.length === 0, 'Unknown commands became titles');
  w.post([w.text('真正名稱')]);
  assert(w.cal.events.length === 1, 'Unknown command should preserve pending');
});

test('cancel and navigation leave no calendar name capture behind', () => {
  for (const command of ['#取消', '＃取消', '#小幫手', '#行事曆', '#回報', '#更新']) {
    const w = calendarWorld();
    w.post([postback(w, 'cal=add&mode=allday', { date: '2026-10-15' })]);
    w.post([w.text(command), w.text('一般聊天')]);
    assert(w.cal.events.length === 0, command + ' must cancel calendar pending');
  }
});

test('range start replaces previous name capture and end belongs to same user and start', () => {
  const w = calendarWorld();
  w.post([postback(w, 'cal=add&mode=allday', { date: '2026-10-10' })]);
  w.post([postback(w, 'cal=add&mode=range1', { date: '2026-10-15' })]);
  const oldEnd = findActions(lastMessage(w)).find(a => a.data && a.data.includes('range2')).data;
  w.post([w.text('尚未選結束日')]);
  assert(w.cal.events.length === 0, 'Old name capture survived range start');
  w.post([postback(w, oldEnd, { date: '2026-10-17' }, 'Ubob'), w.text('不得新增', 'Ubob')]);
  assert(w.cal.events.length === 0, 'Another user consumed range');
  w.post([postback(w, 'cal=add&mode=range1', { date: '2026-10-16' })]);
  const end = findActions(lastMessage(w)).find(a => a.data && a.data.includes('range2')).data;
  w.post([postback(w, oldEnd, { date: '2026-10-17' }), w.text('不得新增')]);
  assert(w.cal.events.length === 0, 'Old start accepted');
  w.post([postback(w, end, { date: '2026-10-17' }), w.text('正確跨天')]);
  assert(w.cal.events.length === 1 && w.cal.events[0].start.getTime() === tpe('2026-10-16T00:00:00').getTime(), 'Valid range failed');
  w.post([postback(w, end, { date: '2026-10-17' }), w.text('不可重用')]);
  assert(w.cal.events.length === 1, 'Completed range can be reused');
});

test('range start data must be an integer and an active nonexpired selection', () => {
  const w = calendarWorld();
  w.post([postback(w, 'cal=add&mode=range1', { date: '2026-10-15' })]);
  const end = findActions(lastMessage(w)).find(a => a.data && a.data.includes('range2')).data;
  for (const data of [end.replace(/start=(\d+)/, 'start=$1.5'), end.replace(/start=\d+/, 'start='), end.replace(/start=\d+/, 'start=NaN')]) {
    w.post([postback(w, data, { date: '2026-10-17' }), w.text('不得新增')]);
  }
  assert(w.cal.events.length === 0, 'Invalid start accepted');
  w.clearCache();
  w.post([postback(w, end, { date: '2026-10-17' }), w.text('過期')]);
  assert(w.cal.events.length === 0, 'Expired range accepted');
});

test('pending picker names stay within user/group and expire after ten minutes', () => {
  const w = calendarWorld();
  w.post([postback(w, 'cal=add&mode=allday', { date: '2026-10-15' })]);
  assert(w.ttls['LINE_PENDING_' + GROUP + '_Ualice'] === 600, 'Pending TTL must be ten minutes');
  w.post([w.text('別人的聊天', 'Ubob')]);
  const other = w.text('別群聊天'); other.source.groupId = OTHER_GROUP;
  w.properties.LINE_GROUP_IDS = GROUP + ',' + OTHER_GROUP;
  w.post([other]);
  assert(w.cal.events.length === 0, 'Pending leaked across users or groups');
  w.clearCache();
  w.post([w.text('已過期')]);
  assert(w.cal.events.length === 0, 'Expired pending accepted');
});

test('anonymous and unapproved group postbacks cannot start a shared name capture', () => {
  const w = calendarWorld();
  const anonymous = postback(w, 'cal=add&mode=allday', { date: '2026-10-15' });
  delete anonymous.source.userId;
  w.post([anonymous]);
  assert(w.lastReply().includes('無法識別'), 'Anonymous picker should explain text alternative');
  const title = w.text('匿名聊天'); delete title.source.userId;
  w.post([title]);
  const blocked = postback(w, 'cal=add&mode=allday', { date: '2026-10-15' }); blocked.source.groupId = OTHER_GROUP;
  const count = w.calls.replies.length;
  w.post([blocked]);
  assert(w.cal.events.length === 0 && w.calls.replies.length === count, 'Group allowlist bypassed');
});

test('name capture rechecks the rolling calendar window after midnight', () => {
  const w = calendarWorld();
  w.post([w.text('#行事曆')]);
  const min = findActions(lastMessage(w)).find(a => a.data === 'cal=add&mode=allday').min;
  w.post([postback(w, 'cal=add&mode=allday', { date: min })]);
  w.context.calendarNow_ = () => tpe('2026-10-03T00:01:00');
  w.post([w.text('過界行程')]);
  assert(w.cal.events.length === 0 && w.lastReply().includes('超出'), 'Window must be checked at insertion');
});

test('restarting the same range date invalidates the old card token', () => {
  const w = calendarWorld();
  let seq = 0; w.context.Utilities.getUuid = () => 'range-' + ++seq;
  w.post([postback(w, 'cal=add&mode=range1', { date: '2026-10-15' })]);
  const oldEnd = findActions(lastMessage(w)).find(a => a.data && a.data.includes('range2')).data;
  w.post([postback(w, 'cal=add&mode=range1', { date: '2026-10-15' })]);
  const newEnd = findActions(lastMessage(w)).find(a => a.data && a.data.includes('range2')).data;
  w.post([postback(w, oldEnd, { date: '2026-10-17' }), w.text('舊卡不得新增')]);
  assert(w.cal.events.length === 0, 'Old token reused');
  w.post([postback(w, newEnd, { date: '2026-11-15' })]);
  assert(w.lastReply().includes('最多 31 天'), 'Range over 31 days accepted');
  w.post([postback(w, newEnd, { date: '2026-11-14' }), w.text('完整 31 天')]);
  assert(w.cal.events.length === 1 && (w.cal.events[0].end - w.cal.events[0].start) / 86400000 === 31, 'Inclusive 31-day limit failed');
});

test('text add replaces pending picker instead of leaving a second draft', () => {
  const w = calendarWorld();
  w.post([postback(w, 'cal=add&mode=allday', { date: '2026-10-15' })]);
  w.post([w.text('#新增行程 10/16 文字新增'), w.text('一般聊天')]);
  assert(w.cal.events.length === 1 && w.cal.events[0].title === '文字新增', 'Text add left stale pending');
});

test('cards show the configured calendar name and every button label fits LINE (max 20 chars)', () => {
  const w = calendarWorld();
  w.properties.LINE_CALENDAR_NAME = 'Work';
  w.post([w.text('#行事曆')]);
  const menu = lastMessage(w);
  let json = JSON.stringify(menu.contents);
  assert(json.includes('Google「Work」行事曆') && !json.includes('「工作」行事曆'), 'Menu should show Work: ' + json);
  const labels = findActions(menu.contents).map((a) => a.label).filter(Boolean);
  assert(labels.every((l) => [...l].length <= 20), 'Label too long: ' + labels);
  assert(labels.includes('指定時間') && labels.some((l) => l.startsWith('跨天')), 'Add buttons missing: ' + labels);
  w.post([w.text('#新增行程 10/15 會議')]);
  assert(JSON.stringify(lastMessage(w).contents).includes('已寫入 Google「Work」行事曆'), 'Done card should show Work');
  w.post([w.text('#刪行程 C001')]);
  assert(JSON.stringify(lastMessage(w).contents).includes('「Work」行事曆'), 'Delete card should show Work');
  delete w.properties.LINE_CALENDAR_NAME;
  w.post([w.text('#行程 10/15')]);
  json = JSON.stringify(lastMessage(w).contents);
  assert(json.includes('Google「工作」行事曆'), 'Default name should stay 工作');
});

let passed = 0;
for (const item of tests) {
  try {
    item.callback();
    passed += 1;
    console.log(`PASS ${item.name}`);
  } catch (error) {
    console.error(`FAIL ${item.name}: ${error.message}`);
  }
}
console.log(`${passed} PASS / ${tests.length - passed} FAIL`);
if (passed !== tests.length) process.exitCode = 1;
