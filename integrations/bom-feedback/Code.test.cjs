const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
const context = {
  console,
  Utilities: {
    base64Decode(value) { return Array.from(Buffer.from(value, 'base64')); },
    formatDate() { return '20260820'; },
    computeDigest() { return [1, 2, 3]; },
    Charset: { UTF_8: 'UTF-8' },
    DigestAlgorithm: { SHA_256: 'SHA-256' }
  }
};
vm.createContext(context);
vm.runInContext(`${source}\nthis.testApi={validateFeedbackImages_,matchesImageSignature_,sheetText_};`, context, { filename: 'Code.gs' });

const api = context.testApi;
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const tests = [];

function test(name, callback) { tests.push({ name, callback }); }
function assert(condition, message) { if (!condition) throw new Error(message || 'Assertion failed'); }
function assertThrows(callback, pattern) {
  let error;
  try { callback(); } catch (caught) { error = caught; }
  assert(error, 'Expected function to throw');
  assert(pattern.test(String(error.message || error)), `Unexpected error: ${error.message || error}`);
}

test('accepts a valid PNG image', () => {
  const images = api.validateFeedbackImages_([{ mimeType: 'image/png', dataBase64: pngBase64 }]);
  assert(images.length === 1, 'Image count mismatch');
  assert(images[0].name === 'feedback-image-1.png', 'Safe name not generated');
});

test('rejects a MIME and signature mismatch', () => {
  assertThrows(() => api.validateFeedbackImages_([{ mimeType: 'image/jpeg', dataBase64: pngBase64 }]), /does not match/);
});

test('rejects more than three images', () => {
  const image = { mimeType: 'image/png', dataBase64: pngBase64 };
  assertThrows(() => api.validateFeedbackImages_([image, image, image, image]), /Too many/);
});

test('rejects unsupported image formats', () => {
  assertThrows(() => api.validateFeedbackImages_([{ mimeType: 'image/svg+xml', dataBase64: pngBase64 }]), /Unsupported/);
});

test('rejects an oversized single image before decoding', () => {
  const oversizedBase64 = 'A'.repeat(Math.ceil(2 * 1024 * 1024 * 4 / 3) + 20);
  assertThrows(() => api.validateFeedbackImages_([{ mimeType: 'image/png', dataBase64: oversizedBase64 }]), /size limit/);
});

test('rejects images whose combined decoded size exceeds five MB', () => {
  const largePng = Buffer.alloc(1800 * 1024);
  Buffer.from([0x89, 0x50, 0x4E, 0x47]).copy(largePng);
  const image = { mimeType: 'image/png', dataBase64: largePng.toString('base64') };
  assertThrows(() => api.validateFeedbackImages_([image, image, image]), /Total image size/);
});

test('protects Sheet cells from formula injection', () => {
  assert(api.sheetText_('=IMPORTXML("x")').startsWith("'="), 'Formula prefix was not escaped');
  assert(api.sheetText_('一般文字') === '一般文字', 'Normal text changed');
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
