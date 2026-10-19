const fs=require('fs'),assert=require('assert/strict'),path=require('path');
const {extract,generate}=require('./ec-restricted-layout-regression.cjs');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const code=extract(html);const {latestPN,uniqueMapping}=new Function(code+';return {latestPN,uniqueMapping};')();
let checks=0;function check(v){assert(v);checks++;}
const pn=(...values)=>values.map(v=>({'客戶料號':'ABCDE123','料號':v}));
check(latestPN(pn('PN-002','PN-010','PN-003'),'abcde123').pn==='PN-010');
check(latestPN(pn('PN-001','PN-001'),'ABCDE123').pn==='PN-001');
check(latestPN(pn('PN-001','OTHER-002'),'ABCDE123').pn==='');
check(latestPN(pn('PN','PN-002'),'ABCDE123').note.length>0);
check(latestPN(pn('PN-01','PN-001'),'ABCDE123').pn==='');
check(latestPN(pn('PN-001'),'OTHER').pn==='');
assert.throws(()=>uniqueMapping([{Project:'A',SE:'X',key:'ABCD'},{Project:'B',SE:'X',key:'ABCD'}],'key','ABCD'));checks++;
(async()=>{
 const map=[{'MTM前4碼':'ABCD','SPB MTM前5碼':'ABCDE','CTO PN':'CTOSBB_ABCDCTO1WW',Project:'Test',SE:'SE','量產type':'L10'}];
 const row=mtm=>({'MTM/Part':mtm,'Lenovo EC/Doc Number':'4000TEST','Change Type':'ChgBom'});
 const w=await generate(html,[row('ABCDE123'),row('ABCD123'),row('CTOSBB_ABCDCTO1WW'),row('SBB123')],map,undefined,pn('PN-002','PN-003'));
 const s=w.getWorksheet('Combine EC');
 for(const [sheet,col] of [[w.getWorksheet('Summary'),2],[s,5]]) for(let r=2;r<=sheet.rowCount;r++)check(sheet.getCell(r,col).numFmt==='@');
 check(s.getCell('B2').value==='SPB MTM'&&s.getCell('C2').value==='ido_su-蘇震'&&s.getCell('P2').value==='PN-003');
 check(s.getCell('B3').value==='正常L10'&&s.getCell('C3').value==='SE'&&!s.getCell('P3').value);
 check(s.getCell('B4').value==='CTO類別'&&s.getCell('C4').value==='SE'&&!s.getCell('Q4').value);
 check(s.getCell('B5').value==='SBB類別'&&!s.getCell('P5').value);
 // Exercise actual network reader with a mock transport, including fail-closed errors.
 const page=Buffer.from(html.match(/id="page-ec"[\s\S]*?base64,([^"]+)/)[1],'base64').toString('utf8');
 const reader=page.slice(page.indexOf('    async function readDatabase'),page.indexOf('    async function handleFiles'));
 const read=fetch=>new Function('fetch','GAS_URL','AbortSignal',reader+';return readDatabase;')(fetch,'https://example.invalid',AbortSignal);
 await assert.rejects(read(async()=>({ok:false}))('CustomDB',[]));checks++;
 await assert.rejects(read(async()=>({ok:true,json:async()=>[['wrong'],['x']]}))('CustomDB',['Project']));checks++;
 check((await read(async()=>({ok:true,json:async()=>[['Project'],['Test']]}))('CustomDB',['Project']))[0].Project==='Test');
 console.log(`CustomDB / PN PASS ${checks}; FAIL 0`);
})().catch(e=>{console.error(e);process.exitCode=1;});
