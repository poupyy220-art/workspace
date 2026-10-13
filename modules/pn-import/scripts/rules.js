(function(g){
'use strict';
const fields=['狀態','選取',...Array.from({length:11},(_,i)=>'階層'+(i+1)),'新/舊料','料號','英文品名','繁中品名','簡中品名','越南品名','規格','分群碼','來源碼','採購類型','用量','主件底數','單位','特殊料件特性','替代','取代','客戶料號','製造商','製造商料號','Class Code','Basic Name','軟體Key類型','來源特性','機種別','客戶料號版本','備註','位號','有害物質管制規範','品牌','產品分類','細項產品別','市場分類','拋轉廠區','需包材工程師設計包材','終端客戶'];
const norm=v=>String(v??'').replace(/<[^>]*>/g,'').replace(/[\s*＊]/g,'').replace(/[（]/g,'(').replace(/[）]/g,')').toLowerCase();
const aliases={};
function alias(key,...names){[key,...names].forEach(n=>aliases[norm(n)]=key)}
fields.forEach(f=>alias(f));
alias('新/舊料','新／舊料','新舊料','NEW/OLD','料件狀態','status','新/旧料','新旧料','新或舊料','新或旧料');
alias('料號','料号','PN','Part Number');alias('英文品名','英文品名(EN)','EN');alias('繁中品名','繁中品名(ZF)','繁體品名','ZF');alias('簡中品名','簡中品名(ZH)','簡體品名','简中品名','ZH');alias('越南品名','越南品名(VI)','VI');alias('規格','规格');alias('Basic Name','Basicname');alias('機種別','機種別(代碼)','機種別(代號)');alias('替代','替代(多料號時以,分隔)');alias('取代','取代(多料號時以,分隔)');alias('位號','位號(多值時以,分隔)');alias('拋轉廠區','拋轉廠區(多廠區時以,分隔)');alias('有害物質管制規範','AVC有害物質管制規範');alias('需包材工程師設計包材','需包材工程師');
const blank=v=>v===null||v===undefined||String(v).trim()===''||String(v).trim().toLowerCase()==='nan';
const str=v=>String(v??'').trim();
function header(v){const n=norm(v);if(/^([1-9]|10|11)$/.test(n))return '階層'+n;if(n==='level'||n==='itemlevel'||n==='階層')return 'Level';const withoutLengthNote=n.replace(/\d+字元(?:\(中\d+字=\d+字元\))?$/,'');return aliases[n]||aliases[withoutLengthNote]||null}
// 除 NEW／OLD 外，少數公司範本會用「替代」標記既有替代料件列（功能上比照 OLD：只看料號／用量／主件底數／階層，其餘忽略）
const GROUPED_STATUS_EXTRA=['替代'];
function inferGroupedStatusColumn(sheet,index,map,dupes){
 if(map['新/舊料']!==undefined||index<1)return;
 const group=sheet.rows[index-1]||[],current=sheet.rows[index]||[],matches=[];
 for(let c=0;c<Math.max(group.length,current.length);c++){
  if(header(current[c])||norm(group[c])!=='bomusageandpartinformation')continue;   // 表頭格內容若已是其他已知欄位名稱就跳過；有些範本在此格印死「OLD」等字樣而非留空
  const values=sheet.rows.slice(index+1).map(r=>str(r[c])).filter(Boolean);
  if(values.length&&values.every(v=>['NEW','OLD'].includes(v.toUpperCase())||GROUPED_STATUS_EXTRA.includes(v)))matches.push(c);
 }
 if(matches.length===1)map['新/舊料']=matches[0];
 else if(matches.length>1)dupes.push('新/舊料（群組表頭推定）');
}
function identify(sheet){
 if(/^(history|sheet2|bom申請單|class\s*code|basic\s*name)$/i.test(str(sheet.name))||/異常檢測報告|代碼|規則|說明/.test(sheet.name))return null;
 const candidates=[];
 sheet.rows.slice(0,50).forEach((r,index)=>{const map={},dupes=[];r.forEach((v,c)=>{const k=header(v);if(!k)return;if(map[k]!==undefined)dupes.push(k);else map[k]=c});inferGroupedStatusColumn(sheet,index,map,dupes);
 // 多層表頭的 EN/ZF 等只於前列為品名時接受；ID欄從不當料件欄位。
 const score=Object.keys(map).filter(k=>!k.startsWith('階層')).length;
 if(map['料號']!==undefined&&score>=5&&['英文品名','繁中品名','規格','用量'].some(k=>map[k]!==undefined))candidates.push({index,map,dupes,score});});
 if(!candidates.length)return null;
 candidates.sort((a,b)=>b.score-a.score);
 const best=candidates[0],problems=best.dupes.map(k=>'同名欄位重複：'+k);
 if(candidates.length>1&&candidates[1].score===best.score)problems.push('有多個可能的表頭列，請確認');
 const rows=[];
 sheet.rows.slice(best.index+1).forEach((arr,i)=>{const value={};Object.entries(best.map).forEach(([k,c])=>value[k]=arr[c]??'');
 if(!['料號','英文品名','繁中品名','規格'].some(k=>!blank(value[k])))return;
 rows.push({sheet:sheet.name,row:best.index+i+2,value});});
 if(!rows.length)return null;
 return {name:sheet.name,headerRow:best.index+1,map:best.map,problems,rows};
}
function codesFrom(sheets){const result={};for(const s of sheets)for(const row of s.rows){const cat=str(row[0]),code=str(row[1]);if(cat&&code){result[cat]??={};result[cat][code]=str(row[2])}}return result}
function classCodeSuggestion(v,table){
 if(!table)return null;
 const text=['Basic Name','英文品名','繁中品名','簡中品名','越南品名'].map(k=>str(v[k])).join(' ');
 if(!/LABEL|標籤|标签|貼紙|贴纸/i.test(text))return null;
 const entries=Object.entries(table),specific=[
  [/\bCOA\b/i,/COA.*(標籤|标签)|(?:標籤|标签).*COA/i],
  [/SIDE\s*PANEL|側板|侧板/i,/(側板|侧板).*(標籤|标签)|(?:標籤|标签).*(側板|侧板)/i],
  [/SPECIAL|特殊/i,/特殊.*(標籤|标签)|(?:標籤|标签).*特殊/i],
  [/CERTIFICATE|合格證|合格证/i,/合格證|合格证|CERTIFICATE/i]
 ];
 for(const [sourcePattern,descPattern] of specific)if(sourcePattern.test(text)){const hit=entries.find(([,desc])=>descPattern.test(str(desc)));if(hit)return{code:hit[0],description:str(hit[1])}}
 const generic=entries.find(([,desc])=>/^(標籤|标签|LABEL)$/i.test(str(desc)));
 return generic?{code:generic[0],description:str(generic[1])}:null;
}
// 「這次的列」文字解析：空白＝整頁；可多段，例如「10-15, 21-25」「35」「35～40」。回傳排序後的 [起, 迄] 陣列，格式錯誤或重疊時拋出白話錯誤。
// 全型英數與符號（U+FF01～FF5E）、全型空白（U+3000）換成對應半型；其他字元（含中文、中文標點）不動
function toHalfWidth(value){if(typeof value!=='string')return value;return value.replace(/[\uFF01-\uFF5E]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFEE0)).replace(/\u3000/g,' ')}
function parseRanges(text){
 const raw=str(text);if(!raw)return [];
 const parts=raw.replace(/[～~－—–]/g,'-').split(/[,，、;；\s]+/).filter(Boolean),out=[];
 for(const part of parts){
  const m=part.match(/^(\d+)(?:-(\d+))?$/);if(!m)throw Error(`「${part}」看不懂，請用「35-40」這種格式，多段用逗號分開`);
  const a=Number(m[1]),b=Number(m[2]??m[1]);if(a<1||b<1)throw Error(`「${part}」的列號必須從 1 開始`);if(a>b)throw Error(`「${part}」的起始列比結束列大，請對調`);out.push([a,b]);
 }
 out.sort((x,y)=>x[0]-y[0]);
 for(let i=1;i<out.length;i++)if(out[i][0]<=out[i-1][1])throw Error(`第 ${out[i-1][0]}～${out[i-1][1]} 列和第 ${out[i][0]}～${out[i][1]} 列重疊，請合併成一段`);
 return out;
}
const inRanges=(row,ranges)=>!ranges?.length||ranges.some(([a,b])=>row>=a&&row<=b);
function process(candidates,options){
 if(!['bom','standalone'].includes(options.mode))throw Error('請指定 BOM 組裝或單獨料號申請');
 // 舊參數（整批共用一段 rowStart/rowEnd）仍相容；新參數 ranges 為「頁名 → 多段範圍」，每頁各自設定
 const hasStart=!blank(options.rowStart),hasEnd=!blank(options.rowEnd);let shared=null;
 if(hasStart!==hasEnd)throw Error('本次資料列範圍需同時填寫起始列與結束列');
 if(hasStart){const rowStart=Number(options.rowStart),rowEnd=Number(options.rowEnd);if(!Number.isInteger(rowStart)||!Number.isInteger(rowEnd)||rowStart<1||rowEnd<rowStart)throw Error('本次資料列範圍無效，請輸入正確的 Excel 起始列與結束列');shared=[[rowStart,rowEnd]]}
 const rangesFor=name=>shared||options.ranges?.[name]||[];
 const hasRanges=!!shared||candidates.some(c=>rangesFor(c.name).length);
 const issues=[],warnings=[],changes=[],output=[];const R=g.BomRules;
 const add=(loc,field,reason)=>issues.push({...loc,field,reason,severity:'BLOCKER'});
 const warn=(loc,field,reason)=>warnings.push({...loc,field,reason,severity:'WARNING'});
 for(const sheet of candidates){
  const base={sheet:sheet.name,row:sheet.headerRow};sheet.problems.forEach(p=>add(base,'欄位辨識',p));if(sheet.problems.length)continue;
  for(const required of ['新/舊料','料號','用量','主件底數'])if(sheet.map[required]===undefined)add(base,required,'找不到來源欄位，請確認欄位名稱');
  // 每一段範圍各自成一個區塊：BOM 階層在每段內各自檢查（每段須從 Level 1 開始、段內不可跳階），段與段之間互不影響
  const segs=rangesFor(sheet.name),blocks=segs.length?segs.map(([a,b])=>({a,b,rows:sheet.rows.filter(s=>s.row>=a&&s.row<=b)})):[{rows:sheet.rows}];
  for(const block of blocks){
  if(block.a&&!block.rows.length&&!shared){add({sheet:sheet.name,row:block.a},'本次資料列範圍',`第 ${block.a}～${block.b} 列沒有可處理的料件資料，請確認列號`);continue}
  let previous=0,first=true;
  for(const source of block.rows){
   const v={...source.value},loc={sheet:source.sheet,row:source.row};
   const set=(k,val,why)=>{if(String(v[k]??'')!==String(val)){changes.push({...loc,field:k,before:v[k]??'',after:val,reason:why});v[k]=val}};
   const fill=(k,val,why='空白套用已確認規則')=>{if(blank(v[k]))set(k,val,why)};
   const requireField=k=>{if(blank(v[k]))add(loc,k,'請 RD 補齊明細')};
   const originalStatus=str(v['新/舊料']).toUpperCase();
   fill('新/舊料',R.isStandardPn(v['料號'])?'OLD':'NEW','依既有料號格式判定；未查公司系統');
   if((originalStatus==='NEW'||originalStatus==='OLD')&&str(v['新/舊料']).toUpperCase()!==originalStatus)add(loc,'新/舊料','既有 NEW／OLD 不得被重新判定');
   const state=R.classifyNewStatus(v['新/舊料']);
   if(state===null){add(loc,'新/舊料','NEW/OLD 語意衝突，請 RD 確認');output.push({...source,value:v});continue}
   const levelEntries=Object.keys(v).filter(k=>k==='Level'||/^階層\d+$/.test(k)).filter(k=>!blank(v[k]));
   if(options.mode==='bom'){
    if(levelEntries.length!==1)add(loc,'Item Level','BOM 每筆需有一個明確階層');
    else {const level=Number(v[levelEntries[0]]);if(!Number.isInteger(level)||level<1||level>11)add(loc,'Item Level','階層需可對應匯入表的 1～11 階');else {if(first&&level!==1)add(loc,'Item Level','第一筆有效料件必須 Level 1');if(previous&&level>previous+1)add(loc,'Item Level','向下跳階，請 RD 修正');previous=level}}
    first=false;
   }else if(levelEntries.length>1)add(loc,'Item Level','單獨料號可不填階層，但不可有多個互相衝突的階層');
   requireField('用量');requireField('主件底數');
   if(!state){
    requireField('料號');
    const oldKeep=new Set(['新/舊料','料號','用量','主件底數','Level',...Array.from({length:11},(_,i)=>'階層'+(i+1))]);
    for(const k of Object.keys(v))if(!oldKeep.has(k)&&!blank(v[k]))set(k,'','OLD 匯入規則：只保留料號、用量、主件底數，以及必要的 OLD 狀態與 Item Level');
    output.push({...source,value:v});continue
   }
   // NEW only: old item values and blanks are preserved exactly.
   for(const [k,val] of Object.entries(options.fieldOverrides||{}))if(!blank(val))set(k,val,'使用者確認的本次共用值');
   // 全型英數／符號與全型空白一對一轉半型（2026-10-08 使用者確認）；轉完若是禁用符號、或中文標點，仍由下方檢查報錯
   for(const k of ['英文品名','繁中品名','簡中品名','越南品名','規格'])if(!blank(v[k]))set(k,toHalfWidth(v[k]),'全型英數／符號自動轉半型');
   for(const k of ['分群碼','來源碼','採購類型','單位','特殊料件特性','來源特性','需包材工程師設計包材'])if(!blank(v[k]))set(k,R.convertCode(v[k]),'沿用既有代碼轉換');
   for(const k of ['規格','繁中品名','簡中品名'])if(!blank(v[k]))set(k,R.toTraditionalChinese(v[k]),'沿用既有繁體正規化');
   if(!blank(v['繁中品名']))fill('簡中品名',v['繁中品名']);if(!blank(v['英文品名']))fill('越南品名',v['英文品名']);
   for(const k of ['英文品名','繁中品名','分群碼','來源碼','單位','機種別'])requireField(k);
   // 市場分類／產品分類／細項產品別：RD 常漏填，允許在介面直接輸入或選預設組合補上（審計進 changes，不是靜默補值）
   const fillOf=field=>(options.fieldFills||[]).find(x=>x.sheet===source.sheet&&x.row===source.row&&x.field===field&&!blank(x.value));
   const requireOrFill=k=>{if(!blank(v[k]))return;const f=fillOf(k);if(f)set(k,f.value,'RD 介面確認填寫'+(f.who?'：'+f.who:''));else add(loc,k,'請 RD 補齊明細')};
   for(const k of ['產品分類','細項產品別','市場分類'])requireOrFill(k);
   const confirm=(options.specApprovals||[]).find(a=>a.sheet===source.sheet&&a.row===source.row&&str(a.note));
   if(blank(v['規格'])){const f=fillOf('規格');if(f)set('規格',f.value,'RD 介面確認填寫'+(f.who?'：'+f.who:''));else if(!confirm)add(loc,'規格','請 RD 補齊；如允許留白，需提供此列的 RD 確認紀錄');else changes.push({...loc,field:'規格',before:'',after:'',reason:'RD確認留白：'+confirm.note})}
   if(str(v['分群碼'])==='3'&&str(v['來源碼']).toUpperCase()==='P')requireField('採購類型');
   fill('特殊料件特性','GE');fill('來源特性','N');fill('有害物質管制規範','RS');fill('拋轉廠區','AVC,AVCDG,AVCCN,AVCWH');fill('需包材工程師設計包材','N');
   const pn=str(v['料號']),customerPn=/^S[A-Z0-9]{9}$/i.test(pn)?pn:'NA';
   // 客戶料號必填（與網站同一條件：RD 表有此欄且本列空白）：草稿照既有規則補值，同時提醒 RD 確認；不阻擋
   if(Object.prototype.hasOwnProperty.call(v,'客戶料號')&&blank(v['客戶料號']))warn(loc,'客戶料號','NEW 料客戶料號空白（必填）；草稿已依規則暫補「'+customerPn+'」，請 RD 確認或補上正確客戶料號');
   fill('客戶料號',customerPn);
   if(str(v['規格'])==='H PN')set('Basic Name','LINEFIT','規格字面 H PN 的既有規則');else fill('Basic Name','NA');
   const basic=str(v['Basic Name']);if(['DPK','SPK','EDPK'].includes(basic)){if(blank(v['軟體Key類型']))fill('軟體Key類型',basic);else if(str(v['軟體Key類型'])!==basic)add(loc,'軟體Key類型','與 Basic Name 不一致；保留原值，請 RD 確認')}
   if(blank(v['品牌'])){if(/^(231|232)/.test(pn)||/^\d{3}H\d{5}-\d{2}[A-Z]$/i.test(pn)||/^S[A-Z0-9]{9}H$/i.test(pn))fill('品牌','NA');else if(str(v['分群碼'])==='1'&&str(v['來源碼']).toUpperCase()==='M')requireField('品牌')}
   if(!blank(v['機種別']))fill('終端客戶',({L044:'0076',L062:'0076',L063:'0299'})[str(v['機種別']).toUpperCase()]||'0062');
   const requiredDefaults=['特殊料件特性','來源特性','有害物質管制規範','拋轉廠區','需包材工程師設計包材','客戶料號','Basic Name'];
   if(!blank(v['機種別']))requiredDefaults.push('終端客戶');
   for(const k of requiredDefaults)if(blank(v[k]))add(loc,k,'NEW 預設補值驗證失敗，停止放行');
   if(str(v['分群碼'])==='3'&&str(v['來源碼']).toUpperCase()==='P'){
    if(blank(v['Class Code']))warn(loc,'Class Code','NEW 3／P 的 Class Code 空白；僅標記供人工確認，不猜測、不補值');
    else {const table=options.codes?.['Class Code'];if(!table)add(loc,'Class Code','NEW 3／P 已填 Class Code，但尚未載入代碼表，無法核對');else if(!Object.prototype.hasOwnProperty.call(table,str(v['Class Code'])))add(loc,'Class Code','NEW 3／P 的 Class Code 在代碼表查無此值，請 RD 修正')}
   }
   for(const k of ['英文品名','繁中品名','簡中品名','越南品名','規格'])if(!blank(v[k])){const symbols=R.checkForbiddenSymbols(v[k]),len=R.getCharLength(v[k]);if(len>30||symbols.length)add(loc,k,[len>30?'長度超過30，請 RD 修改':'',symbols.length?'含不合規符號／全型字，請 RD 修改':''].filter(Boolean).join('；'))}
   output.push({...source,value:v});
  }
  }
 }
 if(!output.length)add({sheet:'',row:0},'明細',hasRanges?'指定的本次資料列範圍沒有可處理的料件資料':'沒有可處理的料件資料');
 return {output,issues,warnings,changes,ready:issues.length===0};
}
// 補齊問題的來源欄號，供整合報表標記；來源沒有該欄時維持無欄號（無格可標）。
function locate(problems,candidates){
 const levelKeys=['Level',...Array.from({length:11},(_,i)=>'階層'+(i+1))];
 for(const p of problems){
  if(p.col)continue;const c=candidates.find(x=>x.name===p.sheet);if(!c?.map)continue;
  let index=c.map[p.field];
  // Item Level：有值的階層欄全部標註（衝突時多格）；全空白且只有一個候選欄才標該欄，候選不唯一時只列報告不猜位置
  if(index===undefined&&p.field==='Item Level'){const v=c.rows?.find(x=>x.row===p.row)?.value||{},present=levelKeys.filter(k=>c.map[k]!==undefined),filled=present.filter(k=>!blank(v[k]));const keys=filled.length?filled:present.length===1?present:[];if(keys.length){index=c.map[keys[0]];if(keys.length>1)p.extraCols=keys.slice(1).map(k=>c.map[k]+1)}}
  if(index!==undefined)p.col=index+1;
 }
 return problems;
}
g.PnBom={toHalfWidth,fields,header,identify,codesFrom,process,blank,classCodeSuggestion,locate,parseRanges,inRanges};
})(typeof window==='undefined'?globalThis:window);
