// Run with Playwright available on NODE_PATH. All requests are intercepted; synthetic data only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const pn = Buffer.from(html.match(/src="data:text\/html;charset=utf-8;base64,([^"]+)"/)[1], 'base64').toString('utf8');
const headers = ['料號', '建立時間', '客戶料號', '備註'];
const base = ['DEMO-A', '2026/01/01', 'DEMO-A', 'original'];
let passed = 0;
async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let cloud, posts, mode, errors = [], dialogs = [], accept = true;
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { dialogs.push(d.message()); await (d.type() === 'confirm' && !accept ? d.dismiss() : d.accept()); });
    await page.route('**/*', async route => {
      const req = route.request();
      if (req.url() === 'https://test.invalid/') return route.fulfill({contentType:'text/html', body:pn.replace(/<script[^>]+src=[^>]*><\/script>/g, '')});
      if (!req.url().startsWith('https://test.invalid/exec')) return route.abort();
      if (req.method() === 'GET' && (mode === 'get-fail' || (mode === 'verify-fail' && posts.length))) return route.fulfill({status:503,contentType:'application/json',body:'{"status":"error","message":"offline"}'});
      if (req.method() === 'POST') {
        const payload = JSON.parse(req.postData()); posts.push(payload);
        if (mode !== 'reject') for (const row of payload.data.slice(1)) {
          const copy = [...row]; if (mode === 'wrong-date') copy[1] = '2000/01/01';
          if (mode === 'wrong-note') copy[3] = 'wrong';
          cloud.push(copy);
        }
      }
      await route.fulfill({contentType:'application/json',body:JSON.stringify(req.method()==='POST'?{status:'success'}:[headers,...cloud])});
    });
    const reset = async (input='DEMO-A', rows=[base]) => {
      cloud=rows.map(r=>[...r]);posts=[];mode='ok';accept=true;dialogs=[];errors=[];
      await page.goto('https://test.invalid/');
      await page.evaluate(rows => { globalDB=rows.map(r=>({internalPN:r[0],createdTime:r[1],customerPN:r[2],remarks:r[3]})); document.getElementById('gasUrl').value='https://test.invalid/exec'; waitForPnSync=async()=>{}; }, rows);
      await page.locator('#pnInput').fill(input); await page.evaluate(()=>previewReport3());
    };
    const check = (v,msg) => { assert(v,msg);passed++; };
    const keypart = () => page.evaluate(()=>applyAllScheme('keypart'));
    const write = () => page.evaluate(()=>batchWriteNewPNs());
    await reset(); await keypart();
    check(await page.locator('#dbchk_0').count() === 1, 'Keypart must have a pending save row');
    check(await page.locator('#pnrow_0').innerText().then(s=>s.includes('DEMO-A-001')), 'pending row contains new version');
    await write();
    check(posts.length===1,'one POST');
    check(posts[0].data.length===2,'send only selected additions, never stale DB');
    check(posts[0].data[1][0]==='DEMO-A-001'&&posts[0].data[1][2]==='DEMO-A','internal and customer PN stay distinct');
    check(cloud[0].join('|')===base.join('|'),'old version preserved');
    check(await page.locator('#dbWriteStatus').innerText().then(s=>s.includes('驗證成功')), 'verified success shown');
    await write(); check(posts.length===1,'no duplicate submit after success');
    await reset('DEMO-A\nDEMO-NEW\nDEMO-A'); await keypart();
    check(await page.locator('[id^="dbchk_"]').count()===2,'mixed input and repeated input deduplicated');
    await page.locator('#dbremark_0').fill('custom note');
    await page.locator('#dbchk_1').uncheck();
    await page.evaluate(()=>updRep3(0,'manual'));
    check(await page.locator('#dbchk_0').count()===0,'manual removes pending row');
    await page.evaluate(()=>updRep3(0,'keypart'));
    check(await page.locator('#dbremark_0').inputValue()==='custom note','scheme changes preserve edits');
    check(!(await page.locator('#dbchk_1').isChecked()),'scheme changes preserve selection');
    await write(); check(posts[0].data.length===2,'unchecked rows excluded');
    await reset(); await keypart(); accept=false; await write();check(posts.length===0,'cancel does not write');
    await reset(); await keypart();await page.locator('#dbtime_0').fill('');await write();check(posts.length===0,'missing date blocks');
    await reset(); await keypart();cloud.push(['DEMO-A-001','2026/01/02','DEMO-A','another user']);await write();check(posts.length===0,'existing PN on different date blocks');
    await reset(); await keypart();cloud.push(['DEMO-A-002','2026/01/02','DEMO-A','another user']);await write();check(posts.length===0,'changed latest version blocks');
    await reset(); await keypart();mode='wrong-date';await write();check(await page.locator('#dbWriteStatus').innerText().then(s=>s.includes('待確認')),'wrong date cannot report success');await write();check(posts.length===1,'uncertain write cannot repeat');
    await reset(); await keypart();mode='wrong-note';await write();check(await page.locator('#dbWriteStatus').innerText().then(s=>s.includes('待確認')),'wrong note cannot report success');
    await reset(); await keypart();mode='reject';await write();check(await page.locator('#dbWriteStatus').innerText().then(s=>s.includes('待確認')),'missing write cannot report success');
    await reset(); await keypart();mode='get-fail';await write();check(posts.length===0,'failed preflight must not write');
    await reset(); await keypart();mode='verify-fail';await write();check(await page.locator('#dbWriteStatus').innerText().then(s=>s.includes('待確認')),'unavailable readback cannot report success');await write();check(posts.length===1,'no retry after unavailable readback');
    await reset('DEMO-NEW\nDEMO-NEXT',[]);
    await page.locator('#globalDatePicker').fill('2026-10-01');await page.locator('#globalDatePicker').dispatchEvent('change');
    await page.locator('#globalRemarkInput').fill('shared note');
    await write();check(posts[0].data.slice(1).every(r=>r[1]==='2026/10/01'&&r[3]==='shared note'),'uniform date and remarks preserved');
    await reset('DEMO-NEW\nDEMO-NEXT',[]);await page.locator('#chkAll').uncheck();await write();check(posts.length===0,'unselect all writes nothing');
    await reset('DEMO-NEW',[]);await write();check(posts[0].data[1][0]==='DEMO-NEW','first version still writable');
    check(errors.length===0,'no runtime errors: '+errors.join(';'));
    await reset();await keypart();
    await page.evaluate(async()=>{await Promise.all([batchWriteNewPNs(),batchWriteNewPNs()]);});
    check(posts.length===1,'double click writes once');
    await reset();await keypart();
    await page.evaluate(()=>{window.exported=null;exportExcelWithStyles=(d,n)=>{window.exported={d,n};};downloadReport3();});
    check(await page.evaluate(()=>exported.d[1][1]==='DEMO-A-001'),'download uses current selected PN');
    check(posts.length===0,'download does not write');
    await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async t=>{window.copied=t;}},configurable:true});copyRep3All();});
    check(await page.evaluate(()=>copied.includes('DEMO-A-001')),'copy retains new version');
    check(await page.locator('#preview3Content').evaluate(el=>el.scrollHeight<=el.clientHeight+2),'save controls not clipped by preview height');
    if(process.env.EC_SAVE_XLSX_LIBRARY && process.env.EC_SAVE_DOWNLOAD) {
      await reset();await keypart();await page.addScriptTag({content:fs.readFileSync(process.env.EC_SAVE_XLSX_LIBRARY,'utf8')});
      const download = page.waitForEvent('download');await page.evaluate(()=>downloadReport3());
      await (await download).saveAs(process.env.EC_SAVE_DOWNLOAD);check(fs.statSync(process.env.EC_SAVE_DOWNLOAD).size>0,'actual Excel download');
    }
    if(process.env.EC_SAVE_SCREENSHOT) await page.locator('#preview3Content').screenshot({path:process.env.EC_SAVE_SCREENSHOT});
    console.log(`PASS ${passed}; FAIL 0; unreadable 0`);
  } finally { await browser.close(); }
}
main().catch(e=>{console.error(`PASS ${passed}; FAIL 1: ${e.message}`);process.exitCode=1;});
