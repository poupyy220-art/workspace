const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const line=fs.readFileSync(path.join(root,'integrations/bom-feedback/Line.gs'),'utf8');
const block=s=>s.slice(s.indexOf('// PN_MAP_DATE_BEGIN'),s.indexOf('// PN_MAP_DATE_END'));
assert.equal(block(html),block(line),'browser and LINE must use identical date rules');
const elements={}, storage={};let response, requests=0;
const ctx=vm.createContext({Date,Number,Array,String,JSON,Promise,Error,
 document:{getElementById:id=>elements[id]||(elements[id]={})},
 localStorage:{setItem:(k,v)=>storage[k]=v},GAS_URL:'https://example.invalid/exec',
 fetch:async()=>{requests++;if(response instanceof Error)throw response;return response;}});
vm.runInContext(html.slice(html.indexOf('var pnMapDB = []'),html.indexOf('function custSetStatus')),ctx);
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
const summary=rows=>ctx.pnMapDateSummary(rows);
test('UTC date rolls forward to Taiwan calendar day',()=>assert.equal(summary([['更新日'],['2026-09-30T16:00:00Z']]).latest,'2026-10-01'));
test('latest date is independent of row order and other headers',()=>assert.equal(summary([['更新日','2026-09-20T16:00:00Z'],['2026/9/29'],['2026/10/01'],['2026/9/30']]).latest,'2026-10-01'));
test('invalid and blank dates are reported without guessing',()=>{const s=summary([['更新日','Part Number'],['2026-02-30','fake'],['','fake'],['bad','fake'],['2026-10-01','fake']]);assert.equal(s.invalid,2);assert.equal(s.missing,1);assert.match(ctx.pnMapDateLabel(s),/需確認/);});
test('missing and duplicate date columns are unknown',()=>{assert.equal(summary([['date']]).fieldMissing,true);assert.equal(summary([['更新日','更新日']]).fieldMissing,true);});
test('serial numbers and dates without timezone are not guessed',()=>assert.equal(summary([['更新日'],[46000],['2026-10-01T00:00:00']]).invalid,2));
test('empty sheet with header has no invented date',()=>assert.equal(summary([['更新日']]).latest,''));
test('malformed response fails validation',()=>assert.throws(()=>summary({error:'unavailable'})));
test('all inline scripts parse',()=>{for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);new vm.Script(line);});
(async()=>{
 response={ok:true,json:async()=>[['更新日'],['2026-09-30T16:00:00Z']]};
 const first=ctx.pnMapPull();assert.equal(ctx.pnMapPull(),first);await first;
 test('overlapping pulls share one request',()=>assert.equal(requests,1));
 test('success renders source date and saves real read timestamp',()=>{assert.match(elements['pnmap-dates'].textContent,/2026-10-01/);assert.ok(JSON.parse(storage.pnMapDBV1).readAt);});
 const readAt=ctx.pnMapReadAt, before=storage.pnMapDBV1;
 for(const bad of [new Error('network'),{ok:false},{ok:true,json:async()=>({error:'invalid'})}]){
 response=bad;await ctx.pnMapPull();test('failed pull preserves snapshot and successful timestamp',()=>{assert.equal(ctx.pnMapReadAt,readAt);assert.equal(storage.pnMapDBV1,before);assert.match(elements['pnmap-status-bar'].textContent,/載入失敗/);});}
 test('cached snapshot has clear stale state',()=>{ctx.pnMapRenderDates(true);assert.match(elements['pnmap-dates'].textContent,/本機快取/);});
 test('old cache does not invent read time',()=>{ctx.pnMapReadAt='';ctx.pnMapRenderDates(true);assert.match(elements['pnmap-dates'].textContent,/最後成功讀取：尚無紀錄/);});
 response={ok:true,json:async()=>[['更新日']]};await ctx.pnMapPull();
 test('successful empty sheet clears previous data and date',()=>{assert.equal(ctx.pnMapDB.length,0);assert.match(elements['pnmap-dates'].textContent,/尚無有效紀錄/);});
 console.log(`${count} PASS / 0 FAIL`);
})().catch(e=>{console.error(e);process.exitCode=1;});
