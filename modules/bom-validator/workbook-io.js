(function (global) {
  'use strict';
  const HISTORY_TEMP = '__BOM_HISTORY_REFERENCE__';
  function replaceSheetName(xml, from, to) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return xml.replace(new RegExp(`(<sheet\\b[^>]*\\bname=")${escaped}("[^>]*>)`, 'g'), `$1${to}$2`);
  }
  async function loadWorkbook(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer); const entry = zip.file('xl/workbook.xml'); let hadHistory = false; let definedNamesXml = '';
    if (entry) {
      let xml = await entry.async('string');
      const definedNamesMatch = xml.match(/<definedNames\b[\s\S]*?<\/definedNames>/);
      definedNamesXml = definedNamesMatch ? definedNamesMatch[0] : '';
      // ExcelJS 4.4 會被部分舊 BOM 的 Defined Names / Print Area 組合卡住。
      // 先從解析副本抽離，輸出時再將原始 XML 原樣放回，避免資料或設定遺失。
      if (definedNamesXml) xml = xml.replace(definedNamesXml, '');
      hadHistory = /<sheet\b[^>]*\bname="History"/.test(xml);
      if (hadHistory) xml = replaceSheetName(xml, 'History', HISTORY_TEMP);
      if (hadHistory || definedNamesXml) zip.file('xl/workbook.xml', xml);
    }
    const safeBuffer = (hadHistory || definedNamesXml) ? await zip.generateAsync({ type: 'arraybuffer' }) : arrayBuffer;
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(safeBuffer);
    workbook._bomDefinedNamesXml = definedNamesXml;
    if (hadHistory) { const ws = workbook.getWorksheet(HISTORY_TEMP); if (ws) ws._bomOriginalName = 'History'; }
    return workbook;
  }
  async function writeWorkbook(workbook) {
    const expectedNames = workbook.worksheets.map(displayName);
    const buffer = await workbook.xlsx.writeBuffer();
    const needsPackagePatch = !!workbook.getWorksheet(HISTORY_TEMP) || !!workbook._bomDefinedNamesXml;
    if (!needsPackagePatch) return buffer;
    const zip = await JSZip.loadAsync(buffer); const entry = zip.file('xl/workbook.xml');
    if (entry) {
      let xml = await entry.async('string');
      if (workbook.getWorksheet(HISTORY_TEMP)) xml = replaceSheetName(xml, HISTORY_TEMP, 'History');
      if (workbook._bomDefinedNamesXml) {
        xml = xml.replace(/<definedNames\b[\s\S]*?<\/definedNames>/, '');
        // Defined Names 內常見 $A$1、$AA$27 等 Excel 絕對位址。
        // 若直接使用字串 replacement，JavaScript 會把其中的 $1、$2 誤當成
        // regex capture group，進而把 <calcPr 插入 Print Area，產生 Excel
        // 無法開啟的 workbook.xml。使用 replacer function 才能原樣保留 `$`。
        xml = xml.replace(/(<calcPr\b|<\/workbook>)/, match => `${workbook._bomDefinedNamesXml}${match}`);
        if (!xml.includes(workbook._bomDefinedNamesXml)) {
          throw new Error('輸出檔的 Excel 名稱範圍結構異常，已停止下載');
        }
      }
      zip.file('xl/workbook.xml', xml);
    }
    const output = await zip.generateAsync({ type: 'arraybuffer' });
    const verificationZip = await JSZip.loadAsync(output);
    const verificationEntry = verificationZip.file('xl/workbook.xml');
    if (verificationEntry) {
      const xml = await verificationEntry.async('string');
      if (workbook._bomDefinedNamesXml && !xml.includes(workbook._bomDefinedNamesXml)) {
        throw new Error('輸出檔的 Excel 名稱範圍驗證失敗，已停止下載');
      }
      const outputNames = Array.from(xml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g), match => match[1]
        .replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
      const missing = expectedNames.filter(name => !outputNames.includes(name));
      if (missing.length) throw new Error(`輸出檔缺少原始分頁：${missing.join('、')}`);
    }
    return output;
  }
  function displayName(worksheet) { return worksheet._bomOriginalName || worksheet.name; }
  global.BomWorkbookIO = { HISTORY_TEMP, loadWorkbook, writeWorkbook, displayName };
})(window);
