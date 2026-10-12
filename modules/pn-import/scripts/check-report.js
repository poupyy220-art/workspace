(function(g){
'use strict';
const esc=v=>String(v??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s};
const dateTag=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
function advice(issue){
 const r=String(issue.reason||''),f=String(issue.field||'此欄位'),where=issue.sheet&&issue.row?`「${issue.sheet}」頁第 ${issue.row} 列`: '來源資料';
 if(/找不到來源欄位|同名欄位|表頭|欄位辨識/.test(r))return '此項可能是表頭辨識問題。請先由處理人員核對來源表頭與合併儲存格，不要直接要求 RD 重填資料。';
 if(/長度超過30/.test(r))return `請 RD 修改 ${where}的「${f}」，縮短至公司規定的 30 字元內；內容如何縮寫由 RD 確認，工具不代為刪改。`;
 if(/不合規符號|全型字/.test(r))return `請 RD 檢查 ${where}的「${f}」，移除或改正公司系統不接受的符號／全型字，再重新送檢。`;
 if(/請 RD 補齊明細/.test(r))return `請 RD 直接在 ${where}補填「${f}」；不要只補封面，也不要由工具猜填。`;
 if(/公式|Excel 錯誤/.test(r))return `請在 Microsoft Excel 檢查 ${where}的公式或錯誤值，完成重算並另存 XLSX 副本後重新檢查。`;
 if(/階層|跳階|Item Level/.test(r))return `請先確認申請類型，再由 RD 核對 ${where}的 BOM 階層；第一筆須為 Level 1，向下不可一次跳超過一階。`;
 if(issue.field==='Class Code'&&issue.severity==='WARNING')return `此列 Class Code 可維持空白，但請 RD／處理人員確認；工具不提供猜測值，也不自動補值。`;
 if(issue.field==='Class Code')return `請 RD 依本次有效代碼表修正 ${where}的 Class Code；不可使用猜測值。`;
 if(issue.field==='新/舊料'||/NEW\/OLD|NEW／OLD/.test(r))return `請 RD 確認 ${where}應為 NEW 或 OLD，避免套用錯誤的必填與補值規則。`;
 if(issue.field==='規格')return `請 RD 補填 ${where}的規格；若業務允許留白，須提供確認人、日期與確認內容。`;
 if(/Basic Name 不一致|Key/.test(r))return `請 RD 核對 ${where}的 Basic Name 與軟體 Key 類型；工具會保留原值，不自行選擇。`;
 if(/預設補值驗證失敗/.test(r))return '這是工具處理異常，請停止使用本次輸出並交由流程維護人員檢查，不要要求 RD 猜填。';
 return `請 RD／處理人員核對 ${where}的「${f}」及問題原因，修正來源明細後重新執行檢查。`;
}
function tables(result,meta={}){
 const issues=result.issues||[],warnings=result.warnings||[],problems=[...issues,...warnings],changes=result.changes||[],now=meta.checkedAt||new Date();
 const groups=new Map();for(const x of problems){const k=JSON.stringify([x.field,x.reason,x.severity]);const item=groups.get(k)||{field:x.field,reason:x.reason,severity:x.severity,count:0};item.count++;groups.set(k,item)}
 const unique=new Set(problems.map(x=>JSON.stringify([x.sheet,x.row])));
 const rangeEntries=Object.entries(meta.ranges||{}).filter(([,t])=>t),hasRange=rangeEntries.length>0||!!(meta.rowStart&&meta.rowEnd);
 const rangeLabel=rangeEntries.length?rangeEntries.map(([n,t])=>`「${n}」第 ${t.replace(/-/g,'～')} 列`).join('；')+'；其餘勾選頁為整頁':meta.rowStart&&meta.rowEnd?`Excel 第 ${meta.rowStart}～${meta.rowEnd} 列`:'整張明細';
 const noted=problems.filter(x=>x.sourceNote!==undefined),count=s=>noted.filter(x=>x.sourceNote===s).length;
 const coverage=noted.length?[['原始頁已加備註',count('已加備註'),'可定位且已在原始頁該格加 Excel 備註。'],['原始頁已有備註未追加',count('原頁已有備註，未追加')+count('原頁已有舊式繪圖物件，未追加備註')+count('工作表含大量空白格式列，為保護原檔未加備註'),'該頁原本有備註或舊式繪圖，為保護原檔未追加；請依「異常報表」處理。'],['無對應儲存格',count('無對應儲存格（原檔無此欄或為表頭層級）'),'原檔沒有該欄或屬表頭層級，只列在報告中。']]:[];
 const state=issues.length?'有阻擋事項':warnings.length?'規則通過，另有人工確認標記':'規則檢查通過';
 const blockers=Array.from(groups.values()).filter(x=>x.severity!=='WARNING').sort((a,b)=>b.count-a.count),manual=Array.from(groups.values()).filter(x=>x.severity==='WARNING').sort((a,b)=>b.count-a.count);
 const verdict=issues.length?['❌ 有 '+issues.length+' 項阻擋，須 RD 修改後重新檢查','先看「異常報表」最上面的紅色列；匯入草稿暫停下載。']:warnings.length?['⚠ 規則通過，另有 '+warnings.length+' 項人工確認','看「異常報表」的黃色列確認後即可使用匯入草稿；黃色不會擋草稿。']:['✅ 規則檢查通過','可下載匯入草稿；通過不代表公司系統一定接受。'];
 const summary=[['項目／問題欄位','數量／值','說明'],['結論',verdict[0],verdict[1]],['阻擋問題數',issues.length,'阻擋匯入草稿下載。'],['人工確認標記數',warnings.length,'只標記，不猜測、不補值，也不單獨阻擋草稿。'],...(meta.draftRequested?[['匯入草稿頁',meta.draftIncluded?'已附':'未附',meta.draftIncluded?'「匯入草稿」頁是對照用副本，內容與單獨下載的匯入草稿相同；匯入公司系統請使用單獨下載的草稿檔。':'有阻擋問題，未產生匯入草稿；請處理阻擋問題後重新檢查。']]:[]),
  ...(blockers.length||manual.length?[['▼ 要處理的問題（依欄位）','','']]:[]),...blockers.map(x=>[x.field,x.count,'阻擋：'+x.reason]),...manual.map(x=>[x.field,x.count,'人工確認：'+x.reason]),
  ['▼ 檢查資訊','',''],['檢查時間',now,'本機時間'],['來源檔案',meta.sourceName||'','僅供本機追溯'],['申請類型',meta.mode==='bom'?'BOM 組裝':meta.mode==='standalone'?'各別單獨料號':'未指定',''],['檢查狀態',state,'通過不代表公司系統接受；本報表不是匯入草稿。'],['本次資料列範圍',rangeLabel,hasRange?'每張頁只處理指定的列；範圍外的歷史資料不檢查、不補值、不列入報告。':'未指定範圍，會檢查整張明細。'],['涉及來源位置數',unique.size,'按頁籤＋列號去重，可能包含表頭；不是異常料件筆數。'],['自動處理處數',changes.length,'補值只存在處理結果，未修改來源 Excel。'],['是否有自動處理變更',changes.length?'有':'無','詳情見「自動補值紀錄」；來源原檔不會被修改。'],['處理輸出筆數',(result.output||[]).length,'僅為本次引擎輸出筆數，不是來源總筆數或略過筆數。'],...(meta.cleanedPages?.length?[['已移除舊報告頁',meta.cleanedPages.join('、'),'來源檔是上次產出的報表；舊的報告頁已移除，只保留本次結果。']]:[]),...(meta.cleanedNotes?[['已清除上次工具備註',meta.cleanedNotes,'只清除工具上次加的備註（[BLOCKER]／[WARNING]…詳見「異常報表」）；RD 或使用者的備註保留。']]:[]),...coverage];
 const summaryKinds=summary.map((r,i)=>i===0?'header':i===1?(issues.length?'blockerAll':warnings.length?'warningAll':'infoAll'):String(r[0]).startsWith('▼')?'sectionHeader':'normal');
 const order=x=>x.severity==='WARNING'?1:0,sorted=problems.map((x,i)=>[x,i]).sort((a,b)=>order(a[0])-order(b[0])||a[1]-b[1]).map(x=>x[0]);
 const blank=()=>['','','','','','','','','',''];
 const banner=problems.length?'阻擋 '+issues.length+' 項（紅色，須 RD 修改後重新檢查）｜人工確認 '+warnings.length+' 項（黃色，不擋草稿）｜顏色與規則說明在本頁最下方':'沒有任何問題。顏色與規則說明在本頁最下方。';
 const details=[
  [banner,'','','','','','','','',''],
  ['分頁名稱','Excel 行號','欄位名稱','嚴重度','卡關原因','目前內容','修改後內容','建議處理方式','原始頁標註','標註儲存格'],
  ...sorted.map(x=>[x.sheet,x.row,x.field,x.severity==='WARNING'?'WARNING':'BLOCKER',x.reason,x.currentValue??'',x.processedValue??x.currentValue??'',advice(x),x.sourceNote??'',x.sourceCells??'']),
  blank(),
  ['📋 顏色與規則說明','','','','','','','','',''],
  ['淡紅底＋深紅字','BLOCKER（阻擋）：非法符號、全型字、長度超過 30、必填缺漏、Level 1 或 BOM 階層跳階等。必須修復來源資料後再重新檢查。','','','','','','','',''],
  ['淡黃底＋棕字','WARNING（人工確認）：系統判定為 NEW 的料號、狀態及品名／規格；需人工確認，但不會單獨阻擋。原檔既有黃色不代表系統判定 NEW。','','','','','','','',''],
  ['淡藍底＋藍字','資訊提示：欄位辨識 fallback、代碼轉換等非卡關資訊；建議確認，但不一定需要修改。','','','','','','','',''],
  ['⚠ 原始 BOM 分頁的值、公式與格式（含底色）完整保留；可定位的問題格只加 Excel 備註，見「原始頁標註」欄。','','','','','','','','','']
 ];
 const end=details.length,detailEnd=2+sorted.length,legendStart=detailEnd+2;
 const audit=[['序號','來源頁籤','Excel 列號','欄位','原值','新值','補值／處理原因'],...changes.map((x,i)=>[i+1,x.sheet,x.row,x.field,x.before??'',x.after??'',x.reason])];
 const problemColor=issues.length?'FFFF6666':warnings.length?'FFFFC000':'FF70AD47';
 return [{name:'問題摘要',rows:summary,widths:[28,46,80],tabColor:problemColor,headerRow:1,rowKinds:summaryKinds,heights:{2:30}},{name:'異常報表',rows:details,widths:[16,10,16,11,42,34,34,60,22,12],tabColor:problemColor,headerRow:2,filterEnd:Math.max(detailEnd,2),rowKinds:['note','header',...sorted.map(x=>x.severity==='WARNING'?'warningDetail':'blockerDetail'),'blank','sectionHeader','blocker','warning','info','note'],heights:{1:30},merges:['A1:J1',`A${legendStart}:J${legendStart}`,`B${legendStart+1}:J${legendStart+1}`,`B${legendStart+2}:J${legendStart+2}`,`B${legendStart+3}:J${legendStart+3}`,`A${end}:J${end}`]},{name:'自動補值紀錄',rows:audit,widths:[8,22,14,24,42,42,65],tabColor:changes.length?'FF5B9BD5':'FFA5A5A5',headerRow:1}];
}
function cell(v,r,c,headerRow=1){
 const ref=col(c)+(r+1),style=(r===0||r===headerRow-1)?1:v instanceof Date?2:0;
 if(v instanceof Date){const serial=(Date.UTC(v.getFullYear(),v.getMonth(),v.getDate(),v.getHours(),v.getMinutes(),v.getSeconds())-Date.UTC(1899,11,30))/86400000;return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`}
 if(typeof v==='number'&&Number.isFinite(v))return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
 if(typeof v==='boolean')return `<c r="${ref}" s="${style}" t="b"><v>${v?1:0}</v></c>`;
 return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}
const xml=s=>{const d=new DOMParser().parseFromString(s,'application/xml');if(d.getElementsByTagNameNS('*','parsererror').length)throw Error('Excel XML 無法解析，請先用 Excel 另存副本');return d};
const nodes=(d,n)=>Array.from(d.getElementsByTagNameNS('*',n));
function addNode(doc,parent,name,attrs={}){const n=doc.createElementNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main',name);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));parent.append(n);return n}
function uniqueNames(source,tabs){const used=new Set(source.sheets.map(s=>s.name.toLowerCase()));return tabs.map(t=>{let name=t.name,n=2;while(used.has(name.toLowerCase()))name=(t.name.slice(0,28)+'_'+n++).slice(0,31);used.add(name.toLowerCase());return{...t,name}})}
function reportStyles(styles){
 const fonts=nodes(styles,'fonts')[0],fills=nodes(styles,'fills')[0],borders=nodes(styles,'borders')[0],xfs=nodes(styles,'cellXfs')[0];
 if(!fonts||!fills||!borders||!xfs)throw Error('來源活頁簿樣式表不完整，無法安全加入標記');
 const font=(bold=false,color='')=>{const f=addNode(styles,fonts,'font');if(bold)addNode(styles,f,'b');addNode(styles,f,'sz',{val:10});addNode(styles,f,'name',{val:'Comic Sans MS'});if(color)addNode(styles,f,'color',{rgb:color});return nodes(fonts,'font').length-1};
 const fill=color=>{const f=addNode(styles,fills,'fill'),p=addNode(styles,f,'patternFill',{patternType:'solid'});addNode(styles,p,'fgColor',{rgb:color});addNode(styles,p,'bgColor',{indexed:64});return nodes(fills,'fill').length-1};
 const border=()=>{const b=addNode(styles,borders,'border');for(const side of ['left','right','top','bottom']){const x=addNode(styles,b,side,{style:'thin'});addNode(styles,x,'color',{rgb:'FFD0D0D0'})}addNode(styles,b,'diagonal');return nodes(borders,'border').length-1};
 const normalFont=font(),boldFont=font(true),whiteBoldFont=font(true,'FFFFFFFF'),yellow=fill('FFFFFFCC'),red=fill('FFF4CCCC'),amber=fill('FFFFF2CC'),blue=fill('FFDDEBF7'),navy=fill('FF1F4E78'),noteFill=fill('FFFFEB9C'),thin=border();
 const xf=(fontId,fillId,numFmtId=0)=>{const x=addNode(styles,xfs,'xf',{numFmtId,fontId,fillId,borderId:thin,xfId:0,applyAlignment:1,applyNumberFormat:1,applyBorder:1,applyFont:1,applyFill:1});addNode(styles,x,'alignment',{vertical:'top',wrapText:1});return nodes(xfs,'xf').length-1};
 const result={normal:xf(normalFont,0),header:xf(boldFont,yellow),date:xf(normalFont,0,14),title:xf(boldFont,blue),sectionHeader:xf(whiteBoldFont,navy),warning:xf(normalFont,amber),blocker:xf(normalFont,red),info:xf(normalFont,blue),note:xf(boldFont,noteFill),warningDetail:xf(normalFont,amber),blockerDetail:xf(normalFont,red),red,amber,xfs,marked:new Map()};
 for(const group of [fonts,fills,borders,xfs])group.setAttribute('count',String(Array.from(group.children).length));
 return result;
}
// 原始頁只加 Excel 傳統備註，不改任何儲存格、底色或樣式；原頁已有備註或舊式繪圖時不追加。
const NS_MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main',NS_REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships',NS_PKG='http://schemas.openxmlformats.org/package/2006/relationships',NS_CT='http://schemas.openxmlformats.org/package/2006/content-types';
const REL_COMMENTS=NS_REL+'/comments',REL_VML=NS_REL+'/vmlDrawing';
const NOTE_LARGE='工作表含大量空白格式列，為保護原檔未加備註',NOTE_ADDED='已加備註',NOTE_EXISTING='原頁已有備註，未追加',NOTE_LEGACY='原頁已有舊式繪圖物件，未追加備註',NOTE_NONE='無對應儲存格（原檔無此欄或為表頭層級）';
const AFTER_LEGACY=['legacyDrawingHF','drawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst'];
function relsPathOf(path){const i=path.lastIndexOf('/');return path.slice(0,i+1)+'_rels/'+path.slice(i+1)+'.rels'}
function uniquePath(zip,make){let n=1,p;do p=make(n++);while(zip.file(p));return p}
function relTarget(from,to){const a=from.split('/').slice(0,-1),b=to.split('/');let i=0;while(i<a.length&&i<b.length-1&&a[i]===b[i])i++;return '../'.repeat(a.length-i)+b.slice(i).join('/')}
function noteText(list){return [...list.map(p=>`[${p.severity==='WARNING'?'WARNING':'BLOCKER'}] ${p.field||''}：${p.reason||''}`),'詳見「異常報表」'].join('\n')}
function commentsXml(cells){return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<comments xmlns="${NS_MAIN}"><authors><author>pn-bom-import</author></authors><commentList>${cells.map(x=>`<comment ref="${x.ref}" authorId="0"><text><r><rPr><sz val="9"/><rFont val="Tahoma"/></rPr><t xml:space="preserve">${esc(x.text)}</t></r></text></comment>`).join('')}</commentList></comments>`}
const MAX_ROW=1048576,MAX_COL=16384;
const inSheet=(r,c)=>Number.isInteger(r)&&r>0&&r<=MAX_ROW&&Number.isInteger(c)&&c>0&&c<=MAX_COL;
// VML 形狀編號：每個 idmap 區段 1024 個；先掃描既有 VML 已用區段，再依本頁備註數保留足夠的連續區段，避免跨 part 重號。
// 掃描對象：所有 .vml，以及任何關聯（不論檔名）指向的 vmlDrawing 零件
async function vmlParts(zip){
 const names=new Set(Object.keys(zip.files).filter(x=>!x.endsWith('/')&&/\.vml$/i.test(x)));
 for(const relName of Object.keys(zip.files).filter(x=>/\.rels$/i.test(x))){
  // 用 XML 解析（命名空間感知）：不論前綴、單雙引號或跳脫字元寫法都能正確讀到關聯
  const dir=relName.replace(/_rels\/[^/]*\.rels$/i,'');let doc;try{doc=xml(await zip.file(relName).async('string'))}catch{continue}
  for(const r of nodes(doc,'Relationship')){
   if(!/\/vmlDrawing$/.test(r.getAttribute('Type')||'')||(r.getAttribute('TargetMode')||'')==='External')continue;const t=r.getAttribute('Target');if(!t)continue;
   const parts=[];for(const s of (t.startsWith('/')?t.slice(1):dir+t).split('/')){if(s==='..')parts.pop();else if(s&&s!=='.')parts.push(s)}const p=parts.join('/');if(zip.file(p))names.add(p)}
 }
 return [...names];
}
async function usedIdmaps(zip){
 const used=new Set();
 for(const name of await vmlParts(zip)){
  const text=await zip.file(name).async('string');
  // VML 常不是嚴格 XML，維持文字掃描，但接受單雙引號與任何前綴
  for(const m of text.matchAll(/idmap\b[^>]*\bdata\s*=\s*(["'])([^"']*)\1/gi))for(const n of m[2].split(','))if(/^\d+$/.test(n.trim()))used.add(Number(n.trim()));
  for(const m of text.matchAll(/_x0000_s(\d+)/g))used.add(Math.floor((Number(m[1])-1)/1024));
 }
 return used;
}
function reserveIdmaps(used,count){const out=[];let n=101;while(out.length<count){if(!used.has(n)){used.add(n);out.push(n)}n++}return out}
// 備註框位置（0 起算欄列）：預設在儲存格右下方 4 欄 × 5 列；靠近工作表邊界時往內移，左上永遠不大於右下
function noteAnchor(x){const left=Math.min(x.c+1,MAX_COL-4),top=Math.min(Math.max(0,x.r-1),MAX_ROW-5);return [left,15,top,10,left+3,15,top+4,4]}
function vmlXml(cells,blocks){const anchor=x=>noteAnchor(x).join(', ');return `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${blocks.join(',')}"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>${cells.map((x,i)=>`<v:shape id="_x0000_s${blocks[Math.floor(i/1024)]*1024+i%1024+1}" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:216pt;height:72pt;z-index:${i+1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${anchor(x)}</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${x.r}</x:Row><x:Column>${x.c}</x:Column></x:ClientData></v:shape>`).join('')}</xml>`}
// 問題可對應的所有儲存格（Item Level 衝突時會有多格）
const cellsOf=p=>[Number(p.col),...(p.extraCols||[]).map(Number)].filter((c,i,a)=>inSheet(Number(p.row),c)&&a.indexOf(c)===i);
async function annotateSource(source,zip,result,types){
 const problems=[...(result.issues||[]),...(result.warnings||[])],used=await usedIdmaps(zip);
 for(const p of problems){p.sourceNote=NOTE_NONE;p.sourceCells=''}
 for(const sheet of source.sheets){
  const list=problems.filter(p=>p.sheet===sheet.name&&cellsOf(p).length);if(!list.length)continue;
  const relsPath=relsPathOf(sheet.path),relsFile=zip.file(relsPath),rels=relsFile?xml(await relsFile.async('string')):xml(`<Relationships xmlns="${NS_PKG}"/>`),relNodes=nodes(rels,'Relationship');
  const sheetDoc=sheet.xml.cloneNode(true),root=sheetDoc.documentElement;
  const skip=note=>{for(const p of list){p.sourceNote=note;p.sourceCells=cellsOf(p).map(c=>col(c-1)+Number(p.row)).join(',')}};
  if(sheet.trimmed){skip(NOTE_LARGE);continue}
  if(relNodes.some(x=>(x.getAttribute('Type')||'')===REL_COMMENTS||/\/threadedComment$/.test(x.getAttribute('Type')||''))){skip(NOTE_EXISTING);continue}
  if(nodes(sheetDoc,'legacyDrawing').length||relNodes.some(x=>(x.getAttribute('Type')||'')===REL_VML)){skip(NOTE_LEGACY);continue}
  const byCell=new Map();for(const p of list)for(const c of cellsOf(p)){const ref=col(c-1)+Number(p.row);if(!byCell.has(ref))byCell.set(ref,{ref,r:Number(p.row)-1,c:c-1,items:[]});byCell.get(ref).items.push(p)}
  const cells=Array.from(byCell.values()).sort((a,b)=>a.r-b.r||a.c-b.c).map(x=>({...x,text:noteText(x.items)}));
  const commentsPath=uniquePath(zip,n=>'xl/comments'+n+'.xml'),vmlPath=uniquePath(zip,n=>'xl/drawings/vmlDrawing'+n+'.vml');
  const ids=new Set(relNodes.map(x=>x.getAttribute('Id')));let n=1;const nextId=()=>{while(ids.has('rId'+n))n++;ids.add('rId'+n);return 'rId'+n};const vmlId=nextId(),commentsId=nextId();
  for(const [id,type,target] of [[vmlId,REL_VML,vmlPath],[commentsId,REL_COMMENTS,commentsPath]]){const r=rels.createElementNS(NS_PKG,'Relationship');r.setAttribute('Id',id);r.setAttribute('Type',type);r.setAttribute('Target',relTarget(sheet.path,target));rels.documentElement.append(r)}
  const legacy=sheetDoc.createElementNS(NS_MAIN,'legacyDrawing');legacy.setAttributeNS(NS_REL,'r:id',vmlId);
  const next=Array.from(root.children).find(x=>AFTER_LEGACY.includes(x.localName));next?root.insertBefore(legacy,next):root.append(legacy);
  zip.file(commentsPath,commentsXml(cells));zip.file(vmlPath,vmlXml(cells,reserveIdmaps(used,Math.ceil(cells.length/1024))));zip.file(relsPath,new XMLSerializer().serializeToString(rels));zip.file(sheet.path,new XMLSerializer().serializeToString(sheetDoc));
  const ov=types.createElementNS(NS_CT,'Override');ov.setAttribute('PartName','/'+commentsPath);ov.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml');types.documentElement.append(ov);
  if(!nodes(types,'Default').some(x=>(x.getAttribute('Extension')||'').toLowerCase()==='vml')){const d=types.createElementNS(NS_CT,'Default');d.setAttribute('Extension','vml');d.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.vmlDrawing');types.documentElement.insertBefore(d,types.documentElement.firstElementChild)}
  for(const p of list){p.sourceNote=NOTE_ADDED;p.sourceCells=cellsOf(p).map(c=>col(c-1)+Number(p.row)).join(',')}
 }
}
function reportSheetXml(sheet,styles,date1904=false){const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',lastCol=col(sheet.rows[0].length-1),range=`A1:${lastCol}${sheet.rows.length}`,headerRow=sheet.headerRow||1,filterRange=`A${headerRow}:${lastCol}${sheet.filterEnd||sheet.rows.length}`;const value=(v,r,c)=>{const ref=col(c)+(r+1),kind=sheet.rowKinds?.[r];let rowStyle=styles[kind]??((r===0||r===headerRow-1)?styles.header:styles.normal);if(['warning','blocker','info'].includes(kind)&&c>0)rowStyle=styles.normal;if(/All$/.test(kind||''))rowStyle=styles[kind.slice(0,-3)];if(['warningDetail','blockerDetail'].includes(kind)&&(c<2||c>4))rowStyle=styles.normal;const style=v instanceof Date?styles.date:rowStyle;if(v instanceof Date){const serial=(Date.UTC(v.getFullYear(),v.getMonth(),v.getDate(),v.getHours(),v.getMinutes(),v.getSeconds())-(date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30)))/86400000;return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`}if(typeof v==='number'&&Number.isFinite(v))return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;if(typeof v==='boolean')return `<c r="${ref}" s="${style}" t="b"><v>${v?1:0}</v></c>`;return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`};return `<worksheet xmlns="${ns}"><sheetPr><tabColor rgb="${sheet.tabColor}"/></sheetPr><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${sheet.widths.map((w,j)=>`<col min="${j+1}" max="${j+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${sheet.rows.map((row,j)=>`<row r="${j+1}"${sheet.heights?.[j+1]?` ht="${sheet.heights[j+1]}" customHeight="1"`:''}>${row.map((v,k)=>value(v,j,k)).join('')}</row>`).join('')}</sheetData><autoFilter ref="${filterRange}"/>${sheet.merges?.length?`<mergeCells count="${sheet.merges.length}">${sheet.merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells>`:''}</worksheet>`}
// 匯入草稿頁：把「單獨下載的草稿檔」那張工作表原樣搬進報表檔，作為對照用副本。
// 樣式以「追加」方式併入報表樣式表（不改既有項目）；共用字串改為儲存格內文字；會連到其他零件或其他頁的設定一律移除，避免 Excel 修復。
const DRAFT_DROP=['drawing','legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','tableParts','hyperlinks','extLst','conditionalFormatting','dataValidations','sheetProtection','protectedRanges','autoFilter','pageSetup','rowBreaks','colBreaks','customSheetViews','smartTags','webPublishItems','scenarios','sortState','dataConsolidate','cellWatches','ignoredErrors'];
async function draftPackage(draftBuffer){
 const dz=await g.JSZip.loadAsync(draftBuffer),wbPath=dz.file('xl/workbook.xml')?'xl/workbook.xml':'workbook.xml',dBase=wbPath.slice(0,wbPath.lastIndexOf('/')+1);
 const dRels=nodes(xml(await dz.file(dBase+'_rels/workbook.xml.rels').async('string')),'Relationship'),resolve=t=>{const p=[];for(const s of (t.startsWith('/')?t.slice(1):dBase+t).split('/')){if(s==='..')p.pop();else if(s&&s!=='.')p.push(s)}return p.join('/')};
 const dWb=xml(await dz.file(wbPath).async('string')),first=nodes(dWb,'sheet')[0];if(!first)throw Error('匯入草稿沒有工作表');
 const rid=first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||first.getAttribute('r:id'),target=dRels.find(r=>r.getAttribute('Id')===rid)?.getAttribute('Target');if(!target)throw Error('匯入草稿工作表關聯不完整');
 const byType=t=>{const r=dRels.find(x=>(x.getAttribute('Type')||'').endsWith('/'+t));return r?resolve(r.getAttribute('Target')):null};
 const sstPath=byType('sharedStrings'),stylesPath=byType('styles');
 const strings=sstPath&&dz.file(sstPath)?nodes(xml(await dz.file(sstPath).async('string')),'si').map(si=>nodes(si,'t').map(t=>t.textContent).join('')):[];
 return {name:first.getAttribute('name'),sheet:xml(await dz.file(resolve(target)).async('string')),styles:stylesPath&&dz.file(stylesPath)?xml(await dz.file(stylesPath).async('string')):null,strings};
}
function draftStyleMapper(srcStyles,dst){
 const cache=new Map(),list=(d,n)=>nodes(d,n)[0],kids=el=>el?Array.from(el.children):[];
 const src={fonts:kids(list(srcStyles,'fonts')),fills:kids(list(srcStyles,'fills')),borders:kids(list(srcStyles,'borders')),xfs:kids(list(srcStyles,'cellXfs')),numFmts:kids(list(srcStyles,'numFmts'))};
 const dstRoot=dst.documentElement,section=(name,before)=>{let el=list(dst,name);if(!el){el=dst.createElementNS(dstRoot.namespaceURI,name);const ref=list(dst,before);ref?dstRoot.insertBefore(el,ref):dstRoot.prepend(el)}return el};
 const appendClone=(name,node)=>{const parent=list(dst,name);parent.append(dst.importNode(node,true));return parent.children.length-1};
 const memo={font:new Map(),fill:new Map(),border:new Map(),numFmt:new Map()};
 const mapPart=(kind,name,arr,idx)=>{idx=Number(idx)||0;if(!memo[kind].has(idx))memo[kind].set(idx,arr[idx]?appendClone(name,arr[idx]):0);return memo[kind].get(idx)};
 const mapNumFmt=id=>{id=Number(id)||0;if(id<164)return id;if(memo.numFmt.has(id))return memo.numFmt.get(id);const srcFmt=src.numFmts.find(n=>Number(n.getAttribute('numFmtId'))===id);if(!srcFmt){memo.numFmt.set(id,0);return 0}
  const host=section('numFmts','fonts'),used=Math.max(163,...Array.from(host.children).map(n=>Number(n.getAttribute('numFmtId'))||0)),copy=dst.importNode(srcFmt,true);copy.setAttribute('numFmtId',String(used+1));host.append(copy);memo.numFmt.set(id,used+1);return used+1};
 const finish=()=>{for(const n of ['numFmts','fonts','fills','borders','cellXfs']){const el=list(dst,n);if(el)el.setAttribute('count',String(el.children.length))}};
 return {font:id=>mapPart('font','fonts',src.fonts,id),map:s=>{const key=String(Number(s)||0);if(cache.has(key))return cache.get(key);const xf=src.xfs[Number(key)];if(!xf){cache.set(key,'0');return '0'}
  const copy=dst.importNode(xf,true);copy.setAttribute('fontId',String(mapPart('font','fonts',src.fonts,xf.getAttribute('fontId'))));copy.setAttribute('fillId',String(mapPart('fill','fills',src.fills,xf.getAttribute('fillId'))));copy.setAttribute('borderId',String(mapPart('border','borders',src.borders,xf.getAttribute('borderId'))));copy.setAttribute('numFmtId',String(mapNumFmt(xf.getAttribute('numFmtId'))));copy.setAttribute('xfId','0');
  const xfs=list(dst,'cellXfs');xfs.append(copy);const id=String(xfs.children.length-1);cache.set(key,id);return id},finish};
}
function draftSheetXml(pkg,styleDoc){
 const d=pkg.sheet.cloneNode(true),root=d.documentElement,mapper=pkg.styles?draftStyleMapper(pkg.styles,styleDoc):{map:()=>'0',font:()=>0,finish:()=>{}};
 // 任何帶有外部關聯（r:id 等）的區塊都會在報表檔裡找不到對象，一律移除；mc:AlternateContent 內常包控制項
 const hasRel=el=>[el,...el.getElementsByTagName('*')].some(x=>Array.from(x.attributes).some(a=>a.namespaceURI===NS_REL));
 for(const el of Array.from(root.children))if(DRAFT_DROP.includes(el.localName)||el.localName==='AlternateContent'||hasRel(el))el.remove();
 root.removeAttributeNS('http://schemas.microsoft.com/office/spreadsheetml/2014/revision','uid');
 for(const p of nodes(d,'phoneticPr'))if(p.hasAttribute('fontId'))p.setAttribute('fontId',String(mapper.font(p.getAttribute('fontId'))));
 for(const v of nodes(d,'sheetView'))v.removeAttribute('tabSelected');
 for(const c of nodes(d,'c')){
  if(c.getAttribute('t')==='s'){const text=pkg.strings[Number(nodes(c,'v')[0]?.textContent)]??'';for(const k of Array.from(c.children))k.remove();const is=d.createElementNS(NS_MAIN,'is'),t=d.createElementNS(NS_MAIN,'t');t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.textContent=text;is.append(t);c.append(is);c.setAttribute('t','inlineStr')}
  if(c.hasAttribute('s'))c.setAttribute('s',mapper.map(c.getAttribute('s')));
 }
 for(const r of nodes(d,'row'))if(r.hasAttribute('s'))r.setAttribute('s',mapper.map(r.getAttribute('s')));
 for(const col of nodes(d,'col'))if(col.hasAttribute('style'))col.setAttribute('style',mapper.map(col.getAttribute('style')));
 mapper.finish();
 return new XMLSerializer().serializeToString(d);
}
// 重新檢查「改過又另存的舊報表」時，先清掉工具自己上次留下的東西（只在副本上做）：
// 1. 舊報告頁：頁名相符「且」內容是工具產生的格式才移除；匯入草稿頁只在舊問題摘要寫明「已附」時才移除
// 2. 舊備註：開頭是 [BLOCKER]／[WARNING]、結尾是「詳見「異常報表」」的才移除；RD 或使用者的備註保留
const OLD_REPORT_NAME=/^(問題摘要|異常報表|自動補值紀錄|匯入草稿)(_\d+)?$/;
const OUR_NOTE=/^\s*\[(BLOCKER|WARNING)\][\s\S]*詳見「異常報表」\s*$/;
function oldReportKind(sheet){
 const m=OLD_REPORT_NAME.exec(sheet.name||'');if(!m)return null;const rows=sheet.rows||[],cell=(r,c)=>String(rows[r]?.[c]??'');
 if(m[1]==='問題摘要'&&cell(0,0)==='項目／問題欄位')return 'summary';
 if(m[1]==='異常報表'&&rows.some(r=>String(r?.[0]??'')==='分頁名稱'&&String(r?.[1]??'')==='Excel 行號'))return 'details';
 if(m[1]==='自動補值紀錄'&&cell(0,0)==='序號'&&cell(0,1)==='來源頁籤')return 'audit';
 if(m[1]==='匯入草稿')return 'draft';
 return null;
}
function resolvePart(fromPath,target){if(!target)return '';if(target.startsWith('/'))return target.slice(1);const p=fromPath.split('/').slice(0,-1);for(const s of target.split('/')){if(s==='..')p.pop();else if(s&&s!=='.')p.push(s)}return p.join('/')}
function dropOverride(types,path){for(const o of nodes(types,'Override'))if((o.getAttribute('PartName')||'')==='/'+path)o.remove()}
async function cleanOldReport(source,zip,wb,rels,types,base){
 const kinds=new Map(source.sheets.map(s=>[s.name,oldReportKind(s)]));
 const summary=source.sheets.find(s=>kinds.get(s.name)==='summary'),draftAttached=!!summary&&(summary.rows||[]).some(r=>String(r?.[0]??'')==='匯入草稿頁'&&String(r?.[1]??'')==='已附');
 const remove=source.sheets.filter(s=>{const k=kinds.get(s.name);return k==='draft'?draftAttached:!!k});
 // 原始頁至少要留一頁；全部都像舊報告時不動
 if(remove.length>=source.sheets.length)remove.length=0;
 const sheetEls=nodes(wb,'sheet'),relEls=nodes(rels,'Relationship'),removedIds=[];
 for(const s of remove){
  const idx=sheetEls.findIndex(e=>e.getAttribute('name')===s.name);if(idx<0)continue;const el=sheetEls[idx],rid=el.getAttributeNS(NS_REL,'id')||el.getAttribute('r:id');removedIds.push(el.getAttribute('sheetId'));
  // 區域名稱：屬於被移除頁的刪掉，後面的頁索引往前移
  const pos=nodes(wb,'sheet').indexOf(el);for(const d of nodes(wb,'definedName'))if(d.hasAttribute('localSheetId')){const n=Number(d.getAttribute('localSheetId'));if(n===pos)d.remove();else if(n>pos)d.setAttribute('localSheetId',String(n-1))}
  el.remove();for(const r of relEls)if(r.getAttribute('Id')===rid)r.remove();
  // 工作表本身與只被它使用的零件
  const sheetRels=relsPathOf(s.path),rf=zip.file(sheetRels);
  if(rf){const own=nodes(xml(await rf.async('string')),'Relationship').filter(r=>r.getAttribute('TargetMode')!=='External').map(r=>resolvePart(s.path,r.getAttribute('Target')));zip.remove(sheetRels);
   for(const part of own){let shared=false;for(const name of Object.keys(zip.files).filter(n=>/\.rels$/.test(n))){const t=await zip.file(name).async('string');const owner=name.replace(/_rels\/([^/]+)\.rels$/,'$1');if(nodes(xml(t),'Relationship').some(r=>resolvePart(owner,r.getAttribute('Target'))===part)){shared=true;break}}if(!shared&&zip.file(part)){zip.remove(part);dropOverride(types,part)}}}
  zip.remove(s.path);dropOverride(types,s.path);
 }
 // 計算鏈若提到被移除的頁，整份移除讓 Excel 重建（避免開檔修復）
 if(removedIds.length){const cc=relEls.find(r=>/\/calcChain$/.test(r.getAttribute('Type')||'')&&r.parentNode);if(cc){const path=resolvePart(source.wbPath,cc.getAttribute('Target')),f=zip.file(path);if(f&&nodes(xml(await f.async('string')),'c').some(x=>removedIds.includes(x.getAttribute('i')))){zip.remove(path);dropOverride(types,path);cc.remove()}}}
 const removedNames=new Set(remove.map(s=>s.name));
 let notes=0;const sheets=[];
 for(const s of source.sheets){if(removedNames.has(s.name))continue;
  if(s.trimmed){sheets.push(s);continue}   // 超大工作表不重寫，舊備註也不動
  const relsPath=relsPathOf(s.path),rf=zip.file(relsPath);if(!rf){sheets.push(s);continue}
  const sr=xml(await rf.async('string')),srNodes=nodes(sr,'Relationship'),cRel=srNodes.find(r=>(r.getAttribute('Type')||'')===REL_COMMENTS);if(!cRel){sheets.push(s);continue}
  const cPath=resolvePart(s.path,cRel.getAttribute('Target')),cf=zip.file(cPath);if(!cf){sheets.push(s);continue}
  const cDoc=xml(await cf.async('string')),textOf=c=>nodes(c,'t').map(t=>t.textContent).join(''),ours=nodes(cDoc,'comment').filter(c=>OUR_NOTE.test(textOf(c)));if(!ours.length){sheets.push(s);continue}
  const refs=new Set(ours.map(c=>c.getAttribute('ref')));for(const c of ours)c.remove();notes+=ours.length;
  const sheetDoc=s.xml.cloneNode(true),root=sheetDoc.documentElement;
  // 備註繪圖：拿掉對應儲存格的備註框
  const vRel=srNodes.find(r=>(r.getAttribute('Type')||'')===REL_VML),vPath=vRel?resolvePart(s.path,vRel.getAttribute('Target')):'',vf=vPath&&zip.file(vPath);let vmlLeft=true;
  if(vf){let v=await vf.async('string');v=v.replace(/<v:shape\b[\s\S]*?<\/v:shape>/g,shape=>{if(!/ObjectType\s*=\s*["']Note["']/.test(shape))return shape;const r=/<x:Row>(\d+)<\/x:Row>/.exec(shape),c=/<x:Column>(\d+)<\/x:Column>/.exec(shape);return r&&c&&refs.has(col(Number(c[1]))+(Number(r[1])+1))?'':shape});vmlLeft=/<v:shape\b/.test(v);if(vmlLeft)zip.file(vPath,v);else{zip.remove(vPath);vRel.remove();for(const l of Array.from(root.children).filter(x=>x.localName==='legacyDrawing'))l.remove()}}
  if(nodes(cDoc,'comment').length)zip.file(cPath,new XMLSerializer().serializeToString(cDoc));else{zip.remove(cPath);dropOverride(types,cPath);cRel.remove()}
  if(nodes(sr,'Relationship').length)zip.file(relsPath,new XMLSerializer().serializeToString(sr));else zip.remove(relsPath);
  zip.file(s.path,new XMLSerializer().serializeToString(sheetDoc));sheets.push({...s,xml:sheetDoc});
 }
 return {source:{...source,sheets},notes,pages:remove.map(s=>s.name)};
}
async function writeIntegrated(source,result,meta={},options={}){
 if(!source?.zip||!source?.wbPath||!source?.sheets?.length)throw Error('請先載入來源活頁簿');
 const zip=await g.JSZip.loadAsync(await source.zip.generateAsync({type:'arraybuffer'})),base=source.wbPath.slice(0,source.wbPath.lastIndexOf('/')+1),relPath=base+'_rels/workbook.xml.rels';
 const wb=xml(await zip.file(source.wbPath).async('string')),rels=xml(await zip.file(relPath).async('string')),types=xml(await zip.file('[Content_Types].xml').async('string'));
 const cleaned=await cleanOldReport(source,zip,wb,rels,types,base);source=cleaned.source;
 const date1904=nodes(wb,'workbookPr').some(x=>/^(1|true)$/i.test(x.getAttribute('date1904')||''));
 const relationships=nodes(rels,'Relationship'),styleRel=relationships.find(x=>(x.getAttribute('Type')||'').endsWith('/styles'));let stylePath=styleRel?.getAttribute('Target')||'styles.xml';if(!stylePath.startsWith('/'))stylePath=base+stylePath.replace(/^\.\//,'');else stylePath=stylePath.slice(1);stylePath=stylePath.replace(/\/[^/]+\/\.\.\//g,'/');
 if(!zip.file(stylePath))throw Error('來源活頁簿缺少樣式表，無法安全加入標記');const styleDoc=xml(await zip.file(stylePath).async('string')),styles=reportStyles(styleDoc);await annotateSource(source,zip,result,types);
 const draftPkg=options.draft&&result.ready?await draftPackage(options.draft):null,metaX={...meta,cleanedNotes:cleaned.notes,cleanedPages:cleaned.pages,draftIncluded:!!draftPkg,draftRequested:options.draft!==undefined};
 const tabs=uniqueNames(source,tables(result,metaX)),sheetNodes=nodes(wb,'sheets')[0],firstOriginal=sheetNodes.firstElementChild,maxSheet=Math.max(0,...nodes(wb,'sheet').map(x=>Number(x.getAttribute('sheetId'))||0));let nextRid=1;const ids=new Set(relationships.map(x=>x.getAttribute('Id')));while(ids.has('rId'+nextRid))nextRid++;
 const existing=new Set(Object.keys(zip.files).filter(x=>x.startsWith(base+'worksheets/')));for(const [i,tab]of tabs.entries()){let n=1,path;do path=base+'worksheets/pnBomReport'+n+++'.xml';while(existing.has(path));existing.add(path);while(ids.has('rId'+nextRid))nextRid++;const rid='rId'+nextRid++;ids.add(rid);const rel=rels.createElementNS('http://schemas.openxmlformats.org/package/2006/relationships','Relationship');rel.setAttribute('Id',rid);rel.setAttribute('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet');rel.setAttribute('Target',path.slice(base.length));rels.documentElement.append(rel);const sh=wb.createElementNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main','sheet');sh.setAttribute('name',tab.name);sh.setAttribute('sheetId',String(maxSheet+i+1));sh.setAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','r:id',rid);firstOriginal?sheetNodes.insertBefore(sh,firstOriginal):sheetNodes.append(sh);const ov=types.createElementNS('http://schemas.openxmlformats.org/package/2006/content-types','Override');ov.setAttribute('PartName','/'+path);ov.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');types.documentElement.append(ov);zip.file(path,i===0?reportSheetXml(tab,styles,date1904).replace('<sheetView workbookViewId="0">','<sheetView tabSelected="1" workbookViewId="0">'):reportSheetXml(tab,styles,date1904))}
 // 匯入草稿頁（只有沒有阻擋問題時）：接在三張報告頁之後、原始分頁之前
 let inserted=tabs.length;
 if(draftPkg){const used=new Set([...source.sheets.map(x=>x.name.toLowerCase()),...tabs.map(x=>x.name.toLowerCase())]);let name='匯入草稿',k=2;while(used.has(name.toLowerCase()))name='匯入草稿_'+k++;
  let n=1,path;do path=base+'worksheets/pnBomDraft'+n+++'.xml';while(zip.file(path));while(ids.has('rId'+nextRid))nextRid++;const rid='rId'+nextRid++;ids.add(rid);
  const rel=rels.createElementNS('http://schemas.openxmlformats.org/package/2006/relationships','Relationship');rel.setAttribute('Id',rid);rel.setAttribute('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet');rel.setAttribute('Target',path.slice(base.length));rels.documentElement.append(rel);
  const sh=wb.createElementNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main','sheet');sh.setAttribute('name',name);sh.setAttribute('sheetId',String(maxSheet+tabs.length+1));sh.setAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','r:id',rid);firstOriginal?sheetNodes.insertBefore(sh,firstOriginal):sheetNodes.append(sh);
  const ov=types.createElementNS('http://schemas.openxmlformats.org/package/2006/content-types','Override');ov.setAttribute('PartName','/'+path);ov.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');types.documentElement.append(ov);
  zip.file(path,draftSheetXml(draftPkg,styleDoc));inserted++}
 // 報告頁插在最前面：所有依「工作表位置」記錄的設定一併後移，避免區域名稱、列印範圍、作用中分頁錯位
 for(const d of nodes(wb,'definedName'))if(d.hasAttribute('localSheetId'))d.setAttribute('localSheetId',String(Number(d.getAttribute('localSheetId'))+inserted));
 // 打開報表時直接看到「問題摘要」：作用中分頁設為第一頁、頁籤列從第一頁開始；原始頁的「已選取」標記拿掉，避免同時選取多頁
 for(const v of nodes(wb,'workbookView')){v.setAttribute('activeTab','0');v.removeAttribute('firstSheet')}
 // 用文字替換只拿掉 sheetView 的 tabSelected 屬性，不整頁解析（超大工作表也不會卡住）
 for(const s of source.sheets){const f=zip.file(s.path);if(!f)continue;const t=await f.async('string');const u=t.replace(/(<(?:\w+:)?sheetView\b[^>]*?)\s+tabSelected="(?:1|true)"/g,'$1');if(u!==t)zip.file(s.path,u)}
 zip.file(source.wbPath,new XMLSerializer().serializeToString(wb));zip.file(relPath,new XMLSerializer().serializeToString(rels));zip.file('[Content_Types].xml',new XMLSerializer().serializeToString(types));zip.file(stylePath,new XMLSerializer().serializeToString(styleDoc));return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',compression:'DEFLATE',compressionOptions:{level:6}});
}
async function write(result,meta={}){
 const zip=new g.JSZip(),sheets=tables(result,meta),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
 zip.file('_rels/.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
 zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${sheets.map((s,i)=>`<sheet name="${s.name}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
 zip.file('xl/_rels/workbook.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${rel}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId4" Type="${rel}/styles" Target="styles.xml"/></Relationships>`);
 zip.file('xl/styles.xml',`<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Comic Sans MS"/></font><font><b/><sz val="10"/><name val="Comic Sans MS"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFCC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD0D0D0"/></left><right style="thin"><color rgb="FFD0D0D0"/></right><top style="thin"><color rgb="FFD0D0D0"/></top><bottom style="thin"><color rgb="FFD0D0D0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3">${[0,1,2].map(i=>`<xf numFmtId="${i===2?164:0}" fontId="${i===1?1:0}" fillId="${i===1?2:0}" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1" applyBorder="1" applyFont="1" applyFill="1"><alignment vertical="top" wrapText="1"/></xf>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
 sheets.forEach((s,i)=>{const lastCol=col(s.rows[0].length-1),range=`A1:${lastCol}${s.rows.length}`,headerRow=s.headerRow||1,filterRange=`A${headerRow}:${lastCol}${s.filterEnd||s.rows.length}`;zip.file(`xl/worksheets/sheet${i+1}.xml`,`<worksheet xmlns="${ns}"><sheetPr><tabColor rgb="${s.tabColor}"/></sheetPr><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${s.widths.map((w,j)=>`<col min="${j+1}" max="${j+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${s.rows.map((row,j)=>`<row r="${j+1}"${s.heights?.[j+1]?` ht="${s.heights[j+1]}" customHeight="1"`:''}>${row.map((v,k)=>cell(v,j,k,headerRow)).join('')}</row>`).join('')}</sheetData>${i?`<autoFilter ref="${filterRange}"/>`:''}${s.merges?.length?`<mergeCells count="${s.merges.length}">${s.merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells>`:''}</worksheet>`)});
 return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',compression:'DEFLATE',compressionOptions:{level:6}});
}
g.PnBomReport={write,writeIntegrated,tables,dateTag,noteAnchor};
})(typeof window==='undefined'?globalThis:window);
