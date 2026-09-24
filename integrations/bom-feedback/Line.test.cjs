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
    LINE_CHANNEL_ACCESS_TOKEN: 'token', LINE_WEBHOOK_KEY: KEY, LINE_GROUP_IDS: GROUP
  };
  const cache = {};
  const ttls = {};
  const calls = { replies: [], pushes: [], mails: [], files: [] };
  let pulls = [];

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
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v, ttl) => { cache[k] = v; ttls[k] = ttl; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: (name) => sheets[name] || null, insertSheet: (name) => (sheets[name] = makeSheet(0)) }) },
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
        if (url.includes('api.github.com')) return response(200, pulls);
        throw new Error(`Unexpected fetch ${url}`);
      }
    }
  };
  vm.createContext(context);
  const code = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
  const line = fs.readFileSync(path.join(__dirname, 'Line.gs'), 'utf8');
  vm.runInContext(`${code}\n${line}\nthis.api={doPost,processLineOutbox,detectLineTool_,extractLineReply_};`, context, { filename: 'Line.gs' });

  let tokenSeq = 0;
  const post = (events, key = KEY) => context.api.doPost({
    parameter: { k: key },
    postData: { type: 'application/json', contents: JSON.stringify({ destination: 'bot', events }) }
  });
  const text = (value, user = 'Ualice', group = GROUP) => ({ type: 'message', replyToken: `r${++tokenSeq}`, source: { type: 'group', groupId: group, userId: user }, message: { type: 'text', id: `m${tokenSeq}`, text: value } });
  const image = (user = 'Ualice', group = GROUP) => ({ type: 'message', replyToken: `r${++tokenSeq}`, source: { type: 'group', groupId: group, userId: user }, message: { type: 'image', id: `img${tokenSeq}` } });
  const file = (fileName, { user = 'Ualice', kind = 'file', size = 2048 } = {}) => ({ type: 'message', replyToken: `r${++tokenSeq}`, source: { type: 'group', groupId: GROUP, userId: user }, message: { type: 'file', id: `${kind}${tokenSeq}`, fileName, fileSize: size } });
  const lastReply = () => (calls.replies.at(-1) || { messages: [{ text: '' }] }).messages[0].text;
  const row = (n) => rows[n] || [];
  const dataRow = (n) => (sheets['Data Requests'] ? sheets['Data Requests'].data[n] || [] : []);

  return { ttls, api: context.api, post, text, image, file, calls, rows, row, dataRow, sheets, properties, lastReply, setPulls: (p) => { pulls = p; }, setCell, clearCache: () => Object.keys(cache).forEach((k) => delete cache[k]) };
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
  assert(!w.row(5).length && w.lastReply().includes('後面寫問題'), 'Empty report should show guidance');
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

test('line-reply extraction and tool ordering', () => {
  const w = createWorld();
  assert(w.api.extractLineReply_('a<!-- line-reply --> 已修好 <!-- /line-reply -->b') === '已修好', 'Extraction failed');
  assert(w.api.detectLineTool_('PIM 合併 BOM 少一列') === 'PIM 合併', 'PIM must win over BOM');
  assert(w.api.detectLineTool_('今天天氣很好') === '', 'Unrelated text must not match');
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
