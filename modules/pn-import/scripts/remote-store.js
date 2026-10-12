(function(g){
'use strict';
// 以存取碼向 Apps Script 取得公司匯入範本與代碼表。
// - 網址公開無妨：沒有正確存取碼拿不到檔案。存取碼只存在使用者自己的瀏覽器（勾選「記住」時）。
// - 檔案只在記憶體中使用，不寫入瀏覽器儲存空間；RD 申請檔不會送出。
const ENDPOINT='https://script.google.com/macros/s/AKfycbxnFH3wQWc2irO63wzbZsasVUMUEiYfsY5hFjMbGo4_FVjXqNU-jIdmNirZxqI5O9xl/exec';
const KEY='pnImport.accessCode';
const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function remembered(){try{return g.localStorage.getItem(KEY)||''}catch{return ''}}
function remember(code){try{g.localStorage.setItem(KEY,code)}catch{}}
function forget(){try{g.localStorage.removeItem(KEY)}catch{}}
function toFile(item){const bin=g.atob(item.base64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new g.File([bytes],item.name,{type:XLSX,lastModified:Date.parse(item.updated)||Date.now()})}
async function fetchFiles(code,{fetchImpl=g.fetch.bind(g),timeoutMs=30000}={}){
 code=String(code||'').trim();if(!code)throw Error('請先輸入存取碼');
 const ctrl=typeof AbortController==='function'?new AbortController():null,timer=ctrl&&setTimeout(()=>ctrl.abort(),timeoutMs);
 let res;
 try{res=await fetchImpl(ENDPOINT,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({key:code}),redirect:'follow',signal:ctrl?.signal})}
 catch(e){throw Error(e?.name==='AbortError'?'連線逾時，請稍後再試':'無法連線到公司範本服務，請確認網路後再試')}
 finally{if(timer)clearTimeout(timer)}
 let data;try{data=await res.json()}catch{throw Error('公司範本服務回應格式不正確，請稍後再試')}
 if(!data||!data.ok)throw Error(data?.error||'取得公司範本失敗');
 const t=data.files?.template,c=data.files?.codes;if(!t?.base64||!c?.base64)throw Error('公司範本服務缺少範本或代碼表，請聯絡維護者');
 return {template:toFile(t),codes:toFile(c),folderName:'雲端公司範本（存取碼）'};
}
g.PnBomRemote={fetchFiles,remembered,remember,forget,ENDPOINT};
})(typeof window==='undefined'?globalThis:window);
