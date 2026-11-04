// Synthetic fixtures only. Lock PIC/Project to the EC classifier and test name formatting independently.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const pn=fs.readFileSync(process.env.PN_REPORT_HTML||path.join(root,'modules/pn-report/index.html'),'utf8').replace(/\r\n/g,'\n');
const home=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ec=Buffer.from(home.match(/id="page-ec"[\s\S]*?base64,([^"]+)/)[1],'base64').toString('utf8').replace(/\r\n/g,'\n');
function extract(s,name){const start=s.search(new RegExp('    (?:async )?function '+name+'\\('));const end=s.indexOf('\n    }',start)+6;assert(start>=0&&end>start);return s.slice(start,end)}
const ctx={};vm.createContext(ctx);
vm.runInContext(['englishPic56','resolvePicProject56','prependPicProject56'].map(n=>extract(pn,n)).join('\n'),ctx);
const ecRules=ec.slice(ec.indexOf('            const code = ecKey(mtm);',ec.indexOf('        let data = combinedRawData.filter')),ec.indexOf("            r._pn = '';"));
assert(ecRules.includes('r._pic'));
const original=new Function('r','currentMapping',extract(ec,'ecKey')+'\n'+extract(ec,'uniqueMapping')+'\nconst mtm=r["MTM/Part"];\n'+ecRules+'\nreturn [r._pic,r._project];');
const map=[{'MTM前4碼':'ABCD','SPB MTM前5碼':'ABCDS','CTO PN':'CTOSBB_ABCDCTO1WW',Project:'Synthetic A',SE:'Alex_test-甲'},
 {'MTM前4碼':'EFGH','SPB MTM前5碼':'EFGHS','CTO PN':'CTOSBB_EFGHCTO1WW',Project:'Synthetic B',SE:'Bea.demo-乙, Chris_test-丙'}];
let checks=0;const check=(b,msg)=>{assert(b,msg);checks++};
for(const [input,expected] of [['Alex_test-甲','Alex'],['Bea.demo-乙','Bea'],['Alex_test-甲, Bea.demo-乙','Alex,Bea'],['  Alex_test-甲，Bea.demo-乙 / Chris_test-丙  ','Alex,Bea,Chris'],['Dana','Dana'],['中文',''],[null,'']])check(ctx.englishPic56(input)===expected,'english names '+input);
for(const mtm of ['ABCDS001','ABCD0001','EFGH0001','CTOSBB_ABCDCTO1WW','CTOSBB_EFGHCTO2WW','CTOUNKNOWN','SBBTEST','ZZZZ0001',' abcds001 ']){
 const row={'MTM/Part':mtm,Project:'Supplied project'},base=original({...row},map),actual=ctx.resolvePicProject56(row,map);
 check(actual[1]===base[1],'EC project parity '+mtm);
 check(actual[0]===(base[0].startsWith('ido_')?'Ido':ctx.englishPic56(base[0])),'EC PIC parity '+mtm);
}
assert.throws(()=>ctx.resolvePicProject56({'MTM/Part':'ABCD0001'},[...map,{...map[0],SE:'Conflict'}]),/對照衝突/);checks++;
const numeric=new Date('2026-11-04T00:00:00Z');
const input=[['MTM/Part','Qty','Date'],['ABCD0001',2,numeric]],layout={hiddenCols:[1],redCols:[2],missing:[]};
const result=ctx.prependPicProject56(input,map,layout);
check(result.data[1][3]===2&&result.data[1][4]===numeric,'native values unchanged');
check(result.layout.hiddenCols[0]===3&&result.layout.redCols[0]===4,'indices shifted by two');
check(layout.hiddenCols[0]===1&&input[0].length===3,'source not mutated');
for(const m of pn.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);checks++;
console.log(`PASS ${checks}; FAIL 0; unreadable 0`);
