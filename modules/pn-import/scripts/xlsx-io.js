(function(g){
'use strict';
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const els=(n,k)=>Array.from(n.getElementsByTagNameNS('*',k));
function parse(s){const d=new DOMParser().parseFromString(s,'application/xml');if(els(d,'parsererror').length)throw Error('Excel XML 無法解析，請先用 Excel 另存副本');return d}
function resolve(base,target){const p=target.startsWith('/')?target.slice(1):base+target;const stack=[];for(const s of p.split('/')){if(s==='..')stack.pop();else if(s&&s!=='.')stack.push(s)}return stack.join('/')}
function colNum(a){return a.replace(/\d/g,'').split('').reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1}
function colName(i){let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s}
// 工作表內容檔超過此大小時，只解析到最後一個有值（值、文字、公式）的列；其後只有格式的空白列不解析（原檔不改）
const LARGE_SHEET=8e6;
function trimEmptyTail(text){
 const end=text.lastIndexOf('</sheetData>');if(end<0)return {text,trimmed:false};
 const last=Math.max(text.lastIndexOf('<v>',end),text.lastIndexOf('<v ',end),text.lastIndexOf('<is>',end),text.lastIndexOf('<f>',end),text.lastIndexOf('<f ',end));
 const cut=last<0?text.indexOf('<sheetData>')+11:text.indexOf('</row>',last)+6;
 if(cut<=10||cut>=end)return {text,trimmed:false};
 return {text:text.slice(0,cut)+text.slice(end),trimmed:true,droppedChars:end-cut};
}
async function read(input){
 const zip=await JSZip.loadAsync(input),wbPath=zip.file('xl/workbook.xml')?'xl/workbook.xml':'workbook.xml',base=wbPath.slice(0,wbPath.lastIndexOf('/')+1);
 if(!zip.file(wbPath))throw Error('不是支援的 XLSX 工作簿');
 const wb=parse(await zip.file(wbPath).async('string')),rels=parse(await zip.file(base+'_rels/workbook.xml.rels').async('string'));
 const targets={};els(rels,'Relationship').forEach(x=>{if(x.getAttribute('TargetMode')!=='External')targets[x.getAttribute('Id')]=resolve(base,x.getAttribute('Target'))});
 const ssRel=els(rels,'Relationship').find(x=>(x.getAttribute('Type')||'').endsWith('/sharedStrings'));
 const ssPath=ssRel?targets[ssRel.getAttribute('Id')]:base+'sharedStrings.xml';
 const strings=zip.file(ssPath)?els(parse(await zip.file(ssPath).async('string')),'si').map(s=>els(s,'t').map(x=>x.textContent).join('')):[];
 const sheets=[];
 for(const sh of els(wb,'sheet')){
  const id=sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||sh.getAttribute('r:id');const path=targets[id];if(!path||!zip.file(path))throw Error('工作表關聯不完整');
  let text=await zip.file(path).async('string'),trimmed=false;if(text.length>LARGE_SHEET){const t=trimEmptyTail(text);text=t.text;trimmed=t.trimmed}
  const xml=parse(text),rows=[],formulaProblems=[];text=null;
  for(const row of els(xml,'row')){const ri=Number(row.getAttribute('r'))-1,values=[];els(row,'c').forEach((c,j)=>{const ci=c.getAttribute('r')?colNum(c.getAttribute('r')):j;const raw=els(c,'v')[0]?.textContent,t=c.getAttribute('t');let val=t==='s'?strings[Number(raw)]:t==='inlineStr'?els(c,'t').map(x=>x.textContent).join(''):raw??'';
    if(t==='e')formulaProblems.push({row:ri+1,col:ci+1,reason:'Excel 錯誤值'});
    if(els(c,'f').length&&raw===undefined)formulaProblems.push({row:ri+1,col:ci+1,reason:'公式沒有快取結果；請先在 Excel 重算並儲存'});
    if(t==='n'||!t){if(val!==''&&Number.isFinite(Number(val)))val=Number(val)}values[ci]=val;
   });rows[ri]=values;}
  for(let i=0;i<rows.length;i++)rows[i]??=[];
  sheets.push({name:sh.getAttribute('name'),rows,path,xml,formulaProblems,trimmed});
 }
 return {zip,wbPath,wb,sheets};
}
async function write(template,records){
 if(template.sheets.length!==1||template.sheets[0].name!=='Bom Import')throw Error('請選用已確認的單頁 Bom Import 範本');
 const s=template.sheets[0],d=s.xml.cloneNode(true),data=els(d,'sheetData')[0];
 // Validate the import contract before replacing example/data rows.
 const checks={2:'階層1',13:'新/舊料',14:'料號',15:'英文品名',23:'用量',24:'主件底數',47:'終端客戶'};
 for(const [c,k]of Object.entries(checks))if(PnBom.header(s.rows[1]?.[Number(c)])!==k)throw Error('匯入範本欄位不符：'+colName(Number(c))+'，停止避免錯欄');
 if(!data)throw Error('匯入範本缺少資料區');
 const sample=els(data,'row').find(r=>Number(r.getAttribute('r'))>=3),styles={};if(sample)els(sample,'c').forEach((c,j)=>{const ci=c.getAttribute('r')?colNum(c.getAttribute('r')):j;if(c.hasAttribute('s'))styles[ci]=c.getAttribute('s')});
 els(data,'row').filter(r=>Number(r.getAttribute('r'))>=3).forEach(r=>r.remove());
 // Source formulas and workbook structures are not copied into the fixed import template.
 for(const [i,item]of records.entries()){
  const row=d.createElementNS(ns,'row');row.setAttribute('r',String(i+3));const value={...item.value};
  if(!PnBom.blank(value.Level)){const level=Number(value.Level);if(!Number.isInteger(level)||level<1||level>11)throw Error('階層無法對應匯入表');value['階層'+level]=value.Level;}
  for(let j=2;j<48;j++){const k=PnBom.fields[j],v=value[k];if(PnBom.blank(v))continue;
   const c=d.createElementNS(ns,'c');c.setAttribute('r',colName(j)+(i+3));if(styles[j])c.setAttribute('s',styles[j]);
   if((k==='用量'||k==='主件底數'||k.startsWith('階層'))&&typeof v==='number'&&Number.isFinite(v)){const x=d.createElementNS(ns,'v');x.textContent=String(v);c.append(x)}
   else {c.setAttribute('t','inlineStr');const x=d.createElementNS(ns,'is'),t=d.createElementNS(ns,'t');t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.textContent=String(v);x.append(t);c.append(x)}row.append(c);
  }data.append(row);
 }
 for(const merge of els(d,'mergeCell'))if(Number((merge.getAttribute('ref').split(':')[1]||merge.getAttribute('ref')).replace(/\D/g,''))>2)merge.remove();
 const merges=els(d,'mergeCells')[0];if(merges)merges.setAttribute('count',String(els(merges,'mergeCell').length));
 const dimension=els(d,'dimension')[0];if(dimension)dimension.setAttribute('ref','A1:BN'+Math.max(2,records.length+2));
 const zip=await JSZip.loadAsync(await template.zip.generateAsync({type:'arraybuffer'}));zip.file(s.path,new XMLSerializer().serializeToString(d));
 return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',compression:'DEFLATE',compressionOptions:{level:6}});
}
g.PnBomIO={read,write,colName,trimEmptyTail};
})(window);
