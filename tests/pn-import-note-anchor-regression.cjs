// 備註框位置邊界：左上不大於右下、不超出工作表（0 起算：最大欄 16383、最大列 1048575）
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
vm.runInThisContext(fs.readFileSync(__dirname+'/../modules/pn-import/scripts/check-report.js','utf8'));
const cases=[{r:0,c:0},{r:4,c:3},{r:0,c:16383},{r:1048575,c:0},{r:1048575,c:16383},{r:1048574,c:16380}];
for(const x of cases){const [l,,t,,rr,,b]=PnBomReport.noteAnchor(x);assert(l>=0&&t>=0&&rr<=16383&&b<=1048575&&l<=rr&&t<=b,JSON.stringify({x,l,t,rr,b}))}
assert.deepEqual(PnBomReport.noteAnchor({r:4,c:3}).join(','),'4,15,3,10,7,15,7,4');
console.log('PASS '+(cases.length+1)+'：備註框位置在工作表邊界內且左上不大於右下');
