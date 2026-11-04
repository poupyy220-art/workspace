(()=>{'use strict';
const $=id=>document.getElementById(id),labels={missing:'補建料號後重試／BOM 保留',ignore:'不需建立',manual:'手動排除 BOM',existing:'已存在 PIM／追蹤待確認',pending:'缺料／其他錯誤，待確認'};
const inputs=['bom','export','staging','manual','date','preserve-unmatched'];let state=null,output=null,busy=false,errorList=[];
$('date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function reset(){state=null;output=null;$('result').hidden=true;$('agree').checked=false;$('build').disabled=true;$('download-bom').hidden=true;$('download-staging').hidden=true}
inputs.forEach(id=>$(id).addEventListener('input',reset));
function lock(v){busy=v;for(const id of [...inputs,'preview','error-preview','agree'])$(id).disabled=v;$('build').disabled=v||!$('agree').checked||!state}
async function read(id){const f=$(id).files[0];return f?BomMtm.load(await f.arrayBuffer()):null}
async function prepare(){const [b,e,s]=await Promise.all([read('bom'),read('export'),read('staging')]);const p=BomMtm.plan(b,e,s,$('manual').value,$('date').value,{preserveUnmatched:$('preserve-unmatched').checked});return {b,e,s,p}}
function row(values){const tr=document.createElement('tr');for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td)}$('rows').append(tr)}
function renderErrors(){
 const kind=$('error-kind').value,q=$('error-search').value.trim().toLowerCase(),shown=errorList.filter(r=>(kind==='all'||r.kind===kind)&&[r.mtm,r.part,r.reason,r.note].join(' ').toLowerCase().includes(q));
 $('error-rows').replaceChildren();for(const r of shown){const tr=document.createElement('tr');tr.className='error-'+r.kind;for(const value of [r.row,r.mtm||'未對應 MTM',r.part,{missing:'補建料號後重試，BOM 保留',ignore:'不需建立此 MTM',other:'其他錯誤，待確認'}[r.kind],r.action||'—',r.reason,r.note||'—']){const td=document.createElement('td');td.textContent=value;tr.append(td)}$('error-rows').append(tr)}
 $('error-count').textContent='共 '+errorList.length+' 筆 ERROR；目前顯示 '+shown.length+' 筆';
}
async function previewErrors(){if(busy)return;lock(true);try{if(!$('export').files[0])throw Error('請選擇下載好的 Export_LBS');const e=await read('export');errorList=BomMtm.errorRows(e);$('error-source').textContent=$('export').files[0].name;$('error-kind').value='all';$('error-search').value='';renderErrors();$('error-panel').hidden=false;$('status').textContent='Export ERROR 已載入，未修改任何檔案。'}catch(e){errorList=[];$('error-panel').hidden=true;$('status').textContent='未讀取：'+e.message}finally{lock(false)}}
$('error-preview').onclick=previewErrors;$('error-kind').onchange=renderErrors;$('error-search').oninput=renderErrors;
$('export').addEventListener('change',()=>{$('error-panel').hidden=true;errorList=[];if($('export').files[0])previewErrors()});
$('preview').onclick=async()=>{
 reset();lock(true);$('status').textContent='正在本機核對檔案…';try{
 state=await prepare();const {b,s,p}=state;$('totals').replaceChildren();
 const totals=b?['BOM 原 MTM '+p.mtmCount+' 個','排除 '+p.entries.filter(i=>i.excludeBom).length+' 個／'+p.removedRows+' 列','保留 BOM '+(p.originalRows-p.removedRows)+' 列']:['只更新待貼入','依據 Export_LBS','不需要 BOM_TREE'];
 if(s)totals.push('待貼入保留 '+(p.ss.data.length-1-p.omitted.length)+' 筆','Export 異常 '+p.trackingIssues.size+' 個');
 if(p.omitted.length)totals.push('略過無異動單件列 '+p.omitted.length+' 筆');
 for(const t of totals){const el=document.createElement('span');el.textContent=t;$('totals').append(el)}
 $('warnings').replaceChildren();for(const w of p.warnings){const el=document.createElement('p');el.className='warning';el.textContent=w;$('warnings').append(el)}
 $('rows').replaceChildren();for(const i of p.entries){const tracking=p.trackingIssues.get(i.mtm);const update=!s?'未提供待貼入':!tracking?'沿用原值（Export 無異常）':tracking.kind==='missing'?'只在畫面提醒；日期與備註不變':tracking.kind==='ignore'?p.date+'＋Export 原因':'confirming＋Export 原因';row([i.mtm,labels[i.kind]+(b?(i.excludeBom?'／排除 BOM':'／保留 BOM'):''),i.rows??'—',update,i.reason])}
 for(const x of p.extras)row([x.mtm,'未對應 Export 主階的 PN／資料','—','保留原列，不計 MTM',x.reason]);
 $('result').hidden=false;$('status').textContent='預覽完成，請核對後產生檔案。';
 }catch(e){state=null;$('status').textContent='未產檔：'+e.message}finally{lock(false)}
};
$('agree').onchange=()=>{$('build').disabled=!$('agree').checked||busy||!state};
$('build').onclick=async()=>{
 if(!state||!$('agree').checked)return;lock(true);$('status').textContent='正在產生新檔…';try{const {b,s,p}=await prepare();output=await BomMtm.apply(b,s,p);$('download-bom').hidden=!output.bom;$('download-staging').hidden=!output.staging;$('status').textContent=output.bom&&output.staging?'兩份檔案已備妥，請分別下載。':output.staging?'待貼入報表已備妥，請下載；未產生 BOM_TREE。':'BOM_TREE 已備妥，請下載。'}catch(e){output=null;$('download-bom').hidden=true;$('download-staging').hidden=true;$('status').textContent='未交付檔案：'+e.message}finally{lock(false)}
};
function download(bytes,name){const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$('download-bom').onclick=()=>{if(output?.bom)download(output.bom,$('bom').files[0].name.replace(/\.xlsx$/i,'')+'_排除更新_'+$('date').value+'.xlsx')};
$('download-staging').onclick=()=>{if(output?.staging)download(output.staging,$('staging').files[0].name.replace(/\.xlsx$/i,'')+'_EIP更新_'+$('date').value+'.xlsx')};
})();
