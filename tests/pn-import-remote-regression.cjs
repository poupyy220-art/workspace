'use strict';
// 📝 PN 申請匯入草稿：以存取碼取得公司範本與代碼表（全虛構資料，不連網）
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const dir=path.join(__dirname,'..','modules','pn-import');
const results=[];const test=async(name,fn)=>{await fn();results.push(name)};

function remoteCtx(store={}){
 const ctx=vm.createContext({window:{},atob:s=>Buffer.from(s,'base64').toString('binary'),File:class{constructor(parts,name,opt){this.parts=parts;this.name=name;this.type=opt.type;this.lastModified=opt.lastModified;this.size=parts.reduce((n,p)=>n+p.length,0)}},AbortController,setTimeout,clearTimeout,
  localStorage:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}}});
 ctx.window=ctx;vm.runInContext(fs.readFileSync(path.join(dir,'scripts/remote-store.js'),'utf8'),ctx);return {R:ctx.PnBomRemote,store};
}
const ok=(files)=>async()=>({json:async()=>({ok:true,files})});
const file=(name,bytes)=>({name,updated:'2026-10-12T06:00:00.000Z',size:bytes.length,base64:Buffer.from(bytes).toString('base64')});

(async()=>{
 await test('正確存取碼：以 POST 純文字送出存取碼，回傳兩個 xlsx 檔案物件',async()=>{
  const {R}=remoteCtx();let seen;
  const out=await R.fetchFiles(' ABC123 ',{fetchImpl:async(url,opt)=>{seen={url,opt};return {json:async()=>({ok:true,files:{template:file('Bom Import (1).xlsx',[1,2,3]),codes:file('代碼表.xlsx',[4,5])}})}}});
  assert.equal(seen.opt.method,'POST');assert.match(seen.opt.headers['Content-Type'],/^text\/plain/);assert.equal(JSON.parse(seen.opt.body).key,'ABC123');
  assert.equal(seen.url,R.ENDPOINT);assert.match(R.ENDPOINT,/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/);
  assert.equal(out.template.name,'Bom Import (1).xlsx');assert.equal(out.codes.name,'代碼表.xlsx');assert.equal(out.template.size,3);assert.match(out.template.type,/spreadsheetml/);
 });
 await test('錯誤存取碼：顯示服務端原因，不回傳檔案',async()=>{
  const {R}=remoteCtx();await assert.rejects(R.fetchFiles('WRONG',{fetchImpl:async()=>({json:async()=>({ok:false,error:'存取碼不正確'})})}),/存取碼不正確/);
 });
 await test('空白存取碼：不連線直接提示',async()=>{
  const {R}=remoteCtx();let called=false;await assert.rejects(R.fetchFiles('  ',{fetchImpl:async()=>{called=true}}),/請先輸入存取碼/);assert.equal(called,false);
 });
 await test('網路失敗、逾時、回應格式錯誤、缺檔：各自給白話訊息',async()=>{
  const {R}=remoteCtx();
  await assert.rejects(R.fetchFiles('X',{fetchImpl:async()=>{throw new TypeError('Failed to fetch')}}),/無法連線/);
  await assert.rejects(R.fetchFiles('X',{timeoutMs:10,fetchImpl:(u,o)=>new Promise((_,rej)=>o.signal.addEventListener('abort',()=>{const e=new Error('aborted');e.name='AbortError';rej(e)}))}),/逾時/);
  await assert.rejects(R.fetchFiles('X',{fetchImpl:async()=>({json:async()=>{throw new SyntaxError('bad')}})}),/格式不正確/);
  await assert.rejects(R.fetchFiles('X',{fetchImpl:ok({template:file('a.xlsx',[1])})}),/缺少範本或代碼表/);
 });
 await test('記住／忘記存取碼只動自己的鍵；無法使用瀏覽器儲存時不出錯',async()=>{
  const store={other:'keep'};const {R}=remoteCtx(store);R.remember('ABC');assert.equal(R.remembered(),'ABC');R.forget();assert.equal(R.remembered(),'');assert.equal(store.other,'keep');
  const ctx=vm.createContext({window:{},localStorage:{getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}}});ctx.window=ctx;
  vm.runInContext(fs.readFileSync(path.join(dir,'scripts/remote-store.js'),'utf8'),ctx);assert.equal(ctx.PnBomRemote.remembered(),'');ctx.PnBomRemote.remember('x');ctx.PnBomRemote.forget();
 });
 await test('網頁：只允許連到 Google Apps Script；載入 remote-store、無固定資料夾殘留',async()=>{
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  assert.match(html,/connect-src https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com;/);
  assert.match(html,/scripts\/remote-store\.js/);assert.doesNotMatch(html,/folder-store|replaceSharedFolder|連接固定資料夾/);
  for(const id of ['accessCode','rememberCode','sharedFolder','forgetSharedFolder','template','codes'])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/id="accessCode" type="password"/);
 });
 await test('頁面流程：取得範本→記住存取碼；檢查時優先使用雲端範本；忘記後清除',async()=>{
  const nodes={};const el=(id)=>nodes[id]??={id,value:'',checked:true,files:[],disabled:false,textContent:'',listeners:{},addEventListener(t,f){(this.listeners[t]??=[]).push(f)},replaceChildren(){},querySelectorAll(){return []},querySelector(){return null}};
  const store={};const calls=[];
  const ctx=vm.createContext({document:{getElementById:el},setTimeout,Blob,
   PnBomRemote:{remembered:()=>store.code||'',remember:c=>{store.code=c},forget:()=>{delete store.code},fetchFiles:async c=>{calls.push(c);if(c!=='GOOD')throw Error('存取碼不正確');return {template:{name:'T',lastModified:0},codes:{name:'C',lastModified:0},folderName:'雲端公司範本（存取碼）'}}},
   PnBomReport:{writeIntegrated:async()=>new Blob(['x']),dateTag:()=>'2026-10-12'},PnBomIO:{read:async f=>({sheets:[],src:f.name})}});
  vm.runInContext(fs.readFileSync(path.join(dir,'scripts/app.js'),'utf8'),ctx);
  el('accessCode').value='BAD';await el('sharedFolder').onclick();assert.match(el('sharedStatus').textContent,/未取得.*存取碼不正確/);assert.equal(store.code,undefined);
  el('accessCode').value='GOOD';el('rememberCode').checked=true;await el('sharedFolder').onclick();assert.match(el('sharedStatus').textContent,/^已取得雲端公司範本/);assert.equal(store.code,'GOOD');assert.equal(el('sharedFolder').disabled,false);
  assert.equal(vm.runInContext('sharedFiles.template.name',ctx),'T');
  el('accessCode').value='GOOD';el('rememberCode').checked=false;delete store.code;await el('sharedFolder').onclick();assert.equal(store.code,undefined,'取消勾選時不記住');
  el('forgetSharedFolder').onclick();assert.equal(el('accessCode').value,'');assert.equal(vm.runInContext('sharedFiles',ctx),null);assert.match(el('sharedStatus').textContent,/已忘記存取碼/);
  assert.deepEqual(calls,['BAD','GOOD','GOOD']);
 });
 await test('頁面載入：有記住的存取碼時自動取得範本；記住的碼失效時提示重輸',async()=>{
  for(const [code,expect] of [['GOOD',/^已取得/],['OLD',/記住的存取碼無法使用/]]){
   const nodes={};const el=(id)=>nodes[id]??={id,value:'',checked:true,files:[],disabled:false,textContent:'',listeners:{},addEventListener(t,f){(this.listeners[t]??=[]).push(f)},replaceChildren(){},querySelectorAll(){return []}};
   const ctx=vm.createContext({document:{getElementById:el},setTimeout,Blob,PnBomRemote:{remembered:()=>code,remember(){},forget(){},fetchFiles:async c=>{if(c!=='GOOD')throw Error('存取碼不正確');return {template:{lastModified:0},codes:{lastModified:0},folderName:'雲端公司範本（存取碼）'}}}});
   vm.runInContext(fs.readFileSync(path.join(dir,'scripts/app.js'),'utf8'),ctx);await new Promise(r=>setTimeout(r,20));
   assert.equal(el('accessCode').value,code);assert.match(el('sharedStatus').textContent,expect);
  }
 });
 console.log('PASS '+results.length+'：'+results.join('；'));
})().catch(e=>{console.error(e);process.exitCode=1});
