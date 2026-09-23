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
  const rows = {};
  const calls = { replies: [], pushes: [], mails: [], files: [] };
  let pulls = [];
  let lastRow = 4;

  const cell = (r, c) => (rows[r] || [])[c - 1] ?? '';
  const setCell = (r, c, v) => { rows[r] = rows[r] || []; rows[r][c - 1] = v; if (r > lastRow) lastRow = r; };
  const sheet = {
    getLastRow: () => lastRow,
    appendRow(values) { lastRow += 1; rows[lastRow] = values.slice(); },
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValue: () => cell(r, c),
        setValue: (v) => setCell(r, c, v),
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
        setValues: (values) => values.forEach((line, i) => line.forEach((v, j) => setCell(r + i, c + j, v)))
      };
    }
  };

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
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: (name) => (name === 'BOM Feedback' ? sheet : null) }) },
    DriveApp: { getFolderById: () => ({ createFile(blob) { calls.files.push(blob.name); return { setDescription() {}, getUrl: () => `https://drive/${blob.name}`, setTrashed() {} }; } }) },
    MailApp: { sendEmail: (m) => calls.mails.push(m) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
    UrlFetchApp: {
      fetch(url, options = {}) {
        if (url.includes('/message/reply')) { calls.replies.push(JSON.parse(options.payload)); return response(200, '{}'); }
        if (url.includes('/message/push')) { calls.pushes.push(JSON.parse(options.payload)); return response(200, '{}'); }
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
  const lastReply = () => (calls.replies.at(-1) || { messages: [{ text: '' }] }).messages[0].text;
  const row = (n) => rows[n] || [];

  return { api: context.api, post, text, image, calls, rows, row, properties, lastReply, setPulls: (p) => { pulls = p; }, setCell, clearCache: () => Object.keys(cache).forEach((k) => delete cache[k]) };
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
