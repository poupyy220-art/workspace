(function (global) {
  'use strict';

  const YELLOW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2CC' } };
  const RED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC7CE' } };
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
    const lastRow = worksheet.actualRowCount || worksheet.rowCount;
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
        const codeValue = global.BomRules.convertCode(global.BomRules.cellText(cell));
        if (String(codeValue) !== global.BomRules.cellText(cell)) safeSet(ctx, worksheet, row, col, codeValue, 'BR-002', 'CODE_MAPPING');
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

  function createReport(workbook, issues) {
    const old = workbook.getWorksheet('【異常檢測報告】'); if (old) workbook.removeWorksheet(old.id);
    const ws = workbook.addWorksheet('【異常檢測報告】', { properties: { tabColor: { argb: '1F497D' } }, views: [{ state: 'frozen', ySplit: 9, showGridLines: true }] });
    const title = ws.getCell('A1'); title.value = '📋 系統轉檔與顏色標註說明'; title.font = { name: 'Microsoft JhengHei', size: 14, bold: true, color: { argb: '1F497D' } }; ws.mergeCells('A1:F1');
    ws.addRow([]); ws.addRow(['標註顏色','套用對象','檢查規則與判斷標準','建議處理方式','','']); ws.mergeCells('D3:F3');
    ws.addRow(['淺黃底 + 棕字','NEW 新料件',"狀態欄位包含 'NEW' 的料號、狀態及品名/規格",'提示此列為新發行料件，需重點核對','','']); ws.mergeCells('D4:F4');
    ws.addRow(['淺紅底 + 深紅字','異常儲存格','非法符號、全型字、長度 > 30、第一筆非 Level 1 或 BOM 階層跳階','請修復後再交 IT','','']); ws.mergeCells('D5:F5');
    ws.getCell('A4').fill = clone(YELLOW_FILL); ws.getCell('A4').font = { color: { argb: '7F6000' }, bold: true };
    ws.getCell('A5').fill = clone(RED_FILL); ws.getCell('A5').font = { color: { argb: '9C0006' }, bold: true };
    for (let row = 3; row <= 5; row += 1) {
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
    ws.addRow([]); ws.addRow(['🔍 BOM 結構與 NEW 料件卡關問題明細清單']); ws.getCell('A7').font = { name: 'Microsoft JhengHei', size: 12, bold: true, color: { argb: '1F497D' } };
    ws.addRow([]); ws.addRow(['分頁名稱','Excel行號','欄位名稱','嚴重度','卡關原因','當前內容','修改後內容']);
    const headerRow = ws.getRow(9); for (let col = 1; col <= 7; col += 1) { const cell = headerRow.getCell(col); cell.fill = clone(BLUE_FILL); cell.font = { name: 'Microsoft JhengHei', size: 10, bold: true, color: { argb: 'FFFFFF' } }; cell.border = clone(THIN_BORDER); cell.alignment = { horizontal: 'center', vertical: 'middle' }; }
    if (issues.length) issues.forEach(issue => ws.addRow([issue.sheet, issue.excelRow, issue.field, issue.severity, issue.reason, issue.currentValue, issue.modifiedValue]));
    else ws.addRow(['全表合規','-','-','PASS','無 BOM 階層跳階或 NEW 料件內容異常','-','-']);
    for (let row = 10; row <= ws.rowCount; row += 1) for (let col = 1; col <= 7; col += 1) { const cell = ws.getCell(row, col); cell.font = Object.assign({ name: 'Microsoft JhengHei', size: 10 }, cell.font || {}); cell.border = clone(THIN_BORDER); cell.alignment = { vertical: 'top', wrapText: true }; }
    ws.columns = [{ width: 32 },{ width: 12 },{ width: 28 },{ width: 12 },{ width: 52 },{ width: 44 },{ width: 30 }];
    ws.autoFilter = { from: 'A9', to: 'G9' };

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
