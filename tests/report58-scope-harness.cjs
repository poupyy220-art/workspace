// Test adapter: expose newly extracted helpers to legacy VM harnesses, without changing assertions.
const fs=require('fs'),vm=require('vm');
const s=fs.readFileSync((process.env.PN_REPORT_HTML || require('path').join(__dirname,'../modules/pn-report/index.html')),'utf8').replace(/\r\n/g,'\n');
const helpers=['reportScopeKey58','childKeys58','isTopRow58','report5RowExclusion58'].map(n=>{const i=s.indexOf('    function '+n+'(');return s.slice(i,s.indexOf('\n    }',i)+6)}).join('\n');
for(const name of ['runInNewContext','runInContext']){const original=vm[name];vm[name]=function(code,...args){return original.call(this,helpers+'\n'+code,...args)}}
