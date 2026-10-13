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
 g.PnBomUi={classify,specCandidates,buildApprovals};
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
 // 規格空白料號清單：檢查完成後依明細自動列出，打勾＋確認人即可寫入確認紀錄並重新檢查
 const panel=$('specPanel'),specList=$('specList'),specMsg=$('specMsg');
 function refreshSpec(){
  const items=reportBtn.disabled?[]:specCandidates($('details').textContent);
  specList.replaceChildren();specMsg.textContent='';panel.hidden=!items.length;
  for(const it of items){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.dataset.sheet=it.sheet;box.dataset.row=String(it.row);label.append(box,document.createTextNode(`「${it.sheet}」頁第 ${it.row} 列：規格空白`));specList.append(label)}
 }
 $('specApply').addEventListener('click',()=>{
  const picks=Array.from(specList.querySelectorAll('input:checked')).map(b=>({sheet:b.dataset.sheet,row:Number(b.dataset.row)}));
  let value;try{value=buildApprovals($('approvals').value,picks,$('specConfirmer').value)}catch(e){specMsg.textContent=e.message;return}
  const box=$('approvals');box.value=value;box.dispatchEvent(new Event('input',{bubbles:true}));$('check').click();
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
