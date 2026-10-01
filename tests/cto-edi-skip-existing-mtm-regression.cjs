// CTO EDI 產生前比對 4 個頁簽既有 MTM：全部已完成→略過、全新→產生、只在部分頁簽→只補缺的頁簽。資料皆為虛構。
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ExcelJS=require('exceljs');

const source=fs.readFileSync(path.join(__dirname,'..','modules','cto-edi','generator.js'),'utf8');
const context={window:{},generateBtn:{addEventListener(){}},Date};
vm.runInNewContext(source,context,{filename:'generator.js'});
const plan=context.window.CtoEdiPallet&&context.window.CtoEdiPallet.planMtms;

const SHEETS=['Mapping','自動加入品名規格','自動加棧板設並','根據專案加入'];
function base(existing){const wb=new ExcelJS.Workbook();for(const name of SHEETS){const ws=wb.addWorksheet(name);ws.addRow(['MTM']);for(const m of existing[name]||[])ws.addRow([m])}return wb}
const all=mtms=>Object.fromEntries(SHEETS.map(n=>[n,mtms]));
const arr=v=>JSON.parse(JSON.stringify(v));

let pass=0,fail=0;
function check(name,fn){try{fn();pass++;console.log('PASS',name)}catch(e){fail++;console.log('FAIL',name,'-',e.message)}}

check('planMtms 已提供',()=>assert.equal(typeof plan,'function'));
check('全新 MTM 全部產生，4 頁都要寫',()=>{const r=plan(base({}),{mtms:['TS01','TS02'],labelNeeded:true});assert.deepEqual(arr(r.todo),['TS01','TS02']);assert.deepEqual(arr(r.skipped),[]);for(const k of ['mapping','nameSpec','projectRule','pallet'])assert.deepEqual(arr(r.lists[k]),['TS01','TS02'],k)});
check('4 頁都已存在的 MTM 自動略過，只補沒做的',()=>{const r=plan(base(all(['TS01','TS02'])),{mtms:['TS01','TS02','TS03'],labelNeeded:true});assert.deepEqual(arr(r.todo),['TS03']);assert.deepEqual(arr(r.skipped),['TS01','TS02']);assert.deepEqual(arr(r.lists.pallet),['TS03'])});
check('不需標籤時，根據專案加入不列入判斷也不寫',()=>{const e=all(['TS01']);e['根據專案加入']=[];const r=plan(base(e),{mtms:['TS01','TS02'],labelNeeded:false});assert.deepEqual(arr(r.todo),['TS02']);assert.deepEqual(arr(r.skipped),['TS01']);assert.deepEqual(arr(r.lists.projectRule),[])});
check('只在部分頁簽存在 → 只補缺的頁簽，其他頁不重複寫',()=>{const e={Mapping:['TS01'],'自動加入品名規格':['TS01'],'根據專案加入':['TS01']};const r=plan(base(e),{mtms:['TS01','TS02'],labelNeeded:true});
  assert.deepEqual(arr(r.filled),[{mtm:'TS01',missing:['自動加棧板設並']}]);
  assert.deepEqual(arr(r.lists.mapping),['TS02']);assert.deepEqual(arr(r.lists.nameSpec),['TS02']);assert.deepEqual(arr(r.lists.projectRule),['TS02']);assert.deepEqual(arr(r.lists.pallet),['TS01','TS02'])});
check('只缺棧板設定的 MTM 單獨處理也可以',()=>{const e={Mapping:['TS01','TS02'],'自動加入品名規格':['TS01','TS02'],'根據專案加入':['TS01','TS02']};const r=plan(base(e),{mtms:['TS01','TS02'],labelNeeded:true});assert.deepEqual(arr(r.todo),[]);assert.deepEqual(arr(r.lists.mapping),[]);assert.deepEqual(arr(r.lists.pallet),['TS01','TS02']);assert.equal(r.filled.length,2)});
check('全部都已完成 → 提示不需產生',()=>assert.throws(()=>plan(base(all(['TS01'])),{mtms:['TS01'],labelNeeded:true}),/不需要再產生/));
check('大小寫不同視為同一 MTM',()=>{const r=plan(base(all(['ts01'])),{mtms:['TS01','TS02'],labelNeeded:true});assert.deepEqual(arr(r.skipped),['TS01'])});

console.log(`${pass} PASS / ${fail} FAIL`);
if(fail)process.exit(1);
