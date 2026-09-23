const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const pn = Buffer.from(html.match(/src="data:text\/html;charset=utf-8;base64,([^"]+)"/)[1], 'base64').toString('utf8');
function extract(name) {
  const start = pn.search(new RegExp('    (?:async )?function ' + name + '\\('));
  const end = pn.indexOf('\n    }', start) + 6;
  assert(start >= 0 && end > start, name);
  return pn.slice(start, end);
}
const names = ['loadPnProjectMap8','todayDateValue8','parseLastModified8','resolveMtmPrefix8','buildStagingRows8','processStagingReport8'];
function context(fetcher) {
  const elements = {gasUrl:{value:'https://example.invalid/exec'},csvFiles8:{files:[{}]},factSheetFiles8:{files:[]},pnProjectMapFile8:{files:[]},staging8Summary:{},btnDL8:{style:{}},creater8:{value:'TEST'}};
  const ctx = {Map,Date,console,document:{getElementById:id=>elements[id]},fetchPnJsonWithRetry:fetcher,
    cacheStaging8:[{old:true}],cacheStaging8Meta:{},dbg(){},showLoading(){},alert(){},
    parseFlatfileObjRows8:async()=>[],loadCountryDbMap8:async()=>new Map(),
    loadProjectMap8:async()=>({map:new Map(),conflicts:new Map(),seMap:new Map()})};
  vm.createContext(ctx); vm.runInContext(names.map(extract).join('\n'),ctx);
  return {ctx,elements};
}
async function run() {
 let checks=0;
 const check=(value)=>{assert(value);checks++;};
 for (const source of [html,pn]) for(const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(m[1]);
 checks++;
 let calls=0;
 const {ctx,elements}=context(async(url,options)=>{
   check(url.startsWith('https://example.invalid/exec?sheet=PN_Project_Map&t='));
   check(options.cache==='no-store'); calls++;
   return [['Project Name','Part Number'],['Project A',' sbb-test '],['Project A, Project B','SHARED']];
 });
 const map=await ctx.loadPnProjectMap8(null);
 check(map.get('SBB-TEST')==='Project A'); check(map.get('SHARED')==='Project A, Project B');
 await ctx.loadPnProjectMap8(null);check(calls===2);
 ctx.XLSX={read:()=>({SheetNames:['Other','PN_Project_Map'],Sheets:{PN_Project_Map:{target:true}}}),utils:{sheet_to_json:(ws,opts)=>{check(ws.target&&opts.header===1);return [['Part Number','Project Name'],['LOCAL','Local Project']];}}};
 check((await ctx.loadPnProjectMap8({arrayBuffer:async()=>new ArrayBuffer(0)})).get('LOCAL')==='Local Project');check(calls===2);
 for(const data of [[],{},[['Wrong']], [['Part Number','Project Name']], [['Part Number','Project Name'],['X','A'],['X','B']]]) {
   ctx.fetchPnJsonWithRetry=async()=>data; await assert.rejects(()=>ctx.loadPnProjectMap8(null),/PN_Project_Map/);checks++;
 }
 ctx.fetchPnJsonWithRetry=async()=>{throw Error('connection failed');};
 await assert.rejects(()=>ctx.loadPnProjectMap8(null),/connection failed/);checks++;
 await ctx.processStagingReport8();check(elements.btnDL8.style.display==='none');check(ctx.cacheStaging8.length===0);check(elements.staging8Summary.textContent.includes('處理失敗'));
 const row={'MTM/Part':'SBB-TEST','Change Type':'New','Lenovo EC/Doc Number':'200000000000','disposition':'99','LastModified':'2026-09-23'};
 const build=(r,prefixMap,pnMap)=>ctx.buildStagingRows8(r,new Map(),prefixMap,new Map(),new Map(),'TEST',new Map(),pnMap);
 check(build([row],new Map(),map)[0]['MTM Family']==='Project A');
 check(build([row],new Map([['SBB-','Existing']]),map)[0]['MTM Family']==='Existing');
 check(build([{...row,'MTM/Part':'UNKNOWN'}],new Map(),map)[0]['MTM Family']==='');
 check(build([row,{...row,'Child Part':'CHILD'}],new Map(),map).length===1);
 check(build([row],new Map(),map)[0]['LNV GETC Open Date'] instanceof Date);
 console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
}
if(require.main===module) run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={context,extract,pn};
