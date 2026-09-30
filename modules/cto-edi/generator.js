(function(){
  const TARGETS=['Mapping','自動加入品名規格','自動加棧板設並','根據專案加入'];
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const text=v=>String(v??'').trim();
  const today=()=>{const d=new Date();return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000+25569};
  const dayTag=()=>new Date().toISOString().slice(0,10).replaceAll('-','');
  const safeName=s=>text(s).replace(/[\\/:*?"<>|]/g,'_');

  function requiredProject(){
    const mtms=parseMtm(mtm.value);
    const missing=[];
    if(!project.value.trim())missing.push('Project');
    if(!bomDate.value)missing.push('收到 CTO BOM 日期');
    if(!owner.value)missing.push('負責人');
    if(!mtms.length)missing.push('MTM 前四碼');
    if(ediStatus.value!=='yes')missing.push('CTO EDI 必須確認為 Yes');
    for(const [el,name] of [[productName,'品名'],[productSpec,'規格'],[modelCode,'機種別代號'],[marketClass,'市場分類'],[mtmFamily,'MTM Family']])if(!el.value.trim())missing.push(name);
    if(labelStatus.value==='pending')missing.push('Configured 標籤需確認需要／不需要');
    if(labelStatus.value==='yes'){
      if(!fanyPpt.files[0])missing.push('Fany PPT');
      if(!labelPn.value.trim())missing.push('固定標籤 PN');
      if(!labelUsage.value)missing.push('固定標籤用量');
      if(!pptConfirmed.checked)missing.push('人工對照 Fany PPT');
    }
    if(!baseFile.files[0])missing.push('目前最新完整 Excel');
    if(!rdFile.files[0])missing.push('RD 棧板清單 Excel');
    if(missing.length)throw new Error('請先完成：'+missing.join('、'));
    return {mtms,project:project.value.trim(),family:mtmFamily.value.trim(),labelNeeded:labelStatus.value==='yes'};
  }

  async function loadWorkbook(source){const wb=new ExcelJS.Workbook(),bytes=source instanceof File?await source.arrayBuffer():source;await wb.xlsx.load(bytes);return wb}
  function getSheet(wb,name){const ws=wb.getWorksheet(name);if(!ws)throw new Error(`找不到工作表「${name}」`);return ws}
  function copyStyle(ws,fromRow,toRow,maxCol){for(let c=1;c<=maxCol;c++){const src=ws.getCell(fromRow,c),dst=ws.getCell(toRow,c);dst.style=clone(src.style)||{};if(src.numFmt)dst.numFmt=src.numFmt;dst.alignment=clone(src.alignment);dst.border=clone(src.border);dst.fill=clone(src.fill);dst.font=clone(src.font);dst.protection=clone(src.protection)}ws.getRow(toRow).height=ws.getRow(fromRow).height}
  function append(ws,values,maxCol){const from=Math.max(1,ws.rowCount||1);const row=ws.addRow(values);copyStyle(ws,from,row.number,maxCol);return row}
  function existingMtms(ws){const out=new Set();for(let r=2;r<=ws.rowCount;r++){const v=text(ws.getCell(r,1).text||ws.getCell(r,1).value).toUpperCase();if(v)out.add(v)}return out}

  function numberFromNote(note,label){const m=text(note).match(new RegExp(label+'\\s*(\\d+)台'));return m?Number(m[1]):null}
  // 鍵盤類型 → 自動加棧板設並 B 欄代碼；帶鍵盤專案（如 Yoga Mini、TCX Ultra）與 AI 鍵盤同為 1
  const KEYBOARD_KINDS=[['AI鍵盤',1],['帶鍵盤',1],['無鍵盤',2],['常規鍵盤',3]];
  const keyboardKind=type=>(KEYBOARD_KINDS.find(([k])=>type.includes(k))||[])[1];
  function parsePalletRules(wb,p){
    const ws=getSheet(wb,'棧板清單'),blocks=[];
    const ctext=(r,c)=>text(ws.getCell(r,c).text||ws.getCell(r,c).value);
    for(let r=1;r<=ws.rowCount;r++){
      if(ctext(r,1)!=='棧板出貨地')continue;
      const type=ctext(r,8),kindCode=keyboardKind(type);
      if(!kindCode)continue;
      let end=r+1;while(end<=ws.rowCount&&ctext(end,1)!=='棧板出貨地')end++;
      const blockMtms=[];
      const rows=[];for(let x=r+1;x<end;x++){
        for(const token of ctext(x,1).toUpperCase().split(/[\r\n,，;；\s]+/))if(/^[A-Z0-9]{4}$/.test(token))blockMtms.push(token);
        rows.push({row:x,label:ctext(x,2),rawUsage:ctext(x,5),rawBase:ctext(x,6),pn:ctext(x,3).replace(/\s+/g,''),pallet:Number(ws.getCell(x,5).value||1),base:Number(ws.getCell(x,6).value||1),note:ctext(x,7),sbb:ctext(x,8)});
      }
      blocks.push({type,kindCode,headerRow:r,rows,mtms:[...new Set(blockMtms)]});
    }
    const selected=blocks.filter(block=>block.mtms.some(m=>p.mtms.includes(m)));
    const seen=blocks.map(b=>`第${b.headerRow}列 ${b.type}[${b.mtms.join(',')}]`).slice(-6).join('／')||'無';
    if(!selected.length)throw new Error(`棧板清單找不到本專案 MTM 的區塊（本次 MTM：${p.mtms.join(',')}）。每個鍵盤類型區塊都要有一列 A 欄「棧板出貨地」標題、H 欄寫 AI鍵盤／帶鍵盤／無鍵盤／常規鍵盤，下一列起 A 欄列出 MTM。已辨識區塊：${seen}`);
    const dupKind=selected.filter((b,i)=>selected.findIndex(x=>x.kindCode===b.kindCode)!==i);
    if(dupKind.length)throw new Error(`棧板清單同一鍵盤代碼出現多個區塊：${selected.map(b=>`第${b.headerRow}列 ${b.type}`).join('、')}，請確認沒有重複或舊資料`);
    for(const b of selected){const miss=p.mtms.filter(m=>!b.mtms.includes(m));if(miss.length)throw new Error(`棧板清單第${b.headerRow}列「${b.type}」區塊缺少 MTM：${miss.join('、')}`)}
    const table=parseThresholdTable(ws);
    return selected.flatMap(b=>parseBlock(b,ws,table).map(rule=>({...rule,kindCode:b.kindCode})));
  }
  // RD 單層門檻小表：標題列含「西歐（單層）」「非西歐（單層）」，每列用 SBB 對應鍵盤區塊
  function parseThresholdTable(ws){
    const out=[],ctext=(r,c)=>text(ws.getCell(r,c).text||ws.getCell(r,c).value),norm=s=>s.replace(/[\s()（）［］\[\]]/g,'').replace(/^出中國/,'中國');
    for(let r=1;r<=ws.rowCount;r++){
      const cols={};
      for(let c=1;c<=ws.columnCount;c++){const v=norm(ctext(r,c));if(v==='西歐單層')cols.west=c;else if(v==='非西歐單層'||v==='非西歐含HK單層')cols.nonWest=c;else if(v==='中國單層')cols.china=c;else if(v==='尾數單層')cols.tail=c}
      if(!cols.west||!cols.nonWest)continue;
      const firstNum=Math.min(...Object.values(cols));
      for(let x=r+1;x<=ws.rowCount;x++){
        let label='';for(let c=1;c<firstNum;c++)label+=' '+ctext(x,c);
        const sbbs=label.toUpperCase().match(/SBB[0-9A-Z]+/g);
        if(!sbbs){if(!label.trim())break;continue}
        const num=c=>c?Number(ctext(x,c))||null:null;
        out.push({row:x,sbbs,west:num(cols.west),nonWest:num(cols.nonWest),china:num(cols.china),tail:num(cols.tail)});
      }
    }
    return out;
  }
  function parseBlock({type,headerRow,rows},ws,table=[]){
    const where=`棧板清單第${headerRow}列「${type}」`;
    const chinaRows=rows.filter(x=>x.label==='出中國');
    if(chinaRows.length>1)throw new Error(`${where}區塊內有 ${chinaRows.length} 組「出中國」資料，請在第${chinaRows[1].row}列前插入一列 A 欄「棧板出貨地」、H 欄寫鍵盤類型的標題列，把區塊分開`);
    const sbb=[...new Set(rows.map(x=>x.sbb).filter(Boolean))].join(',');
    const china=rows.find(x=>x.label==='出中國'),nonWest=rows.find(x=>x.label.startsWith('非西歐')),west=rows.find(x=>x.label.startsWith('西歐')),single=rows.find(x=>x.label.includes('單層')),double=rows.find(x=>x.label.includes('雙層'));
    const missing=[!sbb&&'H 欄 SBB',!china&&'出中國列',!nonWest&&'非西歐列',!west&&'西歐列',!single&&'CTO EDI_尾數包材_單層列'].filter(Boolean);
    if(missing.length)throw new Error(`${where}區塊欄位不完整：缺 ${missing.join('、')}`);
    // 尾數包材單層／雙層列：歷史資料一律 E=1、F=D（1個棧板用量），RD 未填時依此補齊
    for(const x of [single,double])if(x){
      if(x.rawUsage===''){x.pallet=1;x.rawUsage='1'}
      const d=Number(ws.getCell(x.row,4).value);
      if(x.rawBase===''&&d){x.base=d;x.rawBase=String(d)}
    }
    const blankEF=[china,nonWest,west,single,double].filter(x=>x&&(x.rawUsage===''||x.rawBase==='')).map(x=>`第${x.row}列（${x.label}）`);
    if(blankEF.length)throw new Error(`${where}E 欄「1台機器/用量」或 F 欄「1台機器/主件底數」空白：${blankEF.join('、')}，請 RD 補齊`);
    const start=Number(ws.getCell(single.row,4).value||single.base);
    // 門檻來源：單層列 G 欄備註優先；空白時改讀 RD 單層門檻小表（用 SBB 對應）；兩者都有時必須一致
    const fromNote={nonWest:numberFromNote(single.note,'非西歐(?:/中國)?\\s*單層'),west:numberFromNote(single.note,'西歐單層')};
    fromNote.china=numberFromNote(single.note,'中國\\s*單層')||fromNote.nonWest;
    const blockSbbs=sbb.toUpperCase().match(/SBB[0-9A-Z]+/g)||[],hits=table.filter(t=>t.sbbs.some(s=>blockSbbs.includes(s)));
    const key=t=>[t.west,t.nonWest,t.china||t.nonWest].join('/');
    if(new Set(hits.map(key)).size>1)throw new Error(`${where}在單層門檻小表對到多列且數字不同（第${hits.map(t=>t.row).join('、')}列），請 RD 確認`);
    const hit=hits[0],fromTable=hit&&{west:hit.west,nonWest:hit.nonWest,china:hit.china||hit.nonWest};
    const noteOk=fromNote.nonWest&&fromNote.west;
    if(noteOk&&fromTable&&key(fromNote)!==key(fromTable))throw new Error(`${where}單層備註（西歐/非西歐/中國 ${key(fromNote)}）與第${hit.row}列單層門檻小表（${key(fromTable)}）不一致，請 RD 確認`);
    const main=noteOk?fromNote:fromTable;
    if(!start||!main||!main.west||!main.nonWest)throw new Error(`${where}找不到單層門檻：第${single.row}列（單層）G 欄備註要寫「CTO EDI 尾數單層X台,西歐單層X台,非西歐單層X台」，或在棧板清單放一張含「西歐（單層）」「非西歐（單層）」「中國（單層）」欄、並寫上 SBB 的小表；目前備註：${single.note||'空白'}`);
    const {west:westMain,nonWest:nonWestMain,china:chinaMain}=main,src=noteOk?`第${single.row}列備註`:`第${hit.row}列單層門檻小表`;
    for(const [name,v] of [['西歐',westMain],['非西歐',nonWestMain],['中國',chinaMain]])if(v<=start)throw new Error(`${where}${name}單層門檻 ${v} 台不大於尾數起始 ${start} 台（來源：${src}），區間不合理，請 RD 確認`);
    const rules=[];
    const add=(country,from,to,row)=>rules.push({country,from,to,pn:row.pn,usage:row.pallet,base:row.base,sbb});
    if(double){
      // 雙層起點：有「非西歐尾數訂單X台」備註就照備註；沒有時依既有規則取「主要棧板門檻-1」
      const noteStart=numberFromNote(double.note,'非西歐尾數訂單');
      if(!noteStart&&noteOk)throw new Error(`${where}第${double.row}列（雙層）G 欄備註需寫「非西歐尾數訂單X台」；目前內容：${double.note||'空白'}`);
      const nwDouble=noteStart||nonWestMain-1,cnDouble=noteStart||chinaMain-1;
      if(nwDouble<=start||cnDouble<=start)throw new Error(`${where}雙層起點不大於尾數起始 ${start} 台，請 RD 確認`);
      add('非西歐',start,nwDouble,single);add('非西歐',nwDouble,nonWestMain,double);add('非西歐',nonWestMain,9999,nonWest);add('西歐',start,westMain,single);add('西歐',westMain,9999,west);add('出中國',start,cnDouble,single);add('出中國',cnDouble,chinaMain,double);add('出中國',chinaMain,9999,china)}
    else{add('非西歐',start,nonWestMain,single);add('非西歐',nonWestMain,9999,nonWest);add('西歐',start,westMain,single);add('西歐',westMain,9999,west);add('出中國',start,chinaMain,single);add('出中國',chinaMain,9999,china)}
    return rules;
  }

  function addMapping(wb,p){const ws=getSheet(wb,'Mapping'),seen=existingMtms(ws);const dup=p.mtms.filter(x=>seen.has(x));if(dup.length)throw new Error('Mapping 已存在 MTM：'+dup.join('、'));for(const m of p.mtms)append(ws,[m,p.project,m+'S',ctoPn(m),'V',null],6);return p.mtms.length}
  function addNameSpec(wb,p){const ws=getSheet(wb,'自動加入品名規格');for(const m of p.mtms){const row=append(ws,[m,productName.value.trim(),productSpec.value.trim(),modelCode.value.trim(),marketClass.value.trim(),today(),p.project,'V',p.family],9);row.getCell(6).numFmt='yy/m/d'}return p.mtms.length}
  function addProjectRule(wb,p){if(!p.labelNeeded)return 0;const ws=getSheet(wb,'根據專案加入');for(const m of p.mtms){const row=append(ws,[m,labelPn.value.trim(),Number(labelUsage.value),1,today(),p.family],6);row.getCell(5).numFmt='yy/m/d'}return p.mtms.length}
  function addPallet(wb,p,rules){const ws=getSheet(wb,'自動加棧板設並');let count=0;for(const m of p.mtms)for(const rule of rules){const row=append(ws,[m,rule.kindCode,rule.sbb,rule.country,rule.from,rule.to,rule.pn,rule.usage,rule.base,today(),null,null],12);row.getCell(10).numFmt='yy/m/d';row.getCell(12).value={formula:`VLOOKUP(A${row.number},Mapping!A:E,2,0)`};count++}return count}
  function removeEmptyConditionalFormatting(wb){for(const ws of wb.worksheets)if(Array.isArray(ws.conditionalFormattings))ws.conditionalFormattings=ws.conditionalFormattings.filter(item=>Array.isArray(item.rules)&&item.rules.length)}
  async function graftGeneratedRows(buffer,originalBuffer){
    if(!window.JSZip)throw new Error('Excel 修復元件未載入，請確認網路後重新整理');
    const generated=await JSZip.loadAsync(buffer),output=await JSZip.loadAsync(originalBuffer);
    const sheetPaths=async zip=>{
      const wb=new DOMParser().parseFromString(await zip.file('xl/workbook.xml').async('string'),'application/xml');
      const rels=new DOMParser().parseFromString(await zip.file('xl/_rels/workbook.xml.rels').async('string'),'application/xml');
      const targets=new Map([...rels.getElementsByTagName('Relationship')].map(x=>[x.getAttribute('Id'),x.getAttribute('Target')]));
      return new Map([...wb.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main','sheet')].map(x=>[x.getAttribute('name'),'xl/'+targets.get(x.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'))]));
    };
    const originalPaths=await sheetPaths(output),generatedPaths=await sheetPaths(generated);
    let originalSst=await output.file('xl/sharedStrings.xml').async('string'),generatedSst=await generated.file('xl/sharedStrings.xml').async('string');
    const originalItems=originalSst.match(/<si>[\s\S]*?<\/si>/g)||[],generatedItems=generatedSst.match(/<si>[\s\S]*?<\/si>/g)||[],stringOffset=originalItems.length;
    const projectRuleXml=await output.file(originalPaths.get('根據專案加入')).async('string');
    const dateStyle=[...projectRuleXml.matchAll(/<c\b[^>]*\br="E(\d+)"[^>]*>/g)].sort((a,b)=>Number(b[1])-Number(a[1])).map(x=>(/\bs="(\d+)"/.exec(x[0])||[])[1]).find(Boolean);
    if(dateStyle==null)throw new Error('找不到原檔可沿用的日期格式');
    let addedStringRefs=0;
    for(const sheetName of TARGETS){
      const originalPath=originalPaths.get(sheetName),generatedPath=generatedPaths.get(sheetName);
      if(!originalPath||!generatedPath)throw new Error(`無法定位工作表「${sheetName}」的 XML`);
      let originalXml=await output.file(originalPath).async('string'),generatedXml=await generated.file(generatedPath).async('string');
      const lastOriginal=Math.max(...[...originalXml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].map(x=>Number(x[1])));
      const columnStyles=new Map();
      for(const x of originalXml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*>/g)){
        const col=x[1],row=Number(x[2]),style=(/\bs="(\d+)"/.exec(x[0])||[])[1]||'0',current=columnStyles.get(col);
        if(!current||row>current.row)columnStyles.set(col,{row,style});
      }
      const newRows=[];
      for(const match of generatedXml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g))if(Number(match[1])>lastOriginal){
        const row=match[0].replace(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,cell=>{
          const col=(/\br="([A-Z]+)\d+"/.exec(cell)||[])[1],dateColumn=sheetName==='自動加入品名規格'?'F':sheetName==='自動加棧板設並'?'J':sheetName==='根據專案加入'?'E':null,originalStyle=col===dateColumn?dateStyle:columnStyles.get(col)?.style;
          if(originalStyle==null)throw new Error(`工作表「${sheetName}」欄位 ${col||'?'} 的新增列樣式無法對照`);
          let fixed=/\bs="\d+"/.test(cell)?cell.replace(/\bs="\d+"/,`s="${originalStyle}"`):cell.replace(/<c\b/,`<c s="${originalStyle}"`);
          if(/\bt="s"/.test(fixed)){fixed=fixed.replace(/<v>(\d+)<\/v>/,(_,n)=>`<v>${Number(n)+stringOffset}</v>`);addedStringRefs++}
          return fixed;
        });
        newRows.push(row);
      }
      if(!newRows.length)throw new Error(`工作表「${sheetName}」沒有可追加的新列`);
      const newLast=Math.max(...newRows.map(row=>Number((/\br="(\d+)"/.exec(row)||[])[1])));
      originalXml=originalXml.replace('</sheetData>',newRows.join('')+'</sheetData>').replace(/<dimension ref="([A-Z]+\d+):([A-Z]+)(\d+)"\/>/,(_,start,col,end)=>`<dimension ref="${start}:${col}${Math.max(Number(end),newLast)}"/>`);
      if(sheetName==='自動加入品名規格')originalXml=originalXml.replace(/(<col\b[^>]*\bmin="6"[^>]*\bmax="6"[^>]*\bwidth=")[^"]+("[^>]*>)/,(_,a,b)=>a+'11.875'+b);
      output.file(originalPath,originalXml);
    }
    const baseCount=Number((/\bcount="(\d+)"/.exec(originalSst)||[])[1]||0);
    originalSst=originalSst.replace(/\bcount="\d+"/,`count="${baseCount+addedStringRefs}"`).replace(/\buniqueCount="\d+"/,`uniqueCount="${originalItems.length+generatedItems.length}"`).replace('</sst>',generatedItems.join('')+'</sst>');
    output.file('xl/sharedStrings.xml',originalSst);
    return output.generateAsync({type:'arraybuffer',compression:'DEFLATE'});
  }
  function verify(wb,p,counts){for(const name of TARGETS)getSheet(wb,name);if(counts.mapping!==p.mtms.length||counts.nameSpec!==p.mtms.length||counts.projectRule!==(p.labelNeeded?p.mtms.length:0)||counts.pallet!==p.mtms.length*p.rulesPerMtm)throw new Error('產出筆數與預期不符');return true}
  function download(buffer,name){const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

  window.CtoEdiPallet={parsePalletRules};

  generateBtn.addEventListener('click',async()=>{
    generateBtn.disabled=true;generateStatus.textContent='正在讀取來源並產生候選 Excel…';
    try{
      if(!window.ExcelJS)throw new Error('Excel 元件未載入，請確認網路後重新整理');
      const p=requiredProject(),baseSource=await baseFile.files[0].arrayBuffer(),base=await loadWorkbook(baseSource),rd=await loadWorkbook(rdFile.files[0]);
      const rules=parsePalletRules(rd,p);p.rulesPerMtm=rules.length;
      const counts={mapping:addMapping(base,p),nameSpec:addNameSpec(base,p),projectRule:addProjectRule(base,p),pallet:addPallet(base,p,rules)};
      removeEmptyConditionalFormatting(base);verify(base,p,counts);
      const buffer=await graftGeneratedRows(await base.xlsx.writeBuffer(),baseSource),name=`LBM_EDICTO_${safeName(p.project)}_候選_${dayTag()}.xlsx`;
      download(buffer,name);generateStatus.textContent=`已產生候選檔 ${name}｜Mapping ${counts.mapping}、品名規格 ${counts.nameSpec}、根據專案加入 ${counts.projectRule}、棧板設定 ${counts.pallet}。請人工確認後再發布。`;
      addBtn.click();
    }catch(e){generateStatus.textContent='產生失敗：'+e.message;alert(generateStatus.textContent)}finally{generateBtn.disabled=false}
  });
})();
