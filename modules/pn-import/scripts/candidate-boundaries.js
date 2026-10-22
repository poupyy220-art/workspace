/* Candidate-only holds: do not generalize the separately delivered replacement/hierarchy cases. */
(function(g){'use strict';
 const core=g.PnBom.process;
 g.PnBom.process=function(candidates,options={}){
  const result=core(candidates,options),held=new Set();
  const key=r=>JSON.stringify([r.sheet,r.row]);
  const hold=(row,field,reason)=>{
   result.issues.push({sheet:row.sheet,row:row.row,field,reason,severity:'BLOCKER'});
   held.add(key(row));
  };
  for(const sheet of candidates){
   const included=result.output.filter(r=>r.sheet===sheet.name);
   for(const row of included){
    const source=sheet.rows.find(r=>r.row===row.row);if(!source)continue;
    const status=String(source.value['新/舊料']??'').trim().toUpperCase();
    if(status==='替代')hold(source,'新/舊料','替代料匯入方式待確認：候選不自動併入主料，也不把此列當作一般 OLD 放行。');
    if(String(row.value['新/舊料']).trim().toUpperCase()==='OLD'&&['替代','取代'].some(f=>!g.PnBom.blank(source.value[f])))hold(source,'替代','既有料的替代／取代資料待確認：候選不清空或自動合併，請先人工確認。');
   }
   if(options.mode!=='bom')continue;
   const ranges=options.ranges?.[sheet.name]||[];
   const blocks=ranges.length?ranges.map(([a,b])=>included.filter(r=>r.row>=a&&r.row<=b)):[included];
   const level=row=>{const entries=Object.entries(row.value).filter(([k,v])=>(k==='Level'||/^階層\d+$/.test(k))&&!g.PnBom.blank(v));return entries.length===1?Number(entries[0][1]):NaN};
   for(const rows of blocks)for(let i=0;i<rows.length-1;i++){
    const row=rows[i],n=level(row),next=level(rows[i+1]);
    if(String(row.value['新/舊料']).trim().toUpperCase()==='OLD'&&Number.isInteger(n)&&next>n){
     const source=sheet.rows.find(r=>r.row===row.row)||row;
     hold(source,'Item Level','既有父件下仍有子階，是否收斂待確認：候選保留原始列，不自動刪除子階或產生匯入草稿。');
    }
   }
  }
  // Held records are shown as original values, without claiming a transformation was approved.
  for(const row of result.output)if(held.has(key(row))){const source=candidates.find(s=>s.name===row.sheet)?.rows.find(r=>r.row===row.row);if(source)row.value={...source.value}}
  result.changes=result.changes.filter(r=>!held.has(key(r)));
  result.ready=result.issues.length===0;
  return result;
 };
})(typeof window==='undefined'?globalThis:window);
