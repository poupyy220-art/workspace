// CTO EDI 表單草稿：輸入自動存在本機瀏覽器、重新整理後帶回、產生成功後清除；檔案欄與人工確認勾選不保存。資料皆為虛構。
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const file=path.join(__dirname,'..','modules','cto-edi','form-draft.js');
const context={window:{}};
if(fs.existsSync(file))vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:'form-draft.js'});
const Draft=context.window.CtoEdiFormDraft;

function storage(){const data={};return{data,getItem:k=>k in data?data[k]:null,setItem:(k,v)=>{data[k]=String(v)},removeItem:k=>{delete data[k]}}}
function doc(values){const els={};for(const [id,v] of Object.entries(values))els[id]=typeof v==='boolean'?{type:'checkbox',checked:v}:{type:'text',value:v};return{els,getElementById:id=>els[id]||null}}
const IDS=['project','owner','mtm','labelPn','pptConfirmed'];

let pass=0,fail=0;
function check(name,fn){try{fn();pass++;console.log('PASS',name)}catch(e){fail++;console.log('FAIL',name,'-',e.message)}}

check('CtoEdiFormDraft 已提供',()=>assert.equal(typeof (Draft&&Draft.create),'function'));
check('存草稿後在新頁面帶回同樣內容',()=>{const s=storage(),d1=doc({project:'Demo X',owner:'May',mtm:'TS01\nTS02',labelPn:'900-TEST-01A',pptConfirmed:true});
  Draft.create(s,d1,IDS,()=>1000).save();
  const d2=doc({project:'',owner:'',mtm:'',labelPn:'',pptConfirmed:false});const savedAt=Draft.create(s,d2,IDS,()=>2000).restore();
  assert.equal(savedAt,1000);assert.equal(d2.els.project.value,'Demo X');assert.equal(d2.els.mtm.value,'TS01\nTS02');assert.equal(d2.els.labelPn.value,'900-TEST-01A')});
check('人工確認勾選不保存（重新整理後要重新確認）',()=>{const s=storage(),d1=doc({project:'Demo X',pptConfirmed:true});Draft.create(s,d1,IDS).save();const d2=doc({project:'',pptConfirmed:false});Draft.create(s,d2,IDS).restore();assert.equal(d2.els.pptConfirmed.checked,false)});
check('檔案欄不保存',()=>{const s=storage(),d1=doc({project:'Demo X'});d1.els.baseFile={type:'file',value:'C:\\fakepath\\a.xlsx'};Draft.create(s,d1,[...IDS,'baseFile']).save();assert.ok(!s.data[Draft.KEY].includes('fakepath'))});
check('全部欄位都空白時不存草稿',()=>{const s=storage();Draft.create(s,doc({project:'',owner:'',mtm:''}),IDS).save();assert.equal(s.getItem(Draft.KEY),null)});
check('清除後不再帶回',()=>{const s=storage();const d=Draft.create(s,doc({project:'Demo X'}),IDS);d.save();d.clear();assert.equal(Draft.create(s,doc({project:''}),IDS).restore(),null)});
check('沒有草稿或資料壞掉時回 null、不報錯',()=>{const s=storage();assert.equal(Draft.create(s,doc({project:''}),IDS).restore(),null);s.setItem(Draft.KEY,'{壞掉');assert.equal(Draft.create(s,doc({project:''}),IDS).restore(),null)});
check('瀏覽器禁止存取 storage 時不報錯',()=>{const bad={getItem(){throw new Error('denied')},setItem(){throw new Error('denied')},removeItem(){throw new Error('denied')}};const d=Draft.create(bad,doc({project:'Demo X'}),IDS);d.save();assert.equal(d.restore(),null);d.clear()});

console.log(`${pass} PASS / ${fail} FAIL`);
if(fail)process.exit(1);
