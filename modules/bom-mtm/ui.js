(()=>{'use strict';
const $=id=>document.getElementById(id),labels={missing:'補建料號後重試／BOM 保留',ignore:'不需建立',manual:'手動排除 BOM',existing:'已存在 PIM／追蹤待確認',pending:'缺料／其他錯誤，待確認'};
const inputs=['bom','export','staging','manual','date','preserve-unmatched','rules'];let state=null,output=null,busy=false,errorList=[];const selected={bom:[],export:[],staging:[],rules:[]};
$('date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function reset(){state=null;output=null;errorList=[];$('error-panel').hidden=true;$('status').textContent='檔案或條件已變更，請重新預覽。';$('result').hidden=true;$('agree').checked=false;$('build').disabled=true;$('download-bom').hidden=true;$('download-staging').hidden=true}
inputs.forEach(id=>$(id).addEventListener('input',reset));
function lock(v){busy=v;document.querySelectorAll('.remove-file').forEach(b=>b.disabled=v);for(const id of [...inputs,'preview','error-preview','agree'])$(id).disabled=v;$('build').disabled=v||!$('agree').checked||!state}
async function read(id){const files=selected[id];if(!files.length)return null;if(id==='rules'){const rules=JSON.parse(await files[0].text());if(rules.version!==1||!Array.isArray(rules.projects)||!Array.isArray(rules.parts)||!rules.projects.length||!rules.parts.length||![...rules.projects,...rules.parts].every(x=>typeof x==='string'&&x.trim()))throw Error('特例規則格式不正確');return rules;}if(id==='export')return BomMtm.mergeExports(await Promise.all(files.map(async f=>({name:f.name,book:await BomMtm.load(await f.arrayBuffer())}))));return BomMtm.load(await files[0].arrayBuffer())}
function renderFiles(id){const list=$(id+'-files');list.replaceChildren();selected[id].forEach((f,i)=>{const item=document.createElement('div'),name=document.createElement('span'),button=document.createElement('button');name.textContent=f.name;button.textContent='移除';button.type='button';button.className='remove-file';button.disabled=busy;button.setAttribute('aria-label','移除 '+f.name);button.onclick=()=>{if(busy)return;selected[id].splice(i,1);$(id).value='';renderFiles(id);reset()};item.append(name,button);list.append(item)})}
for(const id of ['bom','export','staging','rules'])$(id).addEventListener('change',()=>{if(id==='export'){for(const f of $(id).files)if(!selected[id].some(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified))selected[id].push(f)}else selected[id]=Array.from($(id).files);$(id).value='';renderFiles(id);reset()});
async function prepare(){const [b,e,s,rules]=await Promise.all([read('bom'),read('export'),read('staging'),read('rules')]);const p=BomMtm.plan(b,e,s,$('manual').value,$('date').value,{preserveUnmatched:$('preserve-unmatched').checked,exceptionRules:rules});return {b,e,s,p}}
function row(values,target='rows'){const tr=document.createElement('tr');for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td)}$(target).append(tr)}
function modelCode(mtm, rows){
 const key=mtm.trim().toUpperCase();
 if(!key)return '查無資料';
 const matching=(field,length)=>rows.filter(r=>{
  const prefix=String(r[field]??'').trim().toUpperCase();
  return prefix.length===length&&key.startsWith(prefix);
 });
 const specific=matching('SPB MTM前5碼',5);
 const matches=specific.length?specific:matching('MTM前4碼',4);
 if(matches.length>1)return '多筆符合';
 return String(matches[0]?.['機種別代號']??'').trim()||'查無資料';
}
async function renderMissing(exp){
 const details=exp?BomMtm.errorRows(exp).filter(r=>r.kind==='missing'):[];
 const unique=new Map();
 for(const item of details){
  const key=JSON.stringify([item.mtm,item.part,item.description,item.basicName]);
  unique.set(key,item);
 }
 $('missing-rows').replaceChildren();
 $('missing-panel').hidden=!unique.size;
 if(!unique.size)return;
 let projects;
 try{
  ({rows:projects}=await WorkspaceECSources.read('CustomDB'));
  if(!Object.hasOwn(projects[0]||{},'機種別代號'))throw Error('CustomDB 欄位缺漏');
 }catch{projects=null}
 for(const item of unique.values()){
  row([item.mtm||'未對應 MTM',projects?modelCode(item.mtm,projects):'查詢失敗',item.part,item.description||'—',item.basicName||'—'],'missing-rows');
 }
}
function renderErrors(){
 const kind=$('error-kind').value,q=$('error-search').value.trim().toLowerCase(),shown=errorList.filter(r=>(kind==='all'||r.kind===kind)&&[r.mtm,r.part,r.reason,r.note].join(' ').toLowerCase().includes(q));
 $('error-rows').replaceChildren();for(const r of shown){const tr=document.createElement('tr');tr.className='error-'+r.kind;for(const value of [r.row,r.mtm||'未對應 MTM',r.part,{missing:'補建料號後重試，BOM 保留',ignore:'不需建立此 MTM',other:'其他錯誤，待確認'}[r.kind],r.action||'—',r.reason,r.note||'—']){const td=document.createElement('td');td.textContent=value;tr.append(td)}$('error-rows').append(tr)}
 $('error-count').textContent='共 '+errorList.length+' 筆 ERROR；目前顯示 '+shown.length+' 筆';
}
async function previewErrors(){if(busy)return;lock(true);try{if(!selected.export[0])throw Error('請選擇下載好的 Export_LBS');const e=await read('export');errorList=BomMtm.errorRows(e);$('error-source').textContent=selected.export.map(f=>f.name).join('、');$('error-kind').value='all';$('error-search').value='';renderErrors();$('error-panel').hidden=false;$('status').textContent='Export ERROR 已載入，未修改任何檔案。'}catch(e){errorList=[];$('error-panel').hidden=true;$('status').textContent='未讀取：'+e.message}finally{lock(false)}}
$('error-preview').onclick=previewErrors;$('error-kind').onchange=renderErrors;$('error-search').oninput=renderErrors;
$('export').addEventListener('change',()=>{$('error-panel').hidden=true;errorList=[];if(selected.export[0])previewErrors()});
$('preview').onclick=async()=>{
 reset();lock(true);$('status').textContent='正在本機核對檔案…';try{
 state=await prepare();const {b,e,s,p}=state;$('totals').replaceChildren();
 const totals=b?['BOM 原 MTM '+p.mtmCount+' 個','排除 '+p.entries.filter(i=>i.excludeBom).length+' 個／'+p.removedRows+' 列','保留 BOM '+(p.originalRows-p.removedRows)+' 列']:['只更新待貼入','依據 Export_LBS','不需要 BOM_TREE'];
 if(s)totals.push('待貼入保留 '+(p.ss.data.length-1-p.omitted.length)+' 筆','Export 異常 '+p.trackingIssues.size+' 個');
 if(p.omitted.length)totals.push('略過無異動單件列 '+p.omitted.length+' 筆');
 for(const t of totals){const el=document.createElement('span');el.textContent=t;$('totals').append(el)}
 $('warnings').replaceChildren();for(const w of p.warnings){const el=document.createElement('p');el.className='warning';el.textContent=w;$('warnings').append(el)}
 $('rows').replaceChildren();for(const i of p.entries){const tracking=p.trackingIssues.get(i.mtm);const update=!s?'未提供待貼入':!tracking?'沿用原值（Export 無異常）':tracking.kind==='missing'?'只在畫面提醒；日期與備註不變':tracking.kind==='ignore'?p.date+'＋Export 原因':'confirming＋Export 原因';row([i.mtm,labels[i.kind]+(b?(i.excludeBom?'／排除 BOM':'／保留 BOM'):''),i.rows??'—',update,i.reason+(i.tcxException?'；核定特例：需 ODM Upload Data，可上傳 CloudDB（尚未上傳）':'')])}
 for(const x of p.extras)row([x.mtm,'未對應 Export 主階的 PN／資料','—','保留原列，不計 MTM',x.reason]);
 await renderMissing(e);
 $('result').hidden=false;$('status').textContent='預覽完成，請核對後產生檔案。';
 }catch(e){state=null;$('status').textContent='未產檔：'+e.message}finally{lock(false)}
};
$('agree').onchange=()=>{$('build').disabled=!$('agree').checked||busy||!state};
$('build').onclick=async()=>{
 if(!state||!$('agree').checked)return;lock(true);$('status').textContent='正在產生新檔…';try{const {b,s,p}=await prepare();output=await BomMtm.apply(b,s,p);$('download-bom').hidden=!output.bom;$('download-staging').hidden=!output.staging;$('status').textContent=output.bom&&output.staging?'兩份檔案已備妥，請分別下載。':output.staging?'待貼入報表已備妥，請下載；未產生 BOM_TREE。':'BOM_TREE 已備妥，請下載。'}catch(e){output=null;$('download-bom').hidden=true;$('download-staging').hidden=true;$('status').textContent='未交付檔案：'+e.message}finally{lock(false)}
};
function download(bytes,name){const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$('download-bom').onclick=()=>{if(output?.bom)download(output.bom,selected.bom[0].name.replace(/\.xlsx$/i,'')+'_排除更新_'+$('date').value+'.xlsx')};
$('download-staging').onclick=()=>{if(output?.staging)download(output.staging,selected.staging[0].name.replace(/\.xlsx$/i,'')+'_EIP更新_'+$('date').value+'.xlsx')};
})();
