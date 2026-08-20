(function (global) {
  'use strict';

  const CODE_MAPPING = Object.freeze({
    '一般':'GE','片/支/個':'PCS','片,支,個':'PCS','片，支，個':'PCS','片、支、個':'PCS',
    '釐米/公分':'CM','釐米,公分':'CM','釐米，公分':'CM','克/公克':'G','克,公克':'G',
    '公斤':'KG','米/公尺':'M','米,公尺':'M','套':'SET','加侖':'GA','磅':'LB',
    'L升/公升':'LT','L升,公升':'LT','毫升':'ML','卷/捲':'RO','卷,捲':'RO','碼':'YD',
    '盎司':'Ounce','箱':'CTN','打':'DZ','個/台/套/條':'EA','個,台,套,條':'EA',
    '個，台，套，條':'EA','雙':'PAIR','包':'PAK','平方米':'M2','0:虛擬階':'0',
    '1:成品階':'1','2:半成品階':'2','3:材料階':'3','4:卷材/銅箔階':'4',
    '4:卷材,銅箔階':'4','P:採購':'P','M:自製':'M','S:委外':'S','X:虛設':'X',
    '成品採購':'PP','報關客供件':'CD','國內客供件':'DC','客供品(禁領)':'CO','是':'Y','否':'N'
  });

  const SIMP_TO_TRAD = Object.freeze({
    '国':'國','产':'產','线':'線','缆':'纜','头':'頭','车':'車','板':'板','关':'關','开':'開',
    '电':'電','压':'壓','变':'變','器':'器','装':'裝','备':'備','数':'數','码':'碼','飞':'飛',
    '机':'機','场':'場','风':'風','华':'華','龙':'龍','东':'東','丝':'絲','个':'個','万':'萬',
    '与':'與','业':'業','两':'兩','严':'嚴','规':'規','格':'格','长':'長','宽':'寬','高':'高',
    '厘':'厘','米':'米','麦':'麥','组':'組','件':'件','散':'散','热':'熱','垫':'墊','导':'導',
    '铝':'鋁','钢':'鋼','铁':'鐵','铜':'銅','镀':'鍍','镍':'鎳','锌':'鋅','锡':'錫',
    '红':'紅','绿':'綠','蓝':'藍','浅':'淺','胶':'膠','树':'樹','喷':'噴','复':'複','纸':'紙',
    '贴':'貼','标':'標','签':'籤','结':'結','构':'構','紧':'緊','纹':'紋','轴':'軸',
    '轮':'輪','齿':'齒','弹':'彈','壳':'殼','盖':'蓋','体':'體','边':'邊','缘':'緣',
    '连':'連','网':'網','络':'絡','显':'顯','键':'鍵','触':'觸','摄':'攝','扬':'揚',
    '声':'聲','适':'適','应':'應','选':'選','择':'擇','确':'確','认':'認','设':'設',
    '计':'計','验':'驗','测':'測','试':'試','检':'檢','准':'準','态':'態','状':'狀',
    '样':'樣','总':'總','统':'統','处':'處','过':'過','转':'轉','换':'換','输':'輸',
    '达':'達','满':'滿','须':'須','为':'為','务':'務','对':'對','双':'雙','余':'餘',
    '误':'誤','极':'極','阈':'閾','点':'點','时':'時','间':'間','现':'現','还':'還',
    '这':'這','问':'問','题':'題','让':'讓','从':'從','会':'會','来':'來','说':'說',
    '话':'話','语':'語','记':'記','录':'錄','书':'書','写':'寫','画':'畫','图':'圖',
    '识':'識','别':'別','无':'無','旧':'舊','货':'貨','购':'購','买':'買','卖':'賣',
    '价':'價','费':'費','预':'預','员':'員','库':'庫','仓':'倉','储':'儲','厂':'廠',
    '后':'後','墙':'牆','墻':'牆','钝':'鈍','雾':'霧'
  });

  // 完整簡體 -> 台灣正體由本地 OpenCC 字典負責；這份表只保留 BOM 已確認的
  // 專用例外與無 OpenCC 環境下的相容 fallback。瀏覽器執行時不會連線下載字典。
  const OPENCC_CN_TO_TW = global.OpenCC && typeof global.OpenCC.Converter === 'function'
    ? global.OpenCC.Converter({ from: 'cn', to: 'tw' })
    : null;

  // 「BOM格式」可能是空白範本，也可能承載實際 BOM；需在欄位辨識後依內容判斷。
  const EXCLUDED_EXACT = new Set(['Sheet2', 'BOM申請單', 'History', 'Class code', 'Basic Name']);
  const CHECK_KEYWORDS = ['英文品名', '繁中品名', '簡中品名', '简中品名', '越南品名', '規格', '规格'];

  function cellText(cell) {
    if (!cell || cell.value === null || cell.value === undefined) return '';
    const value = cell.value;
    if (typeof value === 'object') {
      if (Array.isArray(value.richText)) return value.richText.map(x => x.text || '').join('');
      if (value.text !== undefined) return String(value.text);
      if (value.result !== undefined && value.result !== null) return String(value.result);
      if (value.hyperlink) return String(value.text || value.hyperlink);
    }
    return String(value);
  }

  function isFormulaCell(cell) {
    return !!(cell && cell.value && typeof cell.value === 'object' &&
      (Object.prototype.hasOwnProperty.call(cell.value, 'formula') || Object.prototype.hasOwnProperty.call(cell.value, 'sharedFormula')));
  }

  function toTraditionalChinese(value) {
    if (value === null || value === undefined) return value;
    let text = String(value).replaceAll('（', '(').replaceAll('）', ')');
    if (OPENCC_CN_TO_TW) text = OPENCC_CN_TO_TW(text);
    Object.entries(SIMP_TO_TRAD).forEach(([simp, trad]) => { text = text.replaceAll(simp, trad); });
    return text;
  }

  function convertCode(value) {
    if (value === null || value === undefined) return value;
    const compact = String(value).trim().replaceAll(' ', '').replaceAll('\u3000', '');
    if (Object.prototype.hasOwnProperty.call(CODE_MAPPING, compact)) return CODE_MAPPING[compact];
    const slash = compact.replaceAll(',', '/');
    return Object.prototype.hasOwnProperty.call(CODE_MAPPING, slash) ? CODE_MAPPING[slash] : value;
  }

  function getCharLength(value) {
    if (value === null || value === undefined || !String(value).trim()) return 0;
    return Array.from(String(value)).reduce((sum, ch) => sum + (ch.codePointAt(0) < 128 ? 1 : 2), 0);
  }

  function checkForbiddenSymbols(value) {
    if (value === null || value === undefined) return [];
    const text = String(value);
    const found = ['--', '&#', "'", ',', '~', ';', '|'].filter(symbol => text.includes(symbol));
    const fullwidth = [];
    Array.from(text).forEach(ch => {
      const code = ch.codePointAt(0);
      if ((code >= 0xFF01 && code <= 0xFF5E) || code === 0x3000 ||
          (code >= 0x3000 && code <= 0x303F) || (code >= 0xFF00 && code <= 0xFFEF)) {
        if (!fullwidth.includes(ch)) fullwidth.push(ch);
      }
    });
    if (fullwidth.length) found.push(`全型字[${fullwidth.join('')}]`);
    return found;
  }

  function isStandardPn(value) {
    if (value === null || value === undefined || !String(value).trim()) return false;
    const pn = String(value).trim();
    return /^\d{2,3}[A-Z0-9]?\d{6}-\d{2}[A-Z]$/i.test(pn) ||
      /^\d{2,3}-[A-Z0-9]?\d{6}-\d{2}[A-Z]$/i.test(pn) ||
      /^S[A-Z0-9]{9}$/i.test(pn);
  }

  function classifyNewStatus(value) {
    if (valueIsBlank(value)) return false;
    const text = String(value).trim().toUpperCase();
    if (/\bNOT\s*NEW\b/i.test(text) || /RENEWAL/i.test(text) || ['不申請','免申請','無需申請','毋須申請','不申请','免申请','无需申请','毋须申请'].some(x => text.includes(x))) return false;
    if (/\bNEW\b.*\bOLD\b|\bOLD\b.*\bNEW\b/i.test(text)) return null;
    if (/\bNEW\b/i.test(text) || text.includes('申請') || text.includes('申请')) return true;
    return false;
  }

  function valueIsBlank(value) {
    return value === null || value === undefined || String(value).trim() === '' || String(value).trim().toLowerCase() === 'nan';
  }

  function sheetRole(sheetName) {
    const normalized = String(sheetName || '').trim();
    const excluded = EXCLUDED_EXACT.has(normalized) || normalized.includes('代碼') || normalized.includes('規則');
    return { normalizedName: normalized, excluded, role: excluded ? 'reference' : 'bom' };
  }

  function isGreenTab(worksheet) {
    const color = worksheet && worksheet.properties ? worksheet.properties.tabColor : null;
    const argb = color && color.argb ? String(color.argb).toUpperCase() : '';
    return argb.endsWith('00B050') || argb.endsWith('92D050');
  }

  function hasActualBomRows(worksheet, metadata) {
    if (!metadata.headerRow || !metadata.pnColumn) return false;
    const lastRow = Math.max(worksheet.actualRowCount || 0, worksheet.rowCount || 0);
    for (let row = metadata.headerRow + 1; row <= lastRow; row += 1) {
      const pn = cellText(worksheet.getCell(row, metadata.pnColumn)).trim();
      const hasLevel = metadata.levelColumns.some(col => cellText(worksheet.getCell(row, col)).trim() !== '');
      if (pn || hasLevel) return true;
    }
    return false;
  }

  function detectMetadata(worksheet) {
    const displaySheetName = global.BomWorkbookIO ? global.BomWorkbookIO.displayName(worksheet) : worksheet.name;
    const role = sheetRole(displaySheetName);
    const metadata = {
      sheetName: displaySheetName, worksheetName: worksheet.name, normalizedName: role.normalizedName, role: role.role,
      excluded: role.excluded, headerRow: null, pnColumn: null, statusColumn: null,
      statusDetectionMethod: null, enColumn: null, zfColumn: null, zhColumn: null,
      viColumn: null, specColumn: null, basicNameColumn: null, levelColumns: [], checkColumns: [], warnings: []
    };
    if (role.excluded) return metadata;

    // Python baseline：正式 BOM 原則上必須是綠色頁籤；「BOM格式」是唯一依內容
    // 判斷的例外，可能沒有頁籤色但仍含實際 PN / Level 資料。
    if (metadata.normalizedName !== 'BOM格式' && !isGreenTab(worksheet)) {
      metadata.excluded = true;
      metadata.role = 'reference';
      return metadata;
    }

    const scanRows = Math.min(10, Math.max(worksheet.actualRowCount || 0, worksheet.rowCount || 0));
    let bestHeader = null;
    for (let row = 1; row <= scanRows; row += 1) {
      let score = 0;
      worksheet.getRow(row).eachCell({ includeEmpty: false }, cell => {
        const text = cellText(cell).trim();
        if (text === '料號' || text === '料号') score += 20;
        else if ((text.includes('料號') || text.includes('料号')) && !text.includes('客戶') && !text.includes('管理員') && !text.includes('必填')) score += 8;
        if (text.includes('英文品名')) score += 12;
        if (text.includes('規格') || text.includes('规格')) score += 3;
        if (text.includes('Item Level') || /^[1-8]$/.test(text)) score += 2;
      });
      if (!bestHeader || score > bestHeader.score) bestHeader = { row, score };
    }
    if (bestHeader && bestHeader.score > 0) metadata.headerRow = bestHeader.row;
    if (!metadata.headerRow) {
      metadata.warnings.push(
        { code: 'HEADER_NOT_FOUND', severity: 'BLOCKER', message: '找不到明確的欄位標題列 (Header Row)' },
        { code: 'STATUS_NOT_FOUND', severity: 'BLOCKER', message: '完全找不到狀態欄位，新舊料狀態相關檢查已略過' },
        { code: 'PN_NOT_FOUND', severity: 'BLOCKER', message: '找不到「料號」欄位，相關必填檢查已略過' },
        { code: 'GROUPCODE_NOT_FOUND', severity: 'WARNING', message: '找不到「分群碼」欄位，相關檢查已略過' },
        { code: 'SOURCECODE_NOT_FOUND', severity: 'WARNING', message: '找不到「來源碼」欄位，相關檢查已略過' },
        { code: 'END_CUSTOMER_NOT_FOUND', severity: 'WARNING', message: '找不到「終端客戶」欄位，相關檢查已略過' }
      );
      return metadata;
    }

    const maxColumn = worksheet.columnCount;
    for (let col = 1; col <= maxColumn; col += 1) {
      const name = cellText(worksheet.getCell(metadata.headerRow, col)).trim();
      if (!metadata.pnColumn && (name.includes('料號') || name.includes('料号')) && !name.includes('客戶')) metadata.pnColumn = col;
      const parent = metadata.headerRow > 1 ? cellText(worksheet.getCell(metadata.headerRow - 1, col)).trim() : '';
      const full = `${parent}_${name}`.toUpperCase();
      if (name.includes('英文') || /(^|_)EN(_|$)/.test(full)) metadata.enColumn = col;
      else if (name.includes('繁中') || name.includes('繁體') || /(^|_)ZF(_|$)/.test(full)) metadata.zfColumn = col;
      else if (name.includes('簡中') || name.includes('簡體') || name.includes('简中') || name.includes('简体') || /(^|_)ZH(_|$)/.test(full)) metadata.zhColumn = col;
      else if (name.includes('越南') || /(^|_)VI(_|$)/.test(full)) metadata.viColumn = col;
      if (name.includes('規格') || name.includes('规格')) metadata.specColumn = col;
      else if (name.includes('Basicname') || name.includes('Basic name')) metadata.basicNameColumn = col;
      if (name.includes('Level') || /^[1-8]$/.test(name)) metadata.levelColumns.push(col);
      if (CHECK_KEYWORDS.some(keyword => name.includes(keyword))) metadata.checkColumns.push(col);
    }

    const statusAliases = ['狀態', '状态', '新舊料', '新旧料', '新/舊料', '新/旧料', 'NEW/OLD', 'STATUS', '料件狀態', '料件状态'];
    for (let col = 1; col <= maxColumn; col += 1) {
      const normalized = cellText(worksheet.getCell(metadata.headerRow, col)).replace(/\s/g, '').toUpperCase();
      if (statusAliases.some(alias => normalized === alias.replace(/\s/g, '').toUpperCase()) && (!metadata.pnColumn || Math.abs(col - metadata.pnColumn) <= 3)) {
        metadata.statusColumn = col; metadata.statusDetectionMethod = 'header-alias'; break;
      }
    }
    if (!metadata.pnColumn) metadata.warnings.push({ code: 'PN_NOT_FOUND', severity: 'BLOCKER', message: '找不到料號欄' });
    if (!metadata.statusColumn && metadata.pnColumn > 1) {
      metadata.statusColumn = metadata.pnColumn - 1;
      metadata.statusDetectionMethod = 'pn-left-fallback';
      metadata.warnings.push({ code: 'STATUS_FALLBACK', severity: 'WARNING', message: '找不到狀態 Header，暫用料號左側欄位' });
    } else if (!metadata.statusColumn) {
      metadata.warnings.push({ code: 'STATUS_NOT_FOUND', severity: 'BLOCKER', message: '找不到狀態欄，且無法使用料號左側欄位' });
    }
    if (metadata.normalizedName === 'BOM格式' && !hasActualBomRows(worksheet, metadata)) {
      metadata.excluded = true;
      metadata.role = 'reference';
      metadata.warnings = [];
    }
    return metadata;
  }

  global.BomRules = {
    CODE_MAPPING, SIMP_TO_TRAD, CHECK_KEYWORDS, cellText, isFormulaCell,
    toTraditionalChinese, convertCode, getCharLength, checkForbiddenSymbols,
    isStandardPn, classifyNewStatus, sheetRole, isGreenTab, hasActualBomRows, detectMetadata
  };
})(window);
