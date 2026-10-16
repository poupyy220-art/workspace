// Synthetic inputs only. NODE_PATH may point to an existing Playwright installation.
'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),vm=require('vm'),assert=require('assert/strict');
const {chromium}=require('playwright'),ExcelJS=require('exceljs');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root,'modules/pn-import/scripts/rules.js'),'utf8'),ctx);
const fields=Array.from(ctx.PnBom.fields),checks=[];let browser;
const server=http.createServer((req,res)=>{
 const rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(!rel.startsWith('/modules/pn-import/')&&!rel.startsWith('/modules/bom-validator/'))return res.writeHead(404).end();
 const file=path.resolve(root,'.'+rel);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
});
function check(ok,label){assert(ok,label);checks.push(label);}
async function book(name,rows){const b=new ExcelJS.Workbook();b.addWorksheet(name).addRows(rows);return Buffer.from(await b.xlsx.writeBuffer());}
async function bytes(download){const stream=await download.createReadStream(),chunks=[];for await(const b of stream)chunks.push(b);return Buffer.concat(chunks);}
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
 await page.goto(url+'/modules/pn-import/index.html');
 const seed={'新/舊料':'NEW','英文品名':'TEST PART','繁中品名':'測試件','規格':'TEST','分群碼':'3','來源碼':'P','採購類型':'PP','用量':1,'主件底數':1,'單位':'PCS','機種別':'TEST','Class Code':'AA','產品分類':'','細項產品別':'','市場分類':''};
 const records=[seed,{...seed},{...seed,規格:'',市場分類:'KEEP-M',產品分類:'KEEP-P',細項產品別:'KEEP-D'},{'新/舊料':'OLD',料號:'S000000001',用量:1,主件底數:1},{'新/舊料':'替代',料號:'S000000002',用量:2,主件底數:1}];
 const head=fields.map(f=>f==='新/舊料'?'OLD':f),group=fields.map(f=>f==='新/舊料'?'Bom Usage And Part Information':'');
 const source=await book('Synthetic',[group,head,...records.map(r=>fields.map(f=>r[f]??''))]);
 const template=await book('Bom Import',[[''],fields.map(f=>f.startsWith('階層')?f.slice(2):f)]),codes=await book('Codes',[['Class Code','AA','TEST']]);
 for(const [id,buffer]of [['source',source],['template',template],['codes',codes]])await page.locator('#'+id).setInputFiles({name:'synthetic-'+id+'.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
 await page.locator('#mode').selectOption('standalone');await page.locator('#inspect').click();await page.waitForFunction(()=>document.querySelectorAll('#sheets input[type=checkbox]').length===1);await page.locator('#check').click();await page.locator('#specPanel').waitFor({state:'visible'});
 check(await page.locator('.spec-row').count()===3,'missing fields grouped into three rows');
 await page.locator('#specSelectAll').check();check(await page.locator('.spec-row-pick:checked').count()===3,'select all selects rows');check(await page.locator('.spec-blank:checked').count()===0,'select all does not approve blanks');
 await page.locator('.spec-preset').nth(0).selectOption('0');await page.locator('.spec-value').fill('12V');await page.locator('#specApply').click();check((await page.locator('#specMsg').textContent()).includes('確認人'),'confirmation required');
 await page.locator('#specConfirmer').fill('Synthetic tester 2026-10-13');
 await page.locator('.spec-value').fill('');await page.locator('.spec-blank').check();await page.evaluate(()=>document.getElementById('approvals').value='invalid JSON');await page.locator('#specApply').click();
 check((await page.locator('#specMsg').textContent()).includes('格式有誤')&&(await page.locator('#fieldFills').inputValue())==='','invalid approval does not partially apply field fills');
 await page.evaluate(()=>document.getElementById('approvals').value='');await page.locator('.spec-blank').uncheck();await page.locator('.spec-value').fill('12V');
 await page.locator('#specApply').click();await page.waitForFunction(()=>document.querySelectorAll('.spec-row').length===1);
 const first=JSON.parse(await page.locator('#fieldFills').inputValue());check(first.length===4&&!first.some(x=>x.row===4),'unfilled selected row not auto-filled');
 await page.locator('.spec-row-pick').check();await page.locator('.spec-preset').selectOption('4');await page.locator('#specApply').click();await page.waitForFunction(()=>!document.getElementById('export').disabled);
 const data=await page.locator('#details').textContent();check(!JSON.parse(data).issues.length,'check succeeds after explicit fills');
 const reportPromise=page.waitForEvent('download');await page.locator('#excelReport').click();const report=await reportPromise;
 const reportBytes=await bytes(report);if(process.env.PN_TEST_OUTPUT){fs.mkdirSync(process.env.PN_TEST_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.PN_TEST_OUTPUT,'synthetic-report.xlsx'),reportBytes);fs.writeFileSync(path.join(process.env.PN_TEST_OUTPUT,'synthetic-source.xlsx'),source);}
 // openpyxl handles namespace-prefixed report sheets that ExcelJS omits.
 const verified=spawnSync(process.env.PN_TEST_PYTHON||'python',['-c',`import sys,json,base64,io,openpyxl
d=json.load(sys.stdin)
a=openpyxl.load_workbook(io.BytesIO(base64.b64decode(d['source'])))
b=openpyxl.load_workbook(io.BytesIO(base64.b64decode(d['report'])))
print(json.dumps({'sheets':len(b.sheetnames),'same':list(a['Synthetic'].values)==list(b['Synthetic'].values)}))`],{input:JSON.stringify({source:source.toString('base64'),report:reportBytes.toString('base64')}),encoding:'utf8'});
 assert.equal(verified.status,0,verified.stderr);const reportQA=JSON.parse(verified.stdout);check(reportQA.sheets===5,'integrated report independently reopened with five sheets');check(reportQA.same,'original values preserved');
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const draft=new ExcelJS.Workbook();await draft.xlsx.load(await bytes(await downloadPromise));const sh=draft.worksheets[0];
 check(sh.rowCount===7,'five draft rows');check(sh.getCell('N7').value==='替代','replacement status retained');check(sh.getCell('X7').value===2,'quantity stays numeric');
 check(sh.getCell(3,fields.indexOf('市場分類')+1).value==='SY'&&sh.getCell(3,fields.indexOf('產品分類')+1).value==='LT'&&sh.getCell(3,fields.indexOf('細項產品別')+1).value==='DT','confirmed classification order');check(sh.getCell(5,fields.indexOf('市場分類')+1).value==='KEEP-M','existing classification retained');
 await page.locator('details').filter({has:page.locator('#fieldFills')}).locator('summary').click();await page.locator('#fieldFills').fill('[]');check(await page.locator('#export').isDisabled(),'editing fills invalidates download');
 await page.evaluate(()=>{document.getElementById('approvals').value='previous';document.getElementById('fieldFills').value='previous';});await page.locator('#source').setInputFiles({name:'synthetic-other.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:source});check((await page.locator('#approvals').inputValue())===''&&(await page.locator('#fieldFills').inputValue())==='','new source clears previous confirmation records');
 await page.goto(url+'/modules/bom-validator/index.html');check(await page.locator('#fileInput[type=file]').count()===1,'BOM module opens and file picker exists');check(errors.length===0,'zero browser page errors');
 console.log(JSON.stringify({passed:checks.length,failed:0,unreadable:0,checks},null,2));
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
