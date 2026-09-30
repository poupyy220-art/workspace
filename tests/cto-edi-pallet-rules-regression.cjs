// CTO EDI 棧板清單解析：支援 2 種鍵盤（帶鍵盤／無鍵盤）與 3 種鍵盤（AI／無／常規）專案。資料皆為虛構。
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ExcelJS=require('exceljs');

const source=fs.readFileSync(path.join(__dirname,'..','modules','cto-edi','generator.js'),'utf8');
const context={window:{},generateBtn:{addEventListener(){}},Date};
vm.runInNewContext(source,context,{filename:'generator.js'});
const parse=context.window.CtoEdiPallet.parsePalletRules;

const HEADER=type=>['棧板出貨地','棧板出貨地','AVC PN','1個棧板用量(pcs)','1台機器/用量','1台機器/主件底數','備註',type];
function block(type,mtms,prefix,sbb,{double=true,single=3,west=5,nonWest=6,doubleStart=4}={}){
  const rows=[HEADER(type),
    ['Demo '+type,'出中國',prefix+'-05A',1,1,72,'',sbb],
    [mtms.join('\n'),'非西歐(含HK)',prefix+'-01A',1,1,48,''],
    ['','西歐(下列19國)',prefix+'-02A',1,1,48,''],
    ['','CTO EDI_尾數包材_單層',prefix+'-11A',single,1,single,`CTO EDI 尾數單層${single}台,西歐單層${west}台,非西歐單層${nonWest}台`]];
  if(double)rows.push(['','CTO EDI_尾數包材_雙層',prefix+'-12A',single,1,single*2,`非西歐尾數訂單${doubleStart}台`]);
  return rows;
}
function workbook(...blocks){const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('棧板清單');for(const rows of blocks)for(const r of rows)ws.addRow(r);return wb}

let pass=0;
const MTMS=['DM01','DM02'];

// 2 種鍵盤：帶鍵盤→1、無鍵盤→2，每種都有雙層 → 16 條／MTM
{const rules=parse(workbook(block('帶鍵盤',MTMS,'900-000001','SBBDEMO1'),block('無鍵盤',MTMS,'900-000002','SBBDEMO2')),{mtms:MTMS});
assert.equal(rules.length,16);pass++;
assert.deepEqual([...new Set(rules.map(r=>r.kindCode))],[1,2]);pass++;
const r=rules.find(x=>x.kindCode===1&&x.country==='非西歐'&&x.from===4);assert.equal(r.to,6);assert.equal(r.pn,'900-000001-12A');pass++}

// 3 種鍵盤，無鍵盤／常規沒有雙層 → 8+6+6=20 條（與既有 Neo50q 版面相同）
{const rules=parse(workbook(block('AI鍵盤 SBB',MTMS,'900-000003','SBBA'),block('無鍵盤',MTMS,'900-000004','SBBB',{double:false}),block('常規鍵盤',MTMS,'900-000005','SBBC',{double:false})),{mtms:MTMS});
assert.equal(rules.length,20);pass++;
assert.deepEqual([...new Set(rules.map(r=>r.kindCode))],[1,2,3]);pass++}

// 其他專案的區塊壞掉，不影響本專案
{const broken=block('無鍵盤',['ZZ01'],'900-000009','SBBZ');broken[4][6]='';
const rules=parse(workbook(broken,block('帶鍵盤',MTMS,'900-000001','SBBDEMO1')),{mtms:MTMS});assert.equal(rules.length,8);pass++}

// 單層備註空白 → 指出列號
assert.throws(()=>{const b=block('帶鍵盤',MTMS,'900-000001','SBB1');b[4][6]='';parse(workbook(b),{mtms:MTMS})},/第5列（單層）G 欄備註/);pass++;

// 兩組資料擠在同一區塊（少了標題列）→ 提示插入標題列
assert.throws(()=>{const a=block('帶鍵盤',MTMS,'900-000001','SBB1'),b=block('無鍵盤',MTMS,'900-000002','SBB2').slice(1);parse(workbook([...a,...b]),{mtms:MTMS})},/請在第7列前插入/);pass++;

// 找不到本專案 MTM
assert.throws(()=>parse(workbook(block('帶鍵盤',MTMS,'900-000001','SBB1')),{mtms:['XX99']}),/找不到本專案 MTM/);pass++;

// 單層備註空白時改讀 RD 單層門檻小表；雙層起點＝主要棧板門檻-1
const TABLE=(china=16)=>[[],['','','西歐 (單層)','英國（單層）','美國（單層）','非西歐單層','出中國（單層）'],['Demo 帶鍵盤（SBBT1）','',6,6,6,6,6],['Demo 無鍵盤（SBBT2）','',12,16,16,16,china]];
const noNote=(b)=>{b[4][6]='';b[5][6]='';return b};
{const wb=workbook(noNote(block('帶鍵盤',MTMS,'900-000001','SBBT1')),noNote(block('無鍵盤',MTMS,'900-000002','SBBT2',{single:8})),TABLE());
const rules=parse(wb,{mtms:MTMS});assert.equal(rules.length,16);pass++;
const pick=(k,c)=>JSON.parse(JSON.stringify(rules.filter(r=>r.kindCode===k&&r.country===c).map(r=>[r.from,r.to])));
assert.deepEqual(pick(1,'非西歐'),[[3,5],[5,6],[6,9999]]);pass++;
assert.deepEqual(pick(2,'西歐'),[[8,12],[12,9999]]);pass++;
assert.deepEqual(pick(2,'出中國'),[[8,15],[15,16],[16,9999]]);pass++}

// 小表的中國門檻小於尾數起始 → 擋下請 RD 確認
assert.throws(()=>parse(workbook(noNote(block('無鍵盤',MTMS,'900-000002','SBBT2',{single:8})),TABLE(6)),{mtms:MTMS}),/中國單層門檻 6 台不大於尾數起始 8 台/);pass++;

// 備註與小表數字不同 → 擋下
assert.throws(()=>parse(workbook(block('帶鍵盤',MTMS,'900-000001','SBBT1'),TABLE()),{mtms:MTMS}),/不一致/);pass++;

// 尾數單層／雙層列 E／F 空白 → 依歷史規則補 E=1、F=D
{const b=block('帶鍵盤',MTMS,'900-000001','SBB1');b[4][4]='';b[4][5]='';b[5][4]='';b[5][5]='';
const rules=parse(workbook(b),{mtms:MTMS});
assert.deepEqual(JSON.parse(JSON.stringify(rules.filter(r=>r.pn.endsWith('-11A')||r.pn.endsWith('-12A')).map(r=>[r.usage,r.base]))),[[1,3],[1,3],[1,3],[1,3],[1,3]]);pass++}

// 主要棧板列 E／F 空白 → 擋下，不預設成 1
assert.throws(()=>{const b=block('帶鍵盤',MTMS,'900-000001','SBB1');b[2][5]='';parse(workbook(b),{mtms:MTMS})},/第3列（非西歐\(含HK\)）/);pass++;

console.log(`CTO EDI pallet rules: ${pass} PASS, 0 FAIL`);
