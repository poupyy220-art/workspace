(function (global) {
  'use strict';

  const YELLOW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2CC' } };
  const RED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC7CE' } };
  const INFO_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DDEBF7' } };
  const BLUE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F497D' } };
  const THIN_BORDER = {
    top: { style: 'thin', color: { argb: 'D9D9D9' } }, bottom: { style: 'thin', color: { argb: 'D9D9D9' } },
    left: { style: 'thin', color: { argb: 'D9D9D9' } }, right: { style: 'thin', color: { argb: 'D9D9D9' } }
  };

  function valueIsBlank(value) { return value === null || value === undefined || String(value).trim() === '' || String(value).trim().toLowerCase() === 'nan'; }
  function hasBusinessCellValue(cell) {
    // ExcelJS 可能把「引用空白格」公式的快取結果讀成 0；Python data_only baseline
    // 對同一情況視為空白。逐列 gate 因此不以公式格單獨認定為有效料件。
    if (global.BomRules.isFormulaCell(cell)) return false;
    return !valueIsBlank(global.BomRules.cellText(cell));
  }
  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function markYellow(cell) { cell.fill = clone(YELLOW_FILL); cell.font = Object.assign({}, cell.font || {}, { color: { argb: '7F6000' }, bold: true }); }
  function markRed(cell) { cell.fill = clone(RED_FILL); cell.font = Object.assign({}, cell.font || {}, { color: { argb: '9C0006' }, bold: true }); }
  function pushTrace(ctx, ruleId, worksheet, row, col, before, after, reason, severity) {
    ctx.traces.push({ ruleId, sheet: ctx.metadata.sheetName, excelRow: row, column: col, field: global.BomRules.cellText(worksheet.getCell(ctx.metadata.headerRow, col)).replace(/\n/g, ' ').trim(), before, after, reason, severity: severity || 'INFO' });
  }
  function safeSet(ctx, worksheet, row, col, nextValue, ruleId, reason) {
    if (!col) return false;
    const cell = worksheet.getCell(row, col); const before = global.BomRules.cellText(cell);
    if (String(before) === String(nextValue)) return false;
    if (global.BomRules.isFormulaCell(cell)) {
      ctx.issues.push({ sheet: ctx.metadata.sheetName, excelRow: row, field: global.BomRules.cellText(worksheet.getCell(ctx.metadata.headerRow, col)), severity: 'WARNING', reason: `公式儲存格需要修改但已保留公式：${reason}`, currentValue: before, modifiedValue: '' });
      return false;
    }
    cell.value = nextValue; pushTrace(ctx, ruleId, worksheet, row, col, before, nextValue, reason); return true;
  }

  function processWorksheet(worksheet, metadata) {
    const ctx = { metadata, issues: [], traces: [], newCount: 0, itemCount: 0 };
    if (metadata.excluded || !metadata.headerRow || !metadata.pnColumn || !metadata.statusColumn) return ctx;
    // actualRowCount 是「非空白列的數量」，不是最後一筆資料所在的列號。
    // BOM 中間若有空白分隔列，直接拿它當上限會讓尾端資料完全未處理。
    const lastRow = Math.max(worksheet.actualRowCount || 0, worksheet.rowCount || 0);
    let lastValidLevel = 0;
    let firstBusinessRowSeen = false;
    const levelErrorCells = [];
    for (let row = metadata.headerRow + 1; row <= lastRow; row += 1) {
      const pnCell = worksheet.getCell(row, metadata.pnColumn);
      const statusCell = worksheet.getCell(row, metadata.statusColumn);
      const pn = global.BomRules.cellText(pnCell).trim();
      const statusBefore = global.BomRules.cellText(statusCell).trim();
      // Python baseline 的逐列處理條件不只看 Level；只有 PN／品名／規格等實際
      // 料件內容才算業務資料，避免空白範本的 Level 預填列被誤寫成 NEW。
      const businessColumns = [metadata.pnColumn, metadata.enColumn, metadata.zfColumn, metadata.zhColumn, metadata.viColumn, metadata.specColumn].filter(Boolean);
      const hasBusinessData = businessColumns.some(col => hasBusinessCellValue(worksheet.getCell(row, col)));
      if (!hasBusinessData) continue;
      ctx.itemCount += 1;

      worksheet.getRow(row).eachCell({ includeEmpty: false }, (cell, col) => {
        const header = global.BomRules.cellText(worksheet.getCell(metadata.headerRow, col)).trim();
        let current = global.BomRules.cellText(cell); let normalized = current;
        if (['規格', '繁中品名', '簡中品名'].some(key => header.includes(key))) normalized = global.BomRules.toTraditionalChinese(current);
        if (normalized !== current) safeSet(ctx, worksheet, row, col, normalized, 'BR-003', '指定字元正規化');
        // 分群碼/來源碼/單位/特殊屬性等代碼欄位可能填簡體字（如「材料阶」「个」）；
        // 對照表鍵值只有繁體字，直接比對會漏轉。簡轉繁後再比對一次可以補上這種情況，
        // 但 OpenCC 的繁體正規化本身會動到「台」等本來就合法的既有繁體字（台->臺），
        // 導致「個/台/套/條」這種本來就能直接比對成功的既有繁體內容比對失敗；因此只有在
        // 簡轉繁後的字串真的命中代碼表時才採用該結果，沒命中就完全保留原始內容不覆寫。
        const rawCode = global.BomRules.convertCode(current);
        const traditionalized = global.BomRules.toTraditionalChinese(current);
        const traditionalCode = global.BomRules.convertCode(traditionalized);
        const codeValue = rawCode !== current ? rawCode : (traditionalCode !== traditionalized ? traditionalCode : current);
        if (String(codeValue) !== current) safeSet(ctx, worksheet, row, col, codeValue, 'BR-002', 'CODE_MAPPING');
      });

      if (valueIsBlank(statusBefore)) safeSet(ctx, worksheet, row, metadata.statusColumn, pn && global.BomRules.isStandardPn(pn) ? 'OLD' : 'NEW', 'BR-018', 'NEW/OLD 自動判定');
      if (metadata.specColumn && metadata.basicNameColumn && global.BomRules.cellText(worksheet.getCell(row, metadata.specColumn)).trim() === 'H PN') {
        safeSet(ctx, worksheet, row, metadata.basicNameColumn, 'LINEFIT', 'BR-019', '規格欄為 H PN');
      }

      const status = global.BomRules.cellText(statusCell).trim().toUpperCase();
      let isNewItem = global.BomRules.classifyNewStatus(status);
      if (isNewItem === null) {
        ctx.issues.push({ sheet: metadata.sheetName, excelRow: row, field: '狀態', severity: 'WARNING', reason: `狀態內容「${status}」同時含 NEW 與 OLD 等模糊語意，已保守視為非 NEW，請人工複核`, currentValue: status, modifiedValue: '' });
        isNewItem = false;
      }
      if (isNewItem) {
        ctx.newCount += 1;
        if (metadata.zfColumn) {
          const zf = global.BomRules.cellText(worksheet.getCell(row, metadata.zfColumn));
          if (!valueIsBlank(zf)) safeSet(ctx, worksheet, row, metadata.zfColumn, global.BomRules.toTraditionalChinese(zf), 'BR-020', 'NEW ZF 正規化');
        }
        if (metadata.zhColumn && metadata.zfColumn) {
          const zf = global.BomRules.cellText(worksheet.getCell(row, metadata.zfColumn));
          const zh = global.BomRules.cellText(worksheet.getCell(row, metadata.zhColumn));
          if (!valueIsBlank(zf)) safeSet(ctx, worksheet, row, metadata.zhColumn, valueIsBlank(zh) ? zf : global.BomRules.toTraditionalChinese(zh), 'BR-020', 'ZH 繼續使用繁體內容');
        }
        if (metadata.viColumn && metadata.enColumn) {
          const vi = global.BomRules.cellText(worksheet.getCell(row, metadata.viColumn));
          const en = global.BomRules.cellText(worksheet.getCell(row, metadata.enColumn));
          if (valueIsBlank(vi) && !valueIsBlank(en)) safeSet(ctx, worksheet, row, metadata.viColumn, en, 'BR-021', 'NEW VI 空白複製 EN');
        }
      }

      let currentLevel = null;
      let currentLevelColumn = null;
      let levelErrorCell = null;
      for (const col of metadata.levelColumns) {
        const value = global.BomRules.cellText(worksheet.getCell(row, col));
        if (!valueIsBlank(value) && Number.isFinite(Number(value))) { currentLevel = Math.trunc(Number(value)); currentLevelColumn = col; break; }
      }
      if (!firstBusinessRowSeen && currentLevel !== 1) {
        if (currentLevelColumn) { levelErrorCell = worksheet.getCell(row, currentLevelColumn); levelErrorCells.push(levelErrorCell); }
        ctx.issues.push({ sheet: metadata.sheetName, excelRow: row, field: 'Item Level (階層)', severity: 'BLOCKER', reason: 'BOM 第一筆有效料件必須從 Level 1 開始', currentValue: currentLevel === null ? '未填寫 Level' : `Level ${currentLevel}`, modifiedValue: 'Level 1' });
      }
      firstBusinessRowSeen = true;
      if (currentLevel !== null) {
        if (lastValidLevel > 0 && currentLevel > lastValidLevel + 1) {
          if (currentLevelColumn) { levelErrorCell = worksheet.getCell(row, currentLevelColumn); levelErrorCells.push(levelErrorCell); }
          ctx.issues.push({ sheet: metadata.sheetName, excelRow: row, field: 'Item Level (階層)', severity: 'BLOCKER', reason: `階層樹邏輯錯亂/跳階(從${lastValidLevel}級直接跳到${currentLevel}級)`, currentValue: `Level ${currentLevel}`, modifiedValue: '' });
        }
        lastValidLevel = currentLevel;
      }

      if (!isNewItem) { if (levelErrorCell) markRed(levelErrorCell); continue; }
      markYellow(statusCell); markYellow(pnCell);
      // 客戶料號必填（同事確認）：NEW 料空白只提醒，不擋交 IT
      if (metadata.customerPnColumn && valueIsBlank(global.BomRules.cellText(worksheet.getCell(row, metadata.customerPnColumn)))) {
        ctx.issues.push({ sheet: metadata.sheetName, excelRow: row, field: '客戶料號', severity: 'WARNING', reason: 'NEW 料客戶料號空白（必填），請補上', currentValue: '', modifiedValue: '' });
      }
      metadata.checkColumns.forEach(col => {
        const cell = worksheet.getCell(row, col); const value = global.BomRules.cellText(cell);
        const symbols = global.BomRules.checkForbiddenSymbols(value); const length = global.BomRules.getCharLength(value);
        if (symbols.length || length > 30) {
          const reasons = []; if (symbols.length) reasons.push(`含不合規符號/全型字 ${JSON.stringify(symbols)}`); if (length > 30) reasons.push(`長度${length}字(超過30)`);
          markRed(cell); ctx.issues.push({ sheet: metadata.sheetName, excelRow: row, field: global.BomRules.cellText(worksheet.getCell(metadata.headerRow, col)).replace(/\n/g, ' ').trim(), severity: 'BLOCKER', reason: reasons.join(' + '), currentValue: value, modifiedValue: '' });
        } else if (value) markYellow(cell);
      });
      // 異常紅色優先於 NEW 黃色及原始範本底色。
      if (levelErrorCell) markRed(levelErrorCell);
    }
    // Excel 範本可能共用樣式物件，整張分頁完成後再套一次，確保紅色優先。
    levelErrorCells.forEach(markRed);
    return ctx;
  }

  // 依問題類型給白話處理建議（沿用 pn-bom-import 的建議方式，配合本模組的欄位與原因用語）
  function adviceFor(issue) {
    const reason = String(issue.reason || ''); const field = String(issue.field || '此欄位').replace(/\n/g, ' ').trim();
    const where = issue.sheet && issue.excelRow && issue.excelRow !== '-' ? `「${issue.sheet}」頁第 ${issue.excelRow} 列` : '來源資料';
    if (issue.severity === 'PASS') return '-';
    if (field === '欄位辨識' || /表頭|欄位/.test(reason) && /辨識|找不到|重複/.test(reason)) return '可能是表頭辨識問題：請處理人員先核對該頁表頭文字與合併儲存格，不要直接要求 RD 重填資料。';
    if (/公式儲存格/.test(reason)) return `系統已保留 ${where}「${field}」的公式未自動改值；請在 Excel 確認公式結果是否正確，必要時手動修改。`;
    if (/長度/.test(reason) && /不合規符號|全型字/.test(reason)) return `請 RD 修改 ${where}「${field}」：移除不合規符號／全型字，並縮短至 30 字元內。`;
    if (/長度/.test(reason)) return `請 RD 將 ${where}「${field}」縮短至 30 字元內；如何縮寫由 RD 確認，系統不代為刪改。`;
    if (/不合規符號|全型字/.test(reason)) return `請 RD 檢查 ${where}「${field}」，移除或改正不接受的符號／全型字後重新檢查。`;
    if (/Level|階層|跳階/.test(field + reason)) return `請 RD 核對 ${where}的 BOM 階層：第一筆須為 Level 1，向下不可一次跳超過一階。`;
    if (field === '客戶料號') return `客戶料號為必填：請 RD 補上 ${where}的客戶料號（只提醒，不擋交 IT）。`;
    if (field === '狀態' || /NEW|OLD/.test(reason)) return `請 RD 確認 ${where}應為 NEW 或 OLD，避免套用錯誤的檢查規則。`;
    return `請 RD／處理人員核對 ${where}「${field}」與問題原因，修正後重新檢查。`;
  }

  function createReport(workbook, issues) {
    const old = workbook.getWorksheet('【異常檢測報告】'); if (old) workbook.removeWorksheet(old.id);
    const ws = workbook.addWorksheet('【異常檢測報告】', { properties: { tabColor: { argb: '1F497D' } }, views: [{ state: 'frozen', ySplit: 10, showGridLines: true }] });
    const title = ws.getCell('A1'); title.value = '📋 系統轉檔與顏色標註說明'; title.font = { name: 'Microsoft JhengHei', size: 14, bold: true, color: { argb: '1F497D' } }; ws.mergeCells('A1:F1');
    ws.addRow([]); ws.addRow(['標註顏色','套用對象','檢查規則與判斷標準','建議處理方式','','']); ws.mergeCells('D3:F3');
    ws.addRow(['淺黃底 + 棕字','NEW 新料件／WARNING',"系統判定為 NEW 的料號、狀態及品名/規格；WARNING 問題明細也使用此色",'需重點核對；原檔既有黃色不代表系統判定 NEW','','']); ws.mergeCells('D4:F4');
    ws.addRow(['淺紅底 + 深紅字','BLOCKER／異常儲存格','非法符號、全型字、長度 > 30、第一筆非 Level 1 或 BOM 階層跳階','必須修復後再重新檢查','','']); ws.mergeCells('D5:F5');
    ws.addRow(['淺藍底 + 藍字','資訊提示','欄位辨識 fallback、代碼轉換等非卡關資訊','建議確認，但不一定需要修改','','']); ws.mergeCells('D6:F6');
    ws.getCell('A4').fill = clone(YELLOW_FILL); ws.getCell('A4').font = { color: { argb: '7F6000' }, bold: true };
    ws.getCell('A5').fill = clone(RED_FILL); ws.getCell('A5').font = { color: { argb: '9C0006' }, bold: true };
    ws.getCell('A6').fill = clone(INFO_FILL); ws.getCell('A6').font = { color: { argb: '1F497D' }, bold: true };
    for (let row = 3; row <= 6; row += 1) {
      for (let col = 1; col <= 6; col += 1) {
        const cell = ws.getCell(row, col);
        cell.border = clone(THIN_BORDER);
        cell.alignment = { vertical: 'center', wrapText: true };
        cell.font = Object.assign({ name: 'Microsoft JhengHei', size: 10 }, cell.font || {});
      }
    }
    for (let col = 1; col <= 6; col += 1) {
      const cell = ws.getCell(3, col);
      cell.fill = clone(BLUE_FILL);
      cell.font = { name: 'Microsoft JhengHei', size: 10, bold: true, color: { argb: 'FFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
    }
    ws.addRow(['⚠ 原始 BOM 分頁格式會完整保留；原檔既有黃色／棕字不代表系統判定 NEW，請同時查看狀態欄與本報告。']); ws.mergeCells('A7:H7'); ws.getCell('A7').font = { name: 'Microsoft JhengHei', size: 10, bold: true, color: { argb: '9C6500' } }; ws.getCell('A7').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEB9C' } }; ws.getCell('A7').alignment = { vertical: 'center', wrapText: true };
    ws.addRow(['🔍 BOM 結構與 NEW 料件卡關問題明細清單']); ws.getCell('A8').font = { name: 'Microsoft JhengHei', size: 12, bold: true, color: { argb: '1F497D' } };
    // 第 9 列：本次摘要（第 10 列表頭位置不變）
    const blockers = issues.filter(x => x.severity === 'BLOCKER').length, warnings = issues.filter(x => x.severity === 'WARNING').length;
    const sheetsWithIssues = Array.from(new Set(issues.filter(x => x.severity === 'BLOCKER' || x.severity === 'WARNING').map(x => x.sheet))).filter(Boolean);
    ws.addRow([`📊 本次摘要：BLOCKER ${blockers} 筆、WARNING ${warnings} 筆${sheetsWithIssues.length ? `；涉及頁籤：${sheetsWithIssues.join('、')}` : '；全表無卡關問題'}。處理方式見每列「建議處理方式」。`]);
    ws.mergeCells('A9:H9'); ws.getCell('A9').font = { name: 'Microsoft JhengHei', size: 10, bold: true, color: { argb: blockers ? '9C0006' : '1F497D' } }; ws.getCell('A9').alignment = { vertical: 'center', wrapText: true };
    ws.addRow(['分頁名稱','Excel行號','欄位名稱','嚴重度','卡關原因','當前內容','修改後內容','建議處理方式']);
    const headerRow = ws.getRow(10); for (let col = 1; col <= 8; col += 1) { const cell = headerRow.getCell(col); cell.fill = clone(BLUE_FILL); cell.font = { name: 'Microsoft JhengHei', size: 10, bold: true, color: { argb: 'FFFFFF' } }; cell.border = clone(THIN_BORDER); cell.alignment = { horizontal: 'center', vertical: 'middle' }; }
    if (issues.length) issues.forEach(issue => ws.addRow([issue.sheet, issue.excelRow, issue.field, issue.severity, issue.reason, issue.currentValue, issue.modifiedValue, adviceFor(issue)]));
    else ws.addRow(['全表合規','-','-','PASS','無 BOM 階層跳階或 NEW 料件內容異常','-','-','-']);
    for (let row = 11; row <= ws.rowCount; row += 1) {
      const severity = String(ws.getCell(row, 4).value || '').toUpperCase();
      for (let col = 1; col <= 8; col += 1) {
        const cell = ws.getCell(row, col);
        cell.font = Object.assign({ name: 'Microsoft JhengHei', size: 10 }, cell.font || {});
        cell.border = clone(THIN_BORDER);
        cell.alignment = { vertical: 'top', wrapText: true };
      }
      const fill = severity === 'BLOCKER' ? RED_FILL : severity === 'WARNING' ? YELLOW_FILL : INFO_FILL;
      const fontColor = severity === 'BLOCKER' ? '9C0006' : severity === 'WARNING' ? '7F6000' : '1F497D';
      for (const col of [3, 4, 5]) {
        ws.getCell(row, col).fill = clone(fill);
        ws.getCell(row, col).font = Object.assign({}, ws.getCell(row, col).font, { color: { argb: fontColor }, bold: severity !== 'INFO' && severity !== 'PASS' });
      }
    }
    ws.columns = [{ width: 32 },{ width: 12 },{ width: 28 },{ width: 12 },{ width: 52 },{ width: 44 },{ width: 30 },{ width: 60 }];
    ws.autoFilter = { from: 'A10', to: 'H10' };

    // 方便使用者完成轉檔後立即查看報告：若原檔含 History，將報告放在
    // History 的正前方；沒有 History 時維持新增於最後分頁。
    const historyName = global.BomWorkbookIO && global.BomWorkbookIO.HISTORY_TEMP;
    const history = (historyName && workbook.getWorksheet(historyName)) || workbook.getWorksheet('History');
    if (history) {
      const ordered = workbook.worksheets.filter(sheet => sheet !== ws);
      const historyIndex = ordered.indexOf(history);
      if (historyIndex >= 0) {
        ordered.splice(historyIndex, 0, ws);
        ordered.forEach((sheet, index) => { sheet.orderNo = index; });
      }
    }
  }

  function processWorkbook(workbook) {
    const metadata = []; const issues = []; const traces = []; let itemCount = 0; let newCount = 0;
    workbook.worksheets.slice().forEach(worksheet => {
      if (worksheet.name === '【異常檢測報告】') return;
      const meta = global.BomRules.detectMetadata(worksheet); metadata.push(meta);
      meta.warnings.forEach(w => issues.push({ sheet: meta.sheetName, excelRow: meta.headerRow || '-', field: '欄位辨識', severity: w.severity, reason: w.message, currentValue: '', modifiedValue: '' }));
      const result = processWorksheet(worksheet, meta); issues.push(...result.issues); traces.push(...result.traces); itemCount += result.itemCount; newCount += result.newCount;
    });
    createReport(workbook, issues);
    return { metadata, issues, traces, itemCount, newCount, blockerCount: issues.filter(x => x.severity === 'BLOCKER').length, warningCount: issues.filter(x => x.severity === 'WARNING').length };
  }

  global.BomEngine = { processWorkbook };
})(window);
