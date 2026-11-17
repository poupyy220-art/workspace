const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync(process.env.PN_REPORT_HTML||path.join(__dirname,'../modules/pn-report/index.html'),'utf8').replace(/\r\n/g,'\n');
const names=['reportScopeKey58','childKeys58','isTopRow58','report5RowExclusion58','report5ExclusionReason'];
const code=names.map(n=>{const i=s.indexOf('    function '+n+'(');assert(i>=0);return s.slice(i,s.indexOf('\n    }',i)+6)}).join('\n');const c={};vm.createContext(c);vm.runInContext(code,c);
const row=(ec,part,child='',ct='')=>({'Lenovo EC/Doc Number':ec,'MTM/Part':part,'Child Part':child,'Change Type':ct});
const top=row('TEST-EC-A','TOP'),detail=row('TEST-EC-A','TOP','CHILD','Insert'),nested=row('TEST-EC-A','CHILD'),other=row('TEST-EC-B','CHILD');const rows=[top,detail,nested,other],keys=c.childKeys58(rows);
assert(c.isTopRow58(top,keys));assert(!c.isTopRow58(nested,keys));assert(!c.isTopRow58(detail,keys));assert(c.isTopRow58(other,keys));
assert.equal(c.report5RowExclusion58(top,'normal',keys),'');assert.equal(c.report5RowExclusion58(detail,'normal',keys),'');assert(c.report5RowExclusion58(nested,'normal',keys));
assert(!c.isTopRow58(row('','TOP'),keys));assert(!c.isTopRow58(row('TEST-EC-A',''),keys));
assert.equal(c.report5RowExclusion58(row('TEST-EC-A','TOP','','None'),'normal',keys),c.report5ExclusionReason('None','normal'));
// Date-mode behavior is covered by pn-report-chgdate-mixed-regression.cjs.
console.log('PASS 10; FAIL 0; fictional EC/part fixtures only');
