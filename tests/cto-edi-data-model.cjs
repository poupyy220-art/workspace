const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','modules','cto-edi','data-model.js'),'utf8');
const context={window:{},Date};
vm.runInNewContext(source,context,{filename:'data-model.js'});
const model=context.window.CtoEdiDataModel;

const project={
  id:'P-001',project:'Neo Demo',mtmFamily:'ThinkCentre Demo',bomDate:'2026-08-31',owner:'May',
  projectStage:'接近量產',ediStatus:'Yes',labelStatus:'需要',fanyPptName:'example.ppt',pptConfirmed:true,
  labelPn:'DEMO-LABEL-PN',labelUsage:'1',rdFileName:'RD.xlsx',mtms:['13SS','13SW'],checks:{
    asked:true,reply:true,mapping:true,nameSpec:true,projectRule:true,palletRule:true,validated:true
  }
};
const payload=model.exportPayload([project],raw=>String(raw||'').split(/\s+/).filter(Boolean));

assert.equal(payload.schema_version,'1.0');
assert.equal(payload.projects.length,1);
assert.equal(payload.mtms.length,2);
assert.equal(payload.projects[0].project_id,'P-001');
assert.equal(payload.projects[0].checklist_status,'READY_FOR_IT');
assert.deepEqual(Array.from(payload.mtms,x=>x.mtm_prefix),['13SS','13SW']);
assert.deepEqual(Array.from(payload.mtms,x=>x.spb_mtm_prefix),['13SSS','13SWS']);
assert.deepEqual(Array.from(payload.mtms,x=>x.cto_pn),['CTOSBB_13SSCTO1WW','CTOSBB_13SWCTO1WW']);
assert.ok(payload.exported_at);
console.log('CTO EDI data model: 9 PASS, 0 FAIL');
