/**
 * BOM Feedback & Delivery Acknowledgements — Apps Script source
 *
 * Required Script Properties:
 *   SPREADSHEET_ID     Google Sheet ID
 *   NOTIFY_EMAIL       Maintainer email receiving feedback/ack notifications
 *   FEEDBACK_IMAGE_FOLDER_ID Private Google Drive folder for feedback images
 *   ALLOWED_RECIPIENTS Comma-separated release-notification recipients
 *   MODULE_URL         Public BOM module URL
 *
 * Deploy as a Web app only after the owner reviews permissions.
 * Do not send BOM files, PN, customer names, company names, or filenames.
 */

const FEEDBACK_SHEET = 'BOM Feedback';
const ACK_SHEET = 'Delivery Acknowledgements';
const MODULE_VERSION = 'v2.14.4';
const FEEDBACK_MAX_IMAGES = 3;
const FEEDBACK_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const FEEDBACK_MAX_TOTAL_IMAGE_BYTES = 5 * 1024 * 1024;
const FEEDBACK_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const FEEDBACK_CATEGORIES = [
  '格式辨識', '轉檔結果', 'NEW／OLD 判定', '簡轉繁／品名',
  'Item Level', '異常報告', '操作建議', '其他'
];

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    if (payload.action !== 'feedback') throw new Error('Unsupported action');
    if (['bom-feedback-v1', 'bom-feedback-v2'].indexOf(payload.schema) < 0) throw new Error('Unsupported schema');
    if (String(payload.consent) !== 'true') throw new Error('Consent is required');
    if (String(payload.website || '').trim()) throw new Error('Automated submission rejected');

    const category = safeText_(payload.category, 40, true);
    if (FEEDBACK_CATEGORIES.indexOf(category) < 0) throw new Error('Unsupported category');
    const location = safeText_(payload.location, 120, false);
    const description = safeText_(payload.description, 1000, true);
    const version = safeText_(payload.moduleVersion || MODULE_VERSION, 20, true);
    const images = validateFeedbackImages_(payload.images || []);
    const feedbackId = `FB-${Utilities.getUuid()}`;
    const now = new Date();
    let imageFiles = [];

    withLock_(function () {
      const imageBytes = images.reduce(function (total, image) { return total + image.bytes.length; }, 0);
      const guard = checkFeedbackGuard_(category, location, description, imageBytes, now);
      try {
        imageFiles = saveFeedbackImages_(feedbackId, images);
        const sheet = getSheet_(FEEDBACK_SHEET);
        ensureFeedbackImageHeaders_(sheet);
        sheet.appendRow([
          feedbackId, now, sheetText_(version), sheetText_(category), sheetText_(location), sheetText_(description),
          '新回饋', '', '', '', 'Web', imageFiles.map(function (item) { return item.url; }).join('\n'), imageFiles.length
        ]);
        commitFeedbackGuard_(guard);
      } catch (storageError) {
        imageFiles.forEach(function (item) { try { item.file.setTrashed(true); } catch (cleanupError) { console.error(cleanupError); } });
        throw storageError;
      }
    });

    const notifyEmail = requiredProperty_('NOTIFY_EMAIL');
    try {
      MailApp.sendEmail({
        to: notifyEmail,
        subject: `[BOM 回饋] ${category}｜${feedbackId}`,
        htmlBody: feedbackEmailHtml_(feedbackId, now, version, category, location, description, imageFiles),
        name: 'BOM 轉檔與安檢'
      });
      return json_({ ok: true, saved: true, emailed: true, feedbackId: feedbackId, imageCount: imageFiles.length });
    } catch (mailError) {
      console.error(mailError);
      return json_({ ok: false, saved: true, emailed: false, feedbackId: feedbackId, imageCount: imageFiles.length, error: 'Email notification failed' });
    }
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: String(error.message || error) });
  }
}

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';
  if (action !== 'ack') return html_('無法處理', '此連結不是有效的收件確認連結。', false);

  try {
    const token = safeText_(e.parameter.token, 200, true);
    const tokenHash = sha256_(token);
    const result = acknowledge_(tokenHash);
    if (result.alreadyAcknowledged) {
      return html_('已完成確認', '這封通知先前已確認收到，不需要再次操作。', true);
    }

    MailApp.sendEmail({
      to: requiredProperty_('NOTIFY_EMAIL'),
      subject: `[BOM 更新] ${result.recipient} 已確認收到 ${result.version}`,
      body: `${result.recipient} 已於 ${formatDate_(result.acknowledgedAt)} 確認收到 ${result.version} 更新通知。`,
      name: 'BOM 轉檔與安檢'
    });
    return html_('確認成功', '已記錄「我已收到」，並通知維護人員。', true);
  } catch (error) {
    console.error(error);
    return html_('確認失敗', '連結無效、已失效，或系統暫時無法處理。', false);
  }
}

/**
 * Call this from an approved release workflow or manually in Apps Script.
 * Recipients must be listed in Script Property ALLOWED_RECIPIENTS.
 */
function sendReleaseNotification(recipient, version, notificationType) {
  recipient = safeText_(recipient, 160, true).toLowerCase();
  version = safeText_(version, 30, true);
  notificationType = safeText_(notificationType || '版本更新', 40, true);
  assertAllowedRecipient_(recipient);

  const rawToken = `${Utilities.getUuid()}${Utilities.getUuid()}`.replace(/-/g, '');
  const tokenHash = sha256_(rawToken);
  const ackId = `ACK-${Utilities.getUuid()}`;
  const sentAt = new Date();
  const webAppUrl = ScriptApp.getService().getUrl();
  if (!webAppUrl) throw new Error('Web app is not deployed');
  const ackUrl = `${webAppUrl}?action=ack&token=${encodeURIComponent(rawToken)}`;
  const moduleUrl = requiredProperty_('MODULE_URL');

  withLock_(function () {
    getSheet_(ACK_SHEET).appendRow([
      ackId, version, notificationType, recipient, sentAt, '',
      '待確認', tokenHash, 'Email', ''
    ]);
  });

  MailApp.sendEmail({
    to: recipient,
    subject: `[BOM 轉檔與安檢] ${version} 更新通知`,
    htmlBody: releaseEmailHtml_(version, notificationType, moduleUrl, ackUrl),
    name: 'BOM 轉檔與安檢'
  });
  return { ackId: ackId, recipient: recipient, sentAt: sentAt };
}

function acknowledge_(tokenHash) {
  return withLock_(function () {
    const sheet = getSheet_(ACK_SHEET);
    const lastRow = sheet.getLastRow();
    if (lastRow < 5) throw new Error('Acknowledgement not found');
    const rows = sheet.getRange(5, 1, lastRow - 4, 10).getValues();
    for (let i = 0; i < rows.length; i += 1) {
      if (String(rows[i][7]) !== tokenHash) continue;
      const rowNumber = i + 5;
      if (String(rows[i][6]) === '已確認') {
        return { alreadyAcknowledged: true, recipient: rows[i][3], version: rows[i][1] };
      }
      if (String(rows[i][6]) === '已失效') throw new Error('Token expired');
      const now = new Date();
      sheet.getRange(rowNumber, 6).setValue(now);
      sheet.getRange(rowNumber, 7).setValue('已確認');
      return { alreadyAcknowledged: false, recipient: rows[i][3], version: rows[i][1], acknowledgedAt: now };
    }
    throw new Error('Token not found');
  });
}

/**
 * Run this once from the Apps Script editor after enabling image feedback.
 * Google will request the Drive permission needed to store feedback images.
 */
function authorizeFeedbackImageStorage() {
  const folder = DriveApp.getFolderById(requiredProperty_('FEEDBACK_IMAGE_FOLDER_ID'));
  const probe = folder.createFile('bom-feedback-authorization-check.txt', 'Authorization check only', MimeType.PLAIN_TEXT);
  probe.setTrashed(true);
  return `Image feedback storage ready: ${folder.getName()}`;
}

function parsePayload_(e) {
  if (!e) return {};
  const contentType = String(e.postData && e.postData.type || '');
  if (contentType.indexOf('application/json') === 0 || contentType.indexOf('text/plain') === 0) {
    return JSON.parse(e.postData.contents || '{}');
  }
  return e.parameter || {};
}

function safeText_(value, maxLength, required) {
  const text = String(value == null ? '' : value).trim();
  if (required && !text) throw new Error('Required field is missing');
  if (text.length > maxLength) throw new Error(`Field exceeds ${maxLength} characters`);
  return text.replace(/[<>]/g, '');
}

function sheetText_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function validateFeedbackImages_(rawImages) {
  if (!Array.isArray(rawImages)) throw new Error('Images must be an array');
  if (rawImages.length > FEEDBACK_MAX_IMAGES) throw new Error('Too many images');
  let totalBytes = 0;
  return rawImages.map(function (rawImage, index) {
    const mimeType = safeText_(rawImage && rawImage.mimeType, 40, true).toLowerCase();
    if (FEEDBACK_IMAGE_TYPES.indexOf(mimeType) < 0) throw new Error('Unsupported image type');
    const dataBase64 = String(rawImage && rawImage.dataBase64 || '').replace(/\s/g, '');
    if (!dataBase64 || dataBase64.length > Math.ceil(FEEDBACK_MAX_IMAGE_BYTES * 4 / 3) + 8) throw new Error('Image exceeds size limit');
    let bytes;
    try { bytes = Utilities.base64Decode(dataBase64); } catch (decodeError) { throw new Error('Invalid image encoding'); }
    if (!bytes.length || bytes.length > FEEDBACK_MAX_IMAGE_BYTES) throw new Error('Image exceeds size limit');
    if (!matchesImageSignature_(bytes, mimeType)) throw new Error('Image content does not match type');
    totalBytes += bytes.length;
    if (totalBytes > FEEDBACK_MAX_TOTAL_IMAGE_BYTES) throw new Error('Total image size exceeds limit');
    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    return { mimeType: mimeType, bytes: bytes, name: `feedback-image-${index + 1}.${extension}` };
  });
}

function matchesImageSignature_(bytes, mimeType) {
  const byte = function (index) { return ((bytes[index] || 0) + 256) % 256; };
  if (mimeType === 'image/png') return byte(0) === 0x89 && byte(1) === 0x50 && byte(2) === 0x4E && byte(3) === 0x47;
  if (mimeType === 'image/jpeg') return byte(0) === 0xFF && byte(1) === 0xD8 && byte(2) === 0xFF;
  if (mimeType === 'image/webp') return [0x52, 0x49, 0x46, 0x46].every(function (value, index) { return byte(index) === value; }) && [0x57, 0x45, 0x42, 0x50].every(function (value, index) { return byte(index + 8) === value; });
  return false;
}

function saveFeedbackImages_(feedbackId, images) {
  if (!images.length) return [];
  const folder = DriveApp.getFolderById(requiredProperty_('FEEDBACK_IMAGE_FOLDER_ID'));
  return images.map(function (image) {
    const file = folder.createFile(Utilities.newBlob(image.bytes, image.mimeType, `${feedbackId}_${image.name}`));
    file.setDescription(`BOM feedback image for ${feedbackId}`);
    return { file: file, url: file.getUrl() };
  });
}

function ensureFeedbackImageHeaders_(sheet) {
  const headerRow = 4;
  if (!sheet.getRange(headerRow, 12).getValue()) sheet.getRange(headerRow, 12, 1, 2).setValues([['圖片連結', '圖片數量']]);
}

function checkFeedbackGuard_(category, location, description, imageBytes, now) {
  const properties = PropertiesService.getScriptProperties();
  const dayKey = `FEEDBACK_COUNT_${Utilities.formatDate(now, 'Asia/Taipei', 'yyyyMMdd')}`;
  const imageDayKey = `FEEDBACK_IMAGE_BYTES_${Utilities.formatDate(now, 'Asia/Taipei', 'yyyyMMdd')}`;
  const count = Number(properties.getProperty(dayKey) || 0);
  const configuredLimit = Number(properties.getProperty('FEEDBACK_DAILY_LIMIT') || 30);
  const dailyLimit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 30;
  if (count >= dailyLimit) throw new Error('Daily feedback limit reached');
  const imageByteCount = Number(properties.getProperty(imageDayKey) || 0);
  const configuredImageMb = Number(properties.getProperty('FEEDBACK_DAILY_IMAGE_MB') || 30);
  const dailyImageBytes = (Number.isFinite(configuredImageMb) && configuredImageMb > 0 ? configuredImageMb : 30) * 1024 * 1024;
  if (imageByteCount + imageBytes > dailyImageBytes) throw new Error('Daily image limit reached');
  const fingerprint = sha256_([category, location, description].join('|'));
  const cacheKey = `FB_DUP_${fingerprint}`;
  if (CacheService.getScriptCache().get(cacheKey)) throw new Error('Duplicate feedback');
  return { properties: properties, dayKey: dayKey, count: count, imageDayKey: imageDayKey, imageByteCount: imageByteCount, imageBytes: imageBytes, cacheKey: cacheKey };
}

function commitFeedbackGuard_(guard) {
  guard.properties.setProperty(guard.dayKey, String(guard.count + 1));
  guard.properties.setProperty(guard.imageDayKey, String(guard.imageByteCount + guard.imageBytes));
  CacheService.getScriptCache().put(guard.cacheKey, '1', 300);
}

function getSheet_(name) {
  const spreadsheet = SpreadsheetApp.openById(requiredProperty_('SPREADSHEET_ID'));
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error(`Missing sheet: ${name}`);
  return sheet;
}

function requiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(`Missing Script Property: ${name}`);
  return value;
}

function assertAllowedRecipient_(recipient) {
  const allowed = requiredProperty_('ALLOWED_RECIPIENTS')
    .split(',').map(function (value) { return value.trim().toLowerCase(); }).filter(Boolean);
  if (allowed.indexOf(recipient) < 0) throw new Error('Recipient is not allowed');
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return callback(); } finally { lock.releaseLock(); }
}

function sha256_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (byte) { return (`0${((byte + 256) % 256).toString(16)}`).slice(-2); }).join('');
}

function formatDate_(date) {
  return Utilities.formatDate(date, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function html_(title, message, success) {
  const color = success ? '#19764b' : '#b42318';
  const escapedTitle = escapeHtml_(title);
  const escapedMessage = escapeHtml_(message);
  return HtmlService.createHtmlOutput(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedTitle}</title><body style="font-family:Arial,'Microsoft JhengHei',sans-serif;background:#f3f6fa;padding:32px"><main style="max-width:560px;margin:auto;background:#fff;border:1px solid #d8e0e8;border-radius:12px;padding:28px"><h1 style="color:${color};font-size:24px">${escapedTitle}</h1><p>${escapedMessage}</p></main></body></html>`);
}

function feedbackEmailHtml_(id, now, version, category, location, description, imageFiles) {
  const imageHtml = imageFiles.length ? `<p><b>圖片：</b>${imageFiles.map(function (item, index) { return `<a href="${escapeHtml_(item.url)}">查看圖片 ${index + 1}</a>`; }).join('｜')}</p>` : '<p><b>圖片：</b>無</p>';
  return `<p><b>回饋編號：</b>${escapeHtml_(id)}</p><p><b>時間：</b>${escapeHtml_(formatDate_(now))}</p><p><b>版本：</b>${escapeHtml_(version)}</p><p><b>類型：</b>${escapeHtml_(category)}</p><p><b>位置：</b>${escapeHtml_(location || '未填')}</p><p><b>問題：</b>${escapeHtml_(description)}</p>${imageHtml}`;
}

function releaseEmailHtml_(version, type, moduleUrl, ackUrl) {
  return `<p>BOM 轉檔與安檢已完成 ${escapeHtml_(version)} 更新（${escapeHtml_(type)}）。</p><p><a href="${escapeHtml_(moduleUrl)}">開啟系統</a></p><p><a href="${escapeHtml_(ackUrl)}" style="display:inline-block;background:#19764b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px">✅ 我已收到</a></p><p style="color:#667085;font-size:12px">按鈕僅記錄收件確認，不使用開信追蹤。</p>`;
}

function escapeHtml_(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
