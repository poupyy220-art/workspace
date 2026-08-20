(function(global){
  const content={
    version:'v2.14.1',
    title:'BOM 轉檔與安檢操作 SOP',
    updated:'2026-08-20',
    optimizations:[
      '自動辨識真正的 BOM 分頁與 Header 列，參考分頁只保留、不處理。',
      '依正式規則執行 NEW／OLD、PN、品名／規格 30 字及 Item Level 檢查。',
      '使用 OpenCC 完整簡體轉繁體，並處理 H PN → LINEFIT 與品名連動。',
      '保留原始 Excel 分頁與格式，只標記系統修改或發現異常的儲存格。',
      '新增統一格式的「異常檢測報告」，並改善舊版 Excel 相容性。'
    ],
    steps:[
      '選擇一個 .xlsx BOM；請勿先刪除原始分頁或改動 Header。',
      '先看系統辨識結果：BOM 分頁應顯示「已辨識」，表單／規則頁顯示「保留、不處理」是正常的。',
      '確認後按「開始轉檔與安檢」，再閱讀畫面與「異常檢測報告」。',
      '有 BLOCKER 時先修正來源 BOM，再重新執行；WARNING 須人工確認。',
      '下載「_系統轉檔.xlsx」後以 Excel 開啟抽查，再交付 IT 或後續流程。'
    ],
    flow:['選擇 .xlsx','辨識 BOM 分頁','轉檔與安檢','修正 BLOCKER','下載轉檔 Excel 並抽查'],
    legend:[
      {kind:'new',text:'淺黃色：NEW 新料件，需重新核對'},
      {kind:'blocker',text:'紅色／BLOCKER：必須修正'},
      {kind:'warning',text:'WARNING：需人工確認'},
      {kind:'reference',text:'保留、不處理：參考分頁，並非錯誤'}
    ]
  };
  const esc=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function renderList(id,items,tag){const el=document.getElementById(id);if(el)el.innerHTML=items.map(x=>`<li>${esc(x)}</li>`).join('')}
  function renderInline(){
    renderList('guideOptimizations',content.optimizations,'ul');renderList('guideSteps',content.steps,'ol');
    const flow=document.getElementById('guideFlow');if(flow)flow.innerHTML=content.flow.map((x,i)=>`<div class="flow-step"><span>${i+1}</span><b>${esc(x)}</b></div>${i<content.flow.length-1?'<div class="flow-arrow" aria-hidden="true">→</div>':''}`).join('');
    const legend=document.getElementById('guideLegend');if(legend)legend.innerHTML=content.legend.map(x=>`<span class="l-${x.kind}">${esc(x.text)}</span>`).join('');
  }
  function renderSop(){
    const title=document.getElementById('sopTitle');if(title)title.textContent=content.title+' '+content.version;
    const meta=document.getElementById('sopMeta');if(meta)meta.textContent=`更新日期：${content.updated}｜與 BOM 頁面共用說明資料，方便同步維護`;
    renderList('sopOptimizations',content.optimizations,'ul');renderList('sopSteps',content.steps,'ol');
    const flow=document.getElementById('sopFlow');if(flow)flow.innerHTML=content.flow.map((x,i)=>`<div class="sop-flow-step"><span>${i+1}</span><b>${esc(x)}</b></div>${i<content.flow.length-1?'<div class="sop-flow-arrow">→</div>':''}`).join('');
    const legend=document.getElementById('sopLegend');if(legend)legend.innerHTML=content.legend.map(x=>`<li>${esc(x.text)}</li>`).join('');
  }
  global.BomGuide={content,renderInline,renderSop};
})(window);
