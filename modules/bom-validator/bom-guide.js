(function(global){
  const content={
    version:'v2.15.3',
    title:'BOM 轉檔與安檢操作 SOP',
    updated:'2026-09-02',
    optimizations:[
      '自動辨識真正的 BOM 分頁與 Header 列，參考分頁只保留、不處理。',
      '依正式規則執行 NEW／OLD、PN、品名／規格 30 字及 Item Level 檢查。',
      '使用 OpenCC 完整簡體轉繁體，並處理 H PN → LINEFIT 與品名連動。',
      '保留原始 Excel 分頁與格式，只標記系統修改或發現異常的儲存格。',
      '新增統一格式的「異常檢測報告」，並改善舊版 Excel 相容性。',
      '完整掃描空白分隔列後的資料，並將分群碼、來源碼、單位與特殊屬性轉為系統代碼。',
      '問題回饋支援貼上或選擇圖片；圖片經本機縮放、移除原始檔名與中繼資料後，才存入私人 Google Drive。'
    ],
    steps:[
      '若檔案位於 OneDrive，先關閉 Excel，確認檔案已下載完成，再複製一份到本機資料夾處理。',
      '選擇本機的 .xlsx BOM；請勿先刪除原始分頁或改動 Header。',
      '先看系統辨識結果：BOM 分頁應顯示「已辨識」，表單／規則頁顯示「保留、不處理」是正常的。',
      '確認後按「開始轉檔與安檢」，再閱讀畫面與「異常檢測報告」。',
      '有 BLOCKER 時先修正來源 BOM，再重新執行；WARNING 須人工確認。',
      '下載「_系統轉檔.xlsx」後以 Excel 開啟抽查，再交付 IT 或後續流程。'
    ],
    flow:['關閉 Excel／建立本機副本','選擇 .xlsx','辨識 BOM 分頁','轉檔與安檢','修正 BLOCKER','下載並抽查'],
    oneDriveTips:[
      '在 OneDrive 的 BOM 資料夾按右鍵，選擇「永遠保留在此裝置上」，並等候綠色勾勾出現。',
      '轉檔前關閉原始 Excel；Excel 開啟、自動儲存或 OneDrive 同步時，都可能暫時鎖住檔案。',
      '建議將原始檔複製到 Downloads／BOM_本機處理，完成並關閉輸出 Excel 後，再移回 OneDrive 歸檔。',
      '不要直接覆蓋 OneDrive 中正在同步或已開啟的同名檔案。'
    ],
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
    renderList('guideOneDriveTips',content.oneDriveTips,'ul');renderList('uploadOneDriveTips',content.oneDriveTips,'ul');
    const flow=document.getElementById('guideFlow');if(flow)flow.innerHTML=content.flow.map((x,i)=>`<div class="flow-step"><span>${i+1}</span><b>${esc(x)}</b></div>${i<content.flow.length-1?'<div class="flow-arrow" aria-hidden="true">→</div>':''}`).join('');
    const legend=document.getElementById('guideLegend');if(legend)legend.innerHTML=content.legend.map(x=>`<span class="l-${x.kind}">${esc(x.text)}</span>`).join('');
  }
  function renderSop(){
    const title=document.getElementById('sopTitle');if(title)title.textContent=content.title+' '+content.version;
    const meta=document.getElementById('sopMeta');if(meta)meta.textContent=`更新日期：${content.updated}｜與 BOM 頁面共用說明資料，方便同步維護`;
    renderList('sopOptimizations',content.optimizations,'ul');renderList('sopSteps',content.steps,'ol');renderList('sopOneDriveTips',content.oneDriveTips,'ul');
    const flow=document.getElementById('sopFlow');if(flow)flow.innerHTML=content.flow.map((x,i)=>`<div class="sop-flow-step"><span>${i+1}</span><b>${esc(x)}</b></div>${i<content.flow.length-1?'<div class="sop-flow-arrow">→</div>':''}`).join('');
    const legend=document.getElementById('sopLegend');if(legend)legend.innerHTML=content.legend.map(x=>`<li>${esc(x.text)}</li>`).join('');
  }
  global.BomGuide={content,renderInline,renderSop};
})(window);
