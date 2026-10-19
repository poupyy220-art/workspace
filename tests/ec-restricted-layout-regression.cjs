const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ExcelJS = require(process.env.EXCELJS_PATH || 'exceljs');
const root = path.resolve(__dirname, '..');
function extract(html) {
  const encoded = html.match(/id="page-ec"[\s\S]*?base64,([^"]+)/)[1];
  const page = Buffer.from(encoded, 'base64').toString('utf8');
  return page.slice(page.indexOf('    function ecKey(') >= 0 ? page.indexOf('    function ecKey(') : page.indexOf('    async function startAnalysis()'), page.lastIndexOf('</script>'));
}
async function generate(html, rows, mapping, out, pn = []) {
  let downloaded;
  const ctx = { ExcelJS, Blob, console, screen: { availWidth: 1280 },
    combinedRawData: structuredClone(rows), cloudMapping: mapping, externalMapping: null, INTERNAL_SPB_DB: [],
    isMappingLoading: false, isGenerating:false, document: { getElementById: id => ({ value: 'TEST', textContent: 'test.xlsx' }) },
    pullSPBMapping: async()=>true, readDatabase:async()=>pn,
    alert(message) { if(!message.startsWith('✅')) throw new Error(message); }, saveAs(blob) { downloaded = blob; } };
  new vm.Script(extract(html)); // Syntax check; execute in the same realm as ExcelJS arrays.
  await new Function(...Object.keys(ctx), extract(html) + '\nreturn startAnalysis();')(...Object.values(ctx));
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  if(out) fs.writeFileSync(out, bytes);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
  return wb;
}
async function run() {
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  const map = [{'SPB MTM前5碼':'ABCDS','MTM前4碼':'ABCD',Status:'SPB MTM',Project:'Test Project',SE:'Test SE','SPM PIC':'Test SPM'},
    {'SPB MTM前5碼':'EFGHS','MTM前4碼':'EFGH',Project:'Test Other',SE:'Test Other SE','SPM PIC':'Test Other SPM'}];
  const row = (ec,mtm,ct='ChgBom')=>({'Lenovo EC/Doc Number':ec,'MTM/Part':mtm,'Change Type':ct,Qty:2,'Name':'Long description '.repeat(8),'Child Part':'CHILD','Lenovo EC/Doc Name':'Test EC',disposition:'19'});
  const rows=[row('CTO_TEST','CTOSBB_EFGHCTO1WW'),row('4000_TEST','ABCD000001'),row('4000_TEST2','ABCDS00001'),row('2000_TEST','SBBTEST'),row('CTO_UNKNOWN','CTOSBB_ZZZZCTO1WW'),row('4000_NONE','ABCD000002','None'),row('4000_NEW','ABCD000003','New')];
  const out=process.env.EC_TEST_OUTPUT;
  const w=await generate(html,rows,map,out);
  let n=0; const check=(ok,msg)=>{ assert(ok,msg); n++; };
  check(w.worksheets.map(s=>s.name).join('|')==='Summary|Combine EC|SPB Mapping|SPM MTM清單','sheet order');
  const sum=w.getWorksheet('Summary'), comb=w.getWorksheet('Combine EC');
  check(sum.getCell('H1').value==='備註' && sum.getCell('G1').value==='PIC','note after PIC');
  check(sum.getCell('D2').value==='Test Other' && sum.getCell('G2').value==='Test Other SE','clean project/PIC');
  check(sum.getCell('H2').value.includes('94%') && sum.getCell('H2').value.includes('CTO'),'reason retained');
  check(sum.getCell('K2').value==='Test Other','clean stats project');
  check(comb.getRow(1).values.slice(1,4).join('|')==='順序|Status|PIC','A/B/C ordering');
  check(comb.rowCount===7,'filtered data count');
  check(comb.getCell('I2').value===2 && typeof comb.getCell('I2').value==='number','native Qty');
  check(comb.getCell('C2').value==='Test Other SE' && comb.getCell('Q2').value.includes('94%'),'combine names/notes');
  check(comb.getCell('C3').value==='Test SE' && comb.getCell('C4').value==='ido_su-蘇震','normal SE and fixed SPB Ido');
  check(!comb.getCell('Q3').value && comb.getCell('Q6').value.includes('找不到 CTO'),'unmatched CTO disclosed');
  check(comb.pageSetup.fitToWidth===1 && comb.pageSetup.fitToHeight===0 && comb.pageSetup.orientation==='landscape','one page wide, all rows retained');
  check(comb.views[0].zoomScale===100 && comb.views[0].ySplit===1,'user zoom and frozen header');
  check(comb.autoFilter==='A1:Q7' && sum.autoFilter==='A1:H6','filters cover actual data without statistics');
  check(comb.getColumn(11).hidden && comb.getRow(2).height===16.5,'empty substitutes hidden, user row height');
  for(const s of w.worksheets) for(let r=1;r<=s.rowCount;r++) for(let c=1;c<=s.columnCount;c++) {
    const cell=s.getCell(r,c);
    check(cell.font.name==='Comic Sans MS' && cell.font.size===(s.name==='Combine EC' && [6,17].includes(c)?8:10),'font with user overrides');
    const active = s.name !== 'Summary' || (c <= 8 && r <= 6) || (c >= 10 && r <= 7);
    check(['top','left','bottom','right'].every(side=>active ? cell.border[side]?.style==='thin' : !cell.border?.[side]?.style),'independent table borders');
    if(r===1) check(active ? cell.fill.fgColor.argb==='FFFFFFCC' : cell.fill.pattern==='none','header yellow only in tables');
    check(cell.type!==ExcelJS.ValueType.Error,'no Excel error');
  }
  // Compare every pre-existing output field against the released baseline.
  if(process.env.EC_BASELINE_HTML){
    const b=await generate(fs.readFileSync(process.env.EC_BASELINE_HTML,'utf8'),rows,map);
    const clean=v=>typeof v==='string'?v.replace('（自動判斷，約94%準確率，建議人工複核）','').replace('（建議，請複核）',''):v;
    for(const name of ['Combine EC','SPB Mapping','SPM MTM清單']){
      const old=b.getWorksheet(name), next=w.getWorksheet(name), headers=next.getRow(1).values;
      check(old.rowCount===next.rowCount,'baseline row count '+name);
      for(let c=1;c<=old.columnCount;c++){
        const nc=headers.indexOf(old.getCell(1,c).value); check(nc>0,'column retained');
        for(let r=2;r<=old.rowCount;r++) check(clean(old.getCell(r,c).value)===next.getCell(r,nc).value,'data retained '+name+' '+r+','+c);
      }
    }
  }
  const shared = map.map(m=>({...m,SE:'Shared SE','SPM PIC':'Shared SE'}));
  const grouped=await generate(html,[row('CTO_SAME','CTOSBB_ABCDCTO1WW'),row('CTO_SAME','CTOSBB_EFGHCTO1WW'),row('CTO_SAME','CTOSBB_EFGHCTO1WW')],shared);
  const gs=grouped.getWorksheet('Summary');
  check(gs.getCell('B2').value==='CTO_SAME' && gs.getCell('B3').value==='CTO_SAME' && !gs.getCell('B4').value,'same EC and PIC retains two projects, duplicate group collapsed');
  check(gs.getCell('D2').value==='Test Project' && gs.getCell('D3').value==='Test Other','both project names retained');
  check(gs.getCell('G2').value==='Shared SE' && gs.getCell('G3').value==='Shared SE','shared PIC');
  check(gs.getCell('L2').value===1 && gs.getCell('L3').value===2 && gs.getCell('L4').value===3,'statistics count rows, not unique groups');
  for (const value of ['SUBSTITUTE',0]) {
    const v=await generate(html,[{...row('4000_SUB','ABCD000001'),'Substitute Relationship':value}],map);
    check(!v.getWorksheet('Combine EC').getColumn(11).hidden,'nonempty substitutes remain visible');
  }
  console.log(`PASS ${n}; FAIL 0; unreadable 0`);
}
module.exports={extract,generate};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
