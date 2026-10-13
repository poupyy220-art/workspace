'use strict';
// 介面外觀狀態：只讀取既有元件的狀態來更新進度、顏色與提示，不參與檢查、補值或下載邏輯（那些都在 app.js）。
(function(g){
 // 依 app.js 的狀態文字判斷顏色；不用按鈕可用性推測，避免「產檔失敗」卻顯示成功色。
 // ok：規則通過或已完成下載；blocked：有阻擋或任何失敗；warn：需要使用者處理；''：一般說明。
 function classify(text){
  const t=String(text||'').trim();
  if(/失敗|錯誤|無法|不符|停止|衝突|阻擋/.test(t))return 'blocked';
  if(/^檢查完成/.test(t)||/^已下載匯入草稿/.test(t)||(/^已送出異常檢查與補值報表下載/.test(t)&&/規則檢查通過/.test(t)))return 'ok';
  if(/請|沒有|尚未|已變更/.test(t))return 'warn';
  return '';
 }
 // 從「本機檢查明細」JSON 找出因規格空白、需 RD 確認才能放行的料號（只取頁籤與列號，去重）
 function specCandidates(detailsText){
  let d;try{d=JSON.parse(detailsText||'')}catch{return []}
  const seen=new Set(),out=[];
  for(const x of d?.issues||[]){if(x.field!=='規格'||!/RD 確認紀錄/.test(String(x.reason||''))||!x.sheet||!Number.isInteger(Number(x.row)))continue;const k=x.sheet+'|'+x.row;if(seen.has(k))continue;seen.add(k);out.push({sheet:String(x.sheet),row:Number(x.row)})}
  return out;
 }
 // 預設組合：一次把產品分類／細項產品別／市場分類三欄一起填好；依使用者 2026-10-13 提供的對照表（字面順序：市場分類／產品分類／細項產品別）
 // 若對照順序有誤，只需改這張表，不影響其他邏輯。
 const FILLABLE_FIELDS=['產品分類','細項產品別','市場分類','規格'];
 const CLASSIFY_PRESETS=[
  {市場分類:'SY',產品分類:'LT',細項產品別:'DT'},
  {市場分類:'SY',產品分類:'LT',細項產品別:'AIO'},
  {市場分類:'SY',產品分類:'L6',細項產品別:'DT'},
  {市場分類:'SY',產品分類:'L6',細項產品別:'AIO'},
  {市場分類:'SY',產品分類:'CDU',細項產品別:'SER'},
 ];
 // 從明細找出可在介面直接補值的缺漏欄位（市場分類／產品分類／細項產品別／規格），依頁籤＋列號分組
 function fillCandidates(detailsText){
  let d;try{d=JSON.parse(detailsText||'')}catch{return []}
  const byRow=new Map();
  for(const x of d?.issues||[]){
   if(!FILLABLE_FIELDS.includes(x.field)||!x.sheet||!Number.isInteger(Number(x.row)))continue;
   if(x.field==='規格'&&!/RD 確認紀錄/.test(String(x.reason||'')))continue;
   if(x.field!=='規格'&&!/請 RD 補齊明細/.test(String(x.reason||'')))continue;
   const key=x.sheet+'|'+x.row;if(!byRow.has(key))byRow.set(key,{sheet:String(x.sheet),row:Number(x.row),fields:[]});
   byRow.get(key).fields.push(x.field);
  }
  return [...byRow.values()];
 }
 // 把勾選的料號併入既有確認紀錄（同頁同列以新的為準）；確認人與日期不可空白，既有內容格式錯誤時拒絕覆蓋
 function buildApprovals(existingText,picks,confirmer){
  const who=String(confirmer||'').trim();
  if(!picks.length)throw Error('請至少勾選一筆 RD 已確認可留白的料號。');
  if(!who)throw Error('請填寫確認人與日期，例如「王小明 10/07 確認可留白」。');
  let list=[];const raw=String(existingText||'').trim();
  if(raw){try{list=JSON.parse(raw)}catch{throw Error('進階欄位裡的確認紀錄格式有誤，請先修正或清空後再套用。')}if(!Array.isArray(list))throw Error('進階欄位裡的確認紀錄格式有誤，請先修正或清空後再套用。')}
  const key=x=>x.sheet+'|'+Number(x.row);const picked=new Set(picks.map(key));
  return JSON.stringify([...list.filter(x=>!picked.has(key(x))),...picks.map(p=>({sheet:p.sheet,row:p.row,note:who}))]);
 }
 // 把勾選列直接輸入／選好的欄位值併入既有介面補值紀錄（同頁同列同欄位以新的為準）；確認人與日期不可空白
 function buildFieldFills(existingText,entries,confirmer){
  const who=String(confirmer||'').trim();
  if(!entries.length)throw Error('請至少勾選一筆並填入數值。');
  if(!who)throw Error('請填寫確認人與日期，例如「王小明 10/07 確認可留白」。');
  let list=[];const raw=String(existingText||'').trim();
  if(raw){try{list=JSON.parse(raw)}catch{throw Error('進階欄位裡的介面補值格式有誤，請先修正或清空後再套用。')}if(!Array.isArray(list))throw Error('進階欄位裡的介面補值格式有誤，請先修正或清空後再套用。')}
  const key=x=>x.sheet+'|'+Number(x.row)+'|'+x.field;const picked=new Set(entries.map(key));
  return JSON.stringify([...list.filter(x=>!picked.has(key(x))),...entries.map(e=>({sheet:e.sheet,row:e.row,field:e.field,value:e.value,who}))]);
 }
 g.PnBomUi={classify,specCandidates,fillCandidates,buildApprovals,buildFieldFills,CLASSIFY_PRESETS};
 if(typeof document==='undefined')return;
 const $=id=>document.getElementById(id);
 const status=$('status'),shared=$('sharedStatus'),sheets=$('sheets'),reportBtn=$('report');
 if(!status)return;
 function refresh(){
  const st=classify(status.textContent);status.className=st;
  const connected=/^已(連接|取得)/.test(shared.textContent||'');shared.classList.toggle('ok',connected);
  const filesReady=connected||($('template').files.length&&$('codes').files.length);
  const s1=!!($('source').files.length&&$('mode').value&&filesReady);
  const picked=!!sheets.querySelector('input:checked');
  const s2=!reportBtn.disabled;
  const steps=[[$('step1'),$('card1'),s1],[$('step2'),$('card2'),s2],[$('step3'),$('card3'),s2&&st==='ok']];
  let current=false;
  for(const [li,card,done] of steps){li.classList.toggle('done',done);card.classList.toggle('done',done);const isCurrent=!done&&!current;li.classList.toggle('current',isCurrent);if(isCurrent)current=true}
  $('check').classList.toggle('primary',s1&&picked);
 }
 // 待確認／待補值清單：檢查完成後依明細自動列出。規格可勾「允許留白」或直接填值；
 // 產品分類／細項產品別／市場分類可選預設組合或自行輸入；「全選」方便列數多時一次勾選。
 const panel=$('specPanel'),specList=$('specList'),specMsg=$('specMsg'),selectAll=$('specSelectAll');
 const PRESET_LABEL=p=>`市場分類＝${p.市場分類}／產品分類＝${p.產品分類}／細項產品別＝${p.細項產品別}`;
 function refreshSpec(){
  const items=reportBtn.disabled?[]:fillCandidates($('details').textContent);
  specList.replaceChildren();specMsg.textContent='';panel.hidden=!items.length;selectAll.checked=false;
  for(const it of items){
   const row=document.createElement('div');row.className='spec-row';row.dataset.sheet=it.sheet;row.dataset.row=String(it.row);
   const head=document.createElement('label');const rowBox=document.createElement('input');rowBox.type='checkbox';rowBox.className='spec-row-pick';
   head.append(rowBox,document.createTextNode(`「${it.sheet}」頁第 ${it.row} 列：缺 ${it.fields.join('、')}`));row.append(head);
   const classifyFields=it.fields.filter(f=>f!=='規格');
   if(classifyFields.length){
    const sel=document.createElement('select');sel.className='spec-preset';
    sel.append(new Option('選預設組合…',''));CLASSIFY_PRESETS.forEach((p,i)=>sel.append(new Option(PRESET_LABEL(p),String(i))));
    row.append(sel);
    const inputs={};for(const f of ['市場分類','產品分類','細項產品別']){if(!classifyFields.includes(f))continue;const wrap=document.createElement('label');wrap.className='spec-field';const inp=document.createElement('input');inp.type='text';inp.dataset.field=f;inp.placeholder=f;wrap.append(document.createTextNode(f+'：'),inp);row.append(wrap);inputs[f]=inp}
    sel.addEventListener('change',()=>{if(!sel.value)return;const p=CLASSIFY_PRESETS[Number(sel.value)];for(const f in inputs)inputs[f].value=p[f]});
   }
   if(it.fields.includes('規格')){
    const blankLabel=document.createElement('label');blankLabel.className='spec-field';const blankBox=document.createElement('input');blankBox.type='checkbox';blankBox.className='spec-blank';blankLabel.append(blankBox,document.createTextNode('允許規格留白'));
    const valWrap=document.createElement('label');valWrap.className='spec-field';const valInp=document.createElement('input');valInp.type='text';valInp.className='spec-value';valInp.dataset.field='規格';valInp.placeholder='或直接填規格值';valWrap.append(document.createTextNode('規格：'),valInp);
    row.append(blankLabel,valWrap);
   }
   specList.append(row);
  }
 }
 selectAll.addEventListener('change',()=>{for(const b of specList.querySelectorAll('.spec-row-pick'))b.checked=selectAll.checked});
 $('specApply').addEventListener('click',()=>{
  const fillEntries=[],blankPicks=[];
  for(const row of specList.querySelectorAll('.spec-row')){
   if(!row.querySelector('.spec-row-pick').checked)continue;
   const sheet=row.dataset.sheet,rowNo=Number(row.dataset.row);
   for(const inp of row.querySelectorAll('input[type=text][data-field]')){const v=inp.value.trim();if(v)fillEntries.push({sheet,row:rowNo,field:inp.dataset.field,value:v})}
   const blankBox=row.querySelector('.spec-blank'),specValInp=row.querySelector('.spec-value');
   if(blankBox&&blankBox.checked&&!(specValInp&&specValInp.value.trim()))blankPicks.push({sheet,row:rowNo});
  }
  if(!fillEntries.length&&!blankPicks.length){specMsg.textContent='請至少勾選一列，並填入數值或勾選「允許規格留白」。';return}
  // 先驗證兩份紀錄，再一起寫入，避免一半成功一半失敗。
  let fills,approvals;
  try{
   if(fillEntries.length)fills=buildFieldFills($('fieldFills').value,fillEntries,$('specConfirmer').value);
   if(blankPicks.length)approvals=buildApprovals($('approvals').value,blankPicks,$('specConfirmer').value);
  }catch(e){specMsg.textContent=e.message;return}
  for(const [id,value] of [['fieldFills',fills],['approvals',approvals]])if(value!==undefined){const box=$(id);box.value=value;box.dispatchEvent(new Event('input',{bubbles:true}))}
  $('check').click();
 });
 new MutationObserver(refreshSpec).observe($('details'),{childList:true,characterData:true,subtree:true});
 new MutationObserver(refreshSpec).observe(reportBtn,{attributes:true,attributeFilter:['disabled']});
 const watch=new MutationObserver(refresh);
 for(const el of [status,shared,sheets])watch.observe(el,{childList:true,characterData:true,subtree:true});
 for(const el of [$('export'),reportBtn])watch.observe(el,{attributes:true,attributeFilter:['disabled']});
 for(const id of ['source','template','codes','mode'])$(id).addEventListener('change',refresh);
 sheets.addEventListener('change',refresh);
 $('approvalsExample').addEventListener('click',()=>{
  const box=$('approvals');if(box.value.trim()&&!confirm('要用範例格式取代目前內容嗎？'))return;
  box.value='[{"sheet":"頁籤名稱","row":10,"note":"RD 某某 日期 確認此料規格可留白"}]';
  box.dispatchEvent(new Event('input',{bubbles:true}));box.focus();
 });
 refresh();refreshSpec();
})(typeof window==='undefined'?globalThis:window);
