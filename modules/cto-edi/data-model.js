(function(){
  const SCHEMA_VERSION='1.0';
  const own=v=>String(v??'').trim();
  const pn=mtm=>`CTOSBB_${own(mtm).toUpperCase()}CTO1WW`;

  function projectRow(p){
    return {
      project_id:own(p.id),
      project:own(p.project),
      mtm_family:own(p.mtmFamily),
      cto_bom_date:own(p.bomDate),
      owner:own(p.owner),
      project_stage:own(p.projectStage),
      cto_edi_status:own(p.ediStatus),
      configured_label_status:own(p.labelStatus),
      fany_ppt_name:own(p.fanyPptName),
      fany_confirmed:Boolean(p.pptConfirmed),
      fixed_label_pn:own(p.labelPn),
      fixed_label_usage:own(p.labelUsage),
      rd_pallet_file:own(p.rdFileName),
      checklist_status:statusOf(p.checks||{}),
      note:own(p.note),
      updated_at:new Date().toISOString()
    };
  }

  function mtmRows(p,parseMtm){
    const items=p.mtms||parseMtm(p.mtm);
    return items.map((mtm,index)=>({
      project_id:own(p.id),
      line_no:index+1,
      mtm_prefix:own(mtm).toUpperCase(),
      spb_mtm_prefix:own(mtm).toUpperCase()+'S',
      cto_pn:pn(mtm),
      active:true
    }));
  }

  function statusOf(c){
    if(c.it)return'IT_DELIVERED';
    if(!c.asked||!c.reply)return'WAITING_CONFIRMATION';
    if(!c.mapping||!c.nameSpec||!c.projectRule||!c.palletRule)return'WAITING_REPORT';
    if(!c.validated)return'WAITING_VALIDATION';
    return'READY_FOR_IT';
  }

  function exportPayload(projects,parseMtm){
    return {
      schema_version:SCHEMA_VERSION,
      exported_at:new Date().toISOString(),
      projects:projects.map(projectRow),
      mtms:projects.flatMap(p=>mtmRows(p,parseMtm))
    };
  }

  window.CtoEdiDataModel={SCHEMA_VERSION,projectRow,mtmRows,exportPayload};
})();
