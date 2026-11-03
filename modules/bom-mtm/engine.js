(function(root){'use strict';
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const fail=m=>{throw Error(m)};
const nodes=(d,n)=>Array.from(d.getElementsByTagNameNS(NS,n));
const val=x=>x==null?'':String(x).trim();
function col(n){let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s}
function headers(row,wanted){return wanted.map(h=>{const i=row.findIndex(v=>val(v)===h);if(i<0)fail('缺少欄位：'+h);return i})}
function dateSerial(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)fail('請選擇有效的處理日期');return (Date.parse(date+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000}
async function load(bytes){
 const zip=await root.JSZip.loadAsync(bytes);const parse=s=>new root.DOMParser().parseFromString(s,'application/xml');
 const read=async p=>{if(!zip.file(p))fail('缺少 Excel 元件：'+p);const d=parse(await zip.file(p).async('string'));if(d.getElementsByTagName('parsererror').length)fail('Excel XML 無法解析');return d};
 const wb=await read('xl/workbook.xml'),rels=await read('xl/_rels/workbook.xml.rels');
 const ss=zip.file('xl/sharedStrings.xml')?nodes(await read('xl/sharedStrings.xml'),'si').map(n=>nodes(n,'t').map(t=>t.textContent).join('')):[];
 const sheets=[];
 for(const sh of nodes(wb,'sheet')){
  const id=sh.getAttribute('r:id');const rel=Array.from(rels.documentElement.childNodes).find(n=>n.nodeType===1&&n.getAttribute('Id')===id);if(!rel)fail('工作表連結無法解析');
  const target=rel.getAttribute('Target');const path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');if(path.includes('..'))fail('不支援的工作表路徑');
  const doc=await read(path),rows=[];let last=0;for(const r of nodes(doc,'row')){const n=Number(r.getAttribute('r'))||last+1;if(n<=last||n>1000000)fail('工作表列號重複或超出範圍');while(rows.length<n-1){const blank=doc.createElementNS(NS,'row');blank.setAttribute('r',rows.length+1);rows.push(blank)}rows.push(r);last=n}
  let rowNumber=0;
  const data=rows.map(r=>{const a=[];const rn=Number(r.getAttribute('r'))||rowNumber+1;rowNumber=rn;if(!r.getAttribute('r'))r.setAttribute('r',rn);let previous=0;for(const c of nodes(r,'c')){const ref=c.getAttribute('r');let n=previous+1;if(ref){if(!/^[A-Z]+[1-9]\d*$/.test(ref)||Number(ref.replace(/^[A-Z]+/,''))!==rn)fail('儲存格位置不正確：'+ref);n=0;for(const l of ref.replace(/\d/g,''))n=n*26+l.charCodeAt(0)-64}if(n<=previous)fail('儲存格位置重複或順序錯誤');previous=n;if(!ref)c.setAttribute('r',col(n)+rn);const v=nodes(c,'v')[0]?.textContent;const type=c.getAttribute('t');a[n-1]=type==='s'?ss[Number(v)]:type==='inlineStr'?nodes(c,'t').map(t=>t.textContent).join(''):v==null||v===''?'':type==='b'?v==='1':type==='str'||type==='e'?v:Number(v)}return a});
  sheets.push({name:sh.getAttribute('name'),path,doc,rows,data,dirty:false});
 }
 return {zip,sheets,read,write:async function(){for(const s of sheets)if(s.dirty)zip.file(s.path,new root.XMLSerializer().serializeToString(s.doc));return zip.generateAsync({type:'uint8array',compression:'DEFLATE'})}};
}
function findSheet(book,cols){const found=book.sheets.filter(s=>cols.every(h=>s.data[0]?.some(v=>val(v)===h)));if(found.length!==1)fail('找不到唯一資料工作表：'+cols.join('、'));return found[0]}
function indexBom(sheet){
 const [level,mtm,part]=headers(sheet.data[0],['Level','MTM/Part','Part Number']);const groups=new Map();let current='';
 sheet.data.forEach((r,i)=>{if(!i)return;if(r.every(v=>val(v)===''))fail('BOM 資料區有空白列，請先確認');const m=val(r[mtm]),l=val(r[level]);if(!m)fail('BOM 的 MTM/Part 不可空白');if(l==='0'){if(groups.has(m))fail('MTM 主階重複：'+m);if(val(r[part])!==m)fail('主階料號與 MTM 不一致：'+m);current=m;groups.set(m,[])}else if(!/^\d+$/.test(l)||Number(l)<1||m!==current)fail('BOM 階層與 MTM 不一致：'+m);groups.get(m).push(i)});
 return groups;
}
function exportIssues(book){
 const s=book.sheets.find(s=>s.data[1]?.some(v=>val(v)==='MTM Action'));if(!s)fail('Export 缺少 MTM Action 標題列');
 const [parent,part,action,status,desc]=headers(s.data[1],['Parent<br>Part Number','Part Number','MTM Action','StatusCode','Description']);const issues=new Map();
 for(const r of s.data.slice(2)){
  const a=val(r[action]),st=val(r[status]);if(st!=='ERROR'&&a!=='Ignore')continue;const m=val(r[parent]);if(!m)fail('Export 錯誤列缺少 MTM');
  let kind=a==='Ignore'&&val(r[part])===m?'ignore':val(r[part])===m&&val(r[desc]).includes('已存在PIM')?'existing':'pending';
  const reason=String(r[desc]??'');if(!reason.trim())fail('Export 錯誤列缺少原因：'+m);
  if(!issues.has(m))issues.set(m,{mtm:m,kind,reasons:[]});const issue=issues.get(m);if(issue.kind!==kind)fail('同一 MTM 有不同處理分類：'+m);if(!issue.reasons.includes(reason))issue.reasons.push(reason);
 }
 return issues;
}
function changeType(row,header){
 const i=header.findIndex(v=>val(v).startsWith('_ChangeType'));const raw=i<0?'New':val(row[i]);
 if(raw==='New'||raw==='ChgBom')return raw;fail('無法判定新建／變更類型：'+raw);
}
function plan(bom,exp,staging,manual,date,options={}){
 const bs=findSheet(bom,['Level','MTM/Part','Part Number']),groups=indexBom(bs),issues=exp?exportIssues(exp):new Map();
 const explicit=[...new Set(String(manual||'').split(/[\s,，;；]+/).map(val).filter(Boolean))];
 for(const m of explicit){if(!groups.has(m))fail('指定排除的 MTM 不在 BOM：'+m);if(!issues.has(m))issues.set(m,{mtm:m,kind:'manual',reasons:['使用者指定排除']});issues.get(m).manual=true}
 for(const issue of issues.values()){if(!groups.has(issue.mtm))fail('Export 的 MTM 不在 BOM：'+issue.mtm);issue.excludeBom=issue.manual||['ignore','manual','existing'].includes(issue.kind)}
 if(exp){const es=exp.sheets.find(s=>s.data[1]?.some(v=>val(v)==='MTM Action'));const [pa,pt,pg]=headers(es.data[1],['Parent<br>Part Number','Part Number','ParentGuid']);const roots=es.data.slice(2).filter(r=>!val(r[pg])&&val(r[pa])===val(r[pt])).map(r=>val(r[pa]));if(new Set(roots).size!==roots.length||roots.length!==groups.size||roots.some(m=>!groups.has(m)))fail('Export 與 BOM 主階 MTM 清單不一致')}
 const warnings=[],extras=[],summaryGroups=new Map();let ss=null,si=null,summary=null;
 if(staging){
  dateSerial(date);ss=findSheet(staging,['MTM/PART','MTM Family','備註']);si=headers(ss.data[0],['MTM/PART','MTM Family','(GETC/ECR Close 時間)','備註','Upload']);
  const seen=new Set();for(let i=1;i<ss.data.length;i++){const r=ss.data[i],m=val(r[si[0]]);if(!m||seen.has(m))fail('待貼入 MTM／PN 空白或重複：'+m);seen.add(m);
   if(!groups.has(m)){extras.push({mtm:m,row:i+1,reason:'不在 BOM 主階清單，原列完整保留，另待人工確認／申請'});continue}
   const issue=issues.get(m);if(issue&&val(r[si[3]])&&String(r[si[3]])!==issue.reasons.join('\n'))fail('待貼入已有不同備註，請人工確認：'+m);if(issue&&val(r[si[4]]))fail('異常 MTM 已有 Upload 標記，請人工確認：'+m);
   const type=changeType(r,ss.data[0]),project=val(r[si[1]]);if(!project)fail('MTM 缺少專案：'+m);const key=JSON.stringify([project,type]);if(!summaryGroups.has(key))summaryGroups.set(key,{project,type,mtms:[]});summaryGroups.get(key).mtms.push(m);
  }
  if([...groups.keys()].some(m=>!seen.has(m)))fail('BOM 與待貼入 MTM 清單不一致');
  if(extras.length)warnings.push('另有 '+extras.length+' 筆未對應 BOM 主階的 PN／資料：'+extras.map(x=>x.mtm).join('、')+'；不計入 MTM，需勾選保留後才能產檔。');
  summary=findSheet(staging,['Project Name','EIP導入數','EIP排除數','MTM清單']);
  const q=headers(summary.data[0],['數量'])[0],old=summary.data.slice(1).filter(r=>val(r[0])&&val(r[0])!=='郵件主旨').reduce((n,r)=>n+(Number(r[q])||0),0);
  const newCount=[...summaryGroups.values()].filter(g=>g.type==='New').reduce((n,g)=>n+g.mtms.length,0);
  if(newCount!==groups.size)warnings.push('本批新建 '+newCount+' 個，含變更共 '+groups.size+' 個 MTM；Summary 將分開保留新建／變更。');
  if(old!==groups.size&&old!==newCount)warnings.push('原 Summary '+old+' 個 MTM，明細 '+groups.size+' 個；下載時按新建／變更分組對帳。');
  const sp=ss.data[0].findIndex(v=>['SPB MTM判定','SPB MTM與否'].includes(val(v)));if(sp>=0&&ss.data.slice(1).some(r=>val(r[sp])==='V'))warnings.push('原 SPB 欄含 V，保留原值；未重新判定 SPB，Summary 類型沿用來源。');
 }
 const entries=[...issues.values()].map(i=>({...i,rows:groups.get(i.mtm).length,reason:i.reasons.join('\n')}));
 return {bs,groups,issues,entries,ss,si,summary,summaryGroups,extras,preserveUnmatched:options.preserveUnmatched===true,date,warnings,originalRows:[...groups.values()].reduce((n,r)=>n+r.length,0),removedRows:entries.filter(i=>i.excludeBom).reduce((n,i)=>n+i.rows,0),mtmCount:groups.size};
}
function setCell(s,rowIndex,column,value,style){
 const row=s.rows[rowIndex];if(!row)fail('缺少目的列');if(!row.parentNode){const data=nodes(s.doc,'sheetData')[0],next=s.rows.slice(rowIndex+1).find(r=>r.parentNode===data);data.insertBefore(row,next||null)}const addr=col(column+1)+row.getAttribute('r');let c=nodes(row,'c').find(c=>c.getAttribute('r')===addr);
 if(!c){c=s.doc.createElementNS(NS,'c');c.setAttribute('r',addr);const following=nodes(row,'c').find(x=>{const a=x.getAttribute('r').replace(/\d/g,'');return a.length>col(column+1).length||a.length===col(column+1).length&&a>col(column+1)});row.insertBefore(c,following||null)}
 while(c.firstChild)c.removeChild(c.firstChild);c.removeAttribute('t');if(style!==undefined)c.setAttribute('s',style);
 if(typeof value==='number'){const v=s.doc.createElementNS(NS,'v');v.textContent=String(value);c.appendChild(v)}else{c.setAttribute('t','inlineStr');const is=s.doc.createElementNS(NS,'is'),t=s.doc.createElementNS(NS,'t');t.setAttribute('xml:space','preserve');t.textContent=String(value);is.appendChild(t);c.appendChild(is)}s.dirty=true;
}
async function styles(book){
 const doc=await book.read('xl/styles.xml'),xfs=nodes(doc,'cellXfs')[0],fonts=nodes(doc,'fonts')[0];const cache=new Map();
 function get(base,kind){const key=base+':'+kind;if(cache.has(key))return cache.get(key);const original=Array.from(xfs.childNodes).filter(n=>n.nodeType===1)[Number(base)||0];const xf=original.cloneNode(true);
  if(kind==='date'){const nfs=nodes(doc,'numFmts')[0]||doc.documentElement.insertBefore(doc.createElementNS(NS,'numFmts'),doc.documentElement.firstChild);let id=164;const used=new Set(nodes(nfs,'numFmt').map(n=>Number(n.getAttribute('numFmtId'))));while(used.has(id))id++;const nf=doc.createElementNS(NS,'numFmt');nf.setAttribute('numFmtId',id);nf.setAttribute('formatCode','yyyy/mm/dd');nfs.appendChild(nf);nfs.setAttribute('count',nodes(nfs,'numFmt').length);xf.setAttribute('numFmtId',id);xf.setAttribute('applyNumberFormat','1')}
  else{if(kind==='pending'){const f=Array.from(fonts.childNodes).filter(n=>n.nodeType===1)[Number(xf.getAttribute('fontId'))||0].cloneNode(true);for(const c of nodes(f,'color'))c.parentNode.removeChild(c);const color=doc.createElementNS(NS,'color');color.setAttribute('rgb','FFFF0000');f.appendChild(color);xf.setAttribute('fontId',Array.from(fonts.childNodes).filter(n=>n.nodeType===1).length);fonts.appendChild(f);fonts.setAttribute('count',nodes(fonts,'font').length);xf.setAttribute('applyFont','1')}let align=nodes(xf,'alignment')[0];if(!align){align=doc.createElementNS(NS,'alignment');xf.appendChild(align)}if(kind==='pending')align.setAttribute('horizontal','center');else{align.setAttribute('wrapText','1');align.setAttribute('vertical','top')}xf.setAttribute('applyAlignment','1')}
  const idx=Array.from(xfs.childNodes).filter(n=>n.nodeType===1).length;xfs.appendChild(xf);xfs.setAttribute('count',idx+1);cache.set(key,String(idx));return String(idx)
 }
 return {get,save(){book.zip.file('xl/styles.xml',new root.XMLSerializer().serializeToString(doc))}};
}
function baseStyle(s,r,c){return nodes(s.rows[r],'c').find(n=>n.getAttribute('r')===col(c+1)+s.rows[r].getAttribute('r'))?.getAttribute('s')||'0'}
async function apply(bom,staging,p){
 if(p.extras.length&&!p.preserveUnmatched)fail('請先明確勾選保留未對應 BOM 的 PN／資料');
 const remove=new Set(p.entries.filter(i=>i.excludeBom).flatMap(i=>p.groups.get(i.mtm)));
 if(remove.size){
  if(bom.sheets.some(s=>nodes(s.doc,'f').length)||nodes(p.bs.doc,'mergeCell').length||nodes(p.bs.doc,'tablePart').length||nodes(p.bs.doc,'pivotTablePart').length||nodes(p.bs.doc,'conditionalFormatting').length||nodes(p.bs.doc,'dataValidation').length||nodes(p.bs.doc,'hyperlink').length||nodes(p.bs.doc,'drawing').length||nodes(p.bs.doc,'legacyDrawing').length)fail('BOM 含公式、合併或關聯物件，需人工處理以保留相依內容');
  const wb=await bom.read('xl/workbook.xml');if(nodes(wb,'definedName').length)fail('BOM 含命名範圍，需人工處理');
  let shift=0;for(let i=1;i<p.bs.rows.length;i++){const r=p.bs.rows[i];if(remove.has(i)){r.parentNode.removeChild(r);shift++}else{const n=Number(r.getAttribute('r'))-shift;r.setAttribute('r',n);for(const c of nodes(r,'c'))c.setAttribute('r',c.getAttribute('r').replace(/\d+$/,n))}}
  for(const n of [...nodes(p.bs.doc,'dimension'),...nodes(p.bs.doc,'autoFilter')]){const ref=n.getAttribute('ref');n.setAttribute('ref',ref.replace(/(\d+)$/,x=>String(Number(x)-remove.size)))}p.bs.dirty=true;
 }
 if(staging){
  const wb=await staging.read('xl/workbook.xml');const props=nodes(wb,'workbookPr')[0];if(props&&['1','true'].includes(props.getAttribute('date1904')))fail('待貼入使用1904日期系統，需人工確認');if(nodes(p.summary.doc,'tablePart').length)fail('Summary 含結構化表格，需人工確認新增欄位');
  const st=await styles(staging),s=p.ss,[mtm,project,close,note]=p.si;
  for(let i=1;i<s.data.length;i++){const issue=p.issues.get(val(s.data[i][mtm]));if(!issue)continue;const ignored=issue.kind==='ignore';setCell(s,i,close,ignored?dateSerial(p.date):'confirming',st.get(baseStyle(s,i,close),ignored?'date':'pending'));setCell(s,i,note,issue.reasons.join('\n'),st.get(baseStyle(s,i,note),'note'));s.rows[i].setAttribute('ht',Math.max(Number(s.rows[i].getAttribute('ht'))||15,60));s.rows[i].setAttribute('customHeight','1')}
  const sum=p.summary;const [proj,qty,imp,exc,list,remark]=headers(sum.data[0],['Project Name','數量','EIP導入數','EIP排除數','MTM清單','備註']);
  let pending=sum.data[0].findIndex(v=>val(v)==='EIP待確認數');if(pending<0){pending=sum.data[0].length;setCell(sum,0,pending,'EIP待確認數',baseStyle(sum,0,exc));let cols=nodes(sum.doc,'cols')[0];if(!cols){cols=sum.doc.createElementNS(NS,'cols');sum.doc.documentElement.insertBefore(cols,nodes(sum.doc,'sheetData')[0])}const c=sum.doc.createElementNS(NS,'col');c.setAttribute('min',pending+1);c.setAttribute('max',pending+1);c.setAttribute('width','17');c.setAttribute('customWidth','1');cols.appendChild(c)}
  const change=headers(sum.data[0],['異動'])[0],typeCol=headers(sum.data[0],['類型'])[0];const matched=new Set(),free=[];
  for(let i=1;i<sum.data.length;i++){if(sum.data[i].every(v=>!val(v))){free.push(i);continue}const name=val(sum.data[i][proj]);if(!name||name==='郵件主旨')continue;const tag=val(sum.data[i][change]);if(!['新增','變更'].includes(tag))fail('Summary 異動類型不明：'+tag);const key=JSON.stringify([name,tag==='變更'?'ChgBom':'New']);if(matched.has(key)||!p.summaryGroups.has(key))fail('Summary 分組重複或無對應明細：'+name);matched.add(key);p.summaryGroups.get(key).summaryRow=i}
  for(const [key,g] of p.summaryGroups){let i=g.summaryRow;if(i===undefined){i=free.shift();if(i===undefined)fail('Summary 缺少空白列放置變更 BOM，請先補空白列');for(let c=0;c<=pending;c++)setCell(sum,i,c,'',baseStyle(sum,1,Math.min(c,sum.data[0].length-1)));setCell(sum,i,proj,g.project);setCell(sum,i,change,g.type==='ChgBom'?'變更':'新增');setCell(sum,i,typeCol,g.type==='ChgBom'?'Change BOM':'NEW MTM BOM')}
   const mtms=g.mtms,excluded=mtms.filter(m=>p.issues.get(m)?.kind==='ignore'),wait=mtms.filter(m=>g.type==='ChgBom'||['pending','existing','manual'].includes(p.issues.get(m)?.kind));
   if(excluded.some(m=>wait.includes(m)))fail('變更 BOM 與不需建立狀態衝突，請人工確認');
   setCell(sum,i,qty,mtms.length);setCell(sum,i,imp,mtms.length-excluded.length-wait.length);setCell(sum,i,exc,excluded.length);setCell(sum,i,list,mtms.join(', '));setCell(sum,i,pending,wait.length,baseStyle(sum,i,exc));
   const old=val(sum.data[i]?.[remark]),detail=mtms.filter(m=>p.issues.has(m)).map(m=>m+'：'+p.issues.get(m).reasons.join('\n')).join('\n');setCell(sum,i,remark,[old,g.type==='ChgBom'?'Change BOM 保留變更追蹤，待 RD／EIP 確認。':'EIP導入數為本批候選數，非成功證明；待確認數另列。',detail].filter(Boolean).join('\n'),st.get(baseStyle(sum,i,remark),'note'));
  }
  for(let i=1;i<s.data.length;i++)if(p.groups.has(val(s.data[i][mtm]))&&changeType(s.data[i],s.data[0])==='ChgBom')setCell(s,i,close,'confirming',st.get(baseStyle(s,i,close),'pending'));
  const dim=nodes(sum.doc,'dimension')[0];if(dim)dim.setAttribute('ref','A1:'+col(pending+1)+sum.rows.length);st.save();
 }
 return {bom:await bom.write(),staging:staging?await staging.write():null};
}
root.BomMtm={load,plan,apply,dateSerial,version:'0.1.2'};
})(typeof window==='undefined'?globalThis:window);
