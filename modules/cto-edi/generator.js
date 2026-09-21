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
  function parsePalletRules(wb,p){
    const ws=getSheet(wb,'棧板清單'),blocks=[];
    const ctext=(r,c)=>text(ws.getCell(r,c).text||ws.getCell(r,c).value);
    for(let r=1;r<=ws.rowCount;r++){
      if(ctext(r,1)!=='棧板出貨地')continue;
      const type=ctext(r,8);
      if(!/(AI鍵盤|無鍵盤|常規鍵盤)/.test(type))continue;
      let end=r+1;while(end<=ws.rowCount&&ctext(end,1)!=='棧板出貨地')end++;
      const blockMtms=[];
      const rows=[];for(let x=r+1;x<end;x++){
        for(const token of ctext(x,1).toUpperCase().split(/[\r\n,，;；\s]+/))if(/^[A-Z0-9]{4}$/.test(token))blockMtms.push(token);
        rows.push({label:ctext(x,2),pn:ctext(x,3).replace(/\s+/g,''),pallet:Number(ws.getCell(x,5).value||1),base:Number(ws.getCell(x,6).value||1),note:ctext(x,7),sbb:ctext(x,8)});
      }
      const sbb=[...new Set(rows.map(x=>x.sbb).filter(Boolean))].join(',');
      const china=rows.find(x=>x.label==='出中國'),nonWest=rows.find(x=>x.label.startsWith('非西歐')),west=rows.find(x=>x.label.startsWith('西歐')),single=rows.find(x=>x.label.includes('單層')),double=rows.find(x=>x.label.includes('雙層'));
      if(!sbb||!china||!nonWest||!west||!single)throw new Error(`棧板清單「${type}」欄位不完整`);
      const start=Number(ws.getCell(rows.findIndex(x=>x===single)+r+1,4).value||single.base);
      const nonWestMain=numberFromNote(single.note,'非西歐(?:/中國)?\\s*單層');
      const westMain=numberFromNote(single.note,'西歐單層');
      const chinaMain=numberFromNote(single.note,'中國\\s*單層')||nonWestMain;
      if(!start||!nonWestMain||!westMain||!chinaMain)throw new Error(`無法從「${type}」備註解析單層門檻`);
      const rules=[];
      const add=(country,from,to,row)=>rules.push({country,from,to,pn:row.pn,usage:row.pallet,base:row.base,sbb});
      if(double){const doubleStart=numberFromNote(double.note,'非西歐尾數訂單');if(!doubleStart)throw new Error('AI 鍵盤雙層門檻無法解析');add('非西歐',start,doubleStart,single);add('非西歐',doubleStart,nonWestMain,double);add('非西歐',nonWestMain,9999,nonWest);add('西歐',start,westMain,single);add('西歐',westMain,9999,west);add('出中國',start,doubleStart,single);add('出中國',doubleStart,chinaMain,double);add('出中國',chinaMain,9999,china)}
      else{add('非西歐',start,nonWestMain,single);add('非西歐',nonWestMain,9999,nonWest);add('西歐',start,westMain,single);add('西歐',westMain,9999,west);add('出中國',start,chinaMain,single);add('出中國',chinaMain,9999,china)}
      blocks.push({type,rules,mtms:[...new Set(blockMtms)]});
    }
    const selected=blocks.filter(block=>block.mtms.some(m=>p.mtms.includes(m)));
    if(selected.length!==3)throw new Error(`棧板清單應找到本專案 AI／無鍵盤／常規鍵盤 3 個區塊，實際 ${selected.length} 個（本次 MTM：${p.mtms.join(',')}；已辨識區塊：${blocks.slice(-6).map(b=>b.type+'['+b.mtms.join(',')+']').join('／')}）`);
    return selected.flatMap(x=>x.rules.map(rule=>({...rule,kindCode:x.type.includes('AI鍵盤')?1:x.type.includes('無鍵盤')?2:3})));
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
  function verify(wb,p,counts){for(const name of TARGETS)getSheet(wb,name);if(counts.mapping!==p.mtms.length||counts.nameSpec!==p.mtms.length||counts.projectRule!==(p.labelNeeded?p.mtms.length:0)||counts.pallet!==p.mtms.length*20)throw new Error('產出筆數與預期不符');return true}
  function download(buffer,name){const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

  generateBtn.addEventListener('click',async()=>{
    generateBtn.disabled=true;generateStatus.textContent='正在讀取來源並產生候選 Excel…';
    try{
      if(!window.ExcelJS)throw new Error('Excel 元件未載入，請確認網路後重新整理');
      const p=requiredProject(),baseSource=await baseFile.files[0].arrayBuffer(),base=await loadWorkbook(baseSource),rd=await loadWorkbook(rdFile.files[0]);
      const rules=parsePalletRules(rd,p);if(rules.length!==20)throw new Error(`棧板規則應為 20 條／MTM，實際 ${rules.length} 條`);
      const counts={mapping:addMapping(base,p),nameSpec:addNameSpec(base,p),projectRule:addProjectRule(base,p),pallet:addPallet(base,p,rules)};
      removeEmptyConditionalFormatting(base);verify(base,p,counts);
      const buffer=await graftGeneratedRows(await base.xlsx.writeBuffer(),baseSource),name=`LBM_EDICTO_${safeName(p.project)}_候選_${dayTag()}.xlsx`;
      download(buffer,name);generateStatus.textContent=`已產生候選檔 ${name}｜Mapping ${counts.mapping}、品名規格 ${counts.nameSpec}、根據專案加入 ${counts.projectRule}、棧板設定 ${counts.pallet}。請人工確認後再發布。`;
      addBtn.click();
    }catch(e){generateStatus.textContent='產生失敗：'+e.message;alert(generateStatus.textContent)}finally{generateBtn.disabled=false}
  });
})();
