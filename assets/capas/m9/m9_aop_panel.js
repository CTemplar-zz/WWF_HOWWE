(function(){
  const MODULE_ID='9';
  const data=window.M9_AOP_DATA||{summary:[],sectors:[]};
  const thematicIds=new Set(['m9_aop_sernap','m9_construcciones','m9_vias_caminos','m9_lineas_mt','m9_lineas_at','m9_plantas','m9_represas']);
  const config={
    m9_aop_sernap:{name:'AOPs (SERNAP)',shortName:'AOPs',color:'#fccbc9',keys:['aop_total'],labels:['AOP registradas'],units:['']},
    m9_construcciones:{name:'Construcciones (Viviendas)',shortName:'Viviendas',color:'#ff0000',keys:['viviendas_num','viviendas_area_ha'],labels:['Construcciones','Superficie total'],units:['','ha']},
    m9_vias_caminos:{name:'Vías y Caminos',shortName:'Vías y caminos',color:'#e66914',keys:['caminos_principales_km','caminos_secundarios_terciarios_km'],labels:['Carreteras principales','Caminos secundarios o terciarios'],units:['km','km']},
    m9_lineas_mt:{name:'Líneas de Media Tensión',shortName:'Líneas MT',color:'#c3fcb8',keys:['lineas_mt_km'],labels:['Longitud'],units:['km']},
    m9_lineas_at:{name:'Líneas de Alta Tensión',shortName:'Líneas AT',color:'#dad4fc',keys:['lineas_at_km'],labels:['Longitud'],units:['km']},
    m9_plantas:{name:'Plantas de generación eléctrica',shortName:'Plantas eléctricas',color:'#bafcc9',keys:['plantas_num'],labels:['Plantas'],units:['']},
    m9_represas:{name:'Represas',shortName:'Represas',color:'#e3fcbd',keys:['represas_num'],labels:['Represas'],units:['']}
  };
  const style=document.createElement('style');
  style.textContent=`
    .m9-summary-list{display:flex;flex-direction:column;gap:3px}.m9-summary-row{display:grid;grid-template-columns:10px minmax(88px,1fr) auto;gap:8px;align-items:center;font-size:10px;padding:7px 0;border-bottom:1px solid var(--border)}
    .m9-summary-row:last-child{border-bottom:0}.m9-summary-row i{width:9px;height:9px;border-radius:2px}.m9-summary-row>span{line-height:1.2}.m9-summary-values{display:flex;flex-direction:column;align-items:flex-end;gap:2px;font:600 9.5px 'JetBrains Mono',monospace;white-space:nowrap}.m9-summary-values small{font:500 8px Inter,sans-serif;color:var(--text-dim);margin-left:3px}
    .m9-note{font-size:9px;color:var(--text-dim);line-height:1.45;margin-top:9px}.m9-download{display:inline-flex;align-items:center;gap:5px;color:#9a472b;text-decoration:none;font-weight:600;margin-top:8px}.m9-download:hover{text-decoration:underline}
    .m9-table{width:100%;border-collapse:collapse;font-size:10px}.m9-table th{position:sticky;top:0;background:var(--panel);color:var(--text-dim);font-size:9px;text-align:left;padding:6px 5px;border-bottom:1px solid var(--border)}
    .m9-table td{padding:6px 5px;border-bottom:1px solid var(--border);vertical-align:top}.m9-table th:not(:first-child),.m9-table td:not(:first-child){text-align:right}.m9-table td:not(:first-child){font-family:'JetBrains Mono',monospace;white-space:nowrap}.m9-empty{padding:14px 4px;color:var(--text-dim);font-size:10px;line-height:1.45}
    .m9-tables-scroll{max-height:520px;overflow-y:auto;padding-right:5px}.m9-table-section{margin-top:15px}.m9-table-section:first-child{margin-top:0}.m9-table-section h5{margin:0 0 6px;font:700 10px Inter,sans-serif;color:var(--text);display:flex;align-items:center;gap:6px}.m9-table-section h5 i{width:8px;height:8px;border-radius:2px;flex:none}.m9-table-section-meta{margin-left:auto;color:var(--text-dim);font:500 8px 'JetBrains Mono',monospace}
  `;
  document.head.appendChild(style);

  Object.entries(config).forEach(([id,item])=>{
    LAYER_METADATA[id]={title:item.name,body:[
      'Capa recortada con los límites actualizados de las áreas protegidas.',
      'El campo de área protegida fue recalculado mediante intersección espacial en ArcGIS Pro.'
    ]};
  });
  LAYER_METADATA.m9_limites_aps={title:'Límites de áreas protegidas',body:['Límites SERNAP utilizados para recortar y asignar todas las capas del módulo M9.']};

  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const apName=row=>String(row?.area_protegida||row?.['\uFEFFarea_protegida']||'').trim();
  const selectedKeys=()=>new Set([...selectedAPs].map(norm));
  function scopedRows(){
    const selected=selectedKeys();
    return selected.size===0?data.summary:data.summary.filter(row=>selected.has(norm(apName(row))));
  }
  function scopedSectorRows(){
    const selected=selectedKeys();
    return selected.size===0?data.sectors:data.sectors.filter(row=>selected.has(norm(apName(row))));
  }
  const sum=(rows,key)=>rows.reduce((total,row)=>total+num(row[key]),0);
  function format(value,unit=''){
    const n=num(value);
    if(unit==='km') return `${n.toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2})} km`;
    if(unit==='ha') return `${n.toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2})} ha`;
    return Math.round(n).toLocaleString('es-BO');
  }
  function scopeLabel(rows){
    if(selectedAPs.size===0) return `${rows.length} áreas protegidas`;
    if(selectedAPs.size===1) return [...selectedAPs][0];
    return `${selectedAPs.size} áreas protegidas seleccionadas`;
  }
  function activeThematic(){return [...activeLayers].filter(id=>thematicIds.has(id));}
  function cardHTML(id,rows){
    const item=config[id];
    const values=item.keys.map(key=>sum(rows,key));
    const main=format(values[0],item.units[0]);
    const detail=item.keys.length>1?`${item.labels[1]}: ${format(values[1],item.units[1])}`:item.labels[0];
    return `<div class="kpi"><div class="lbl">${item.name}</div><div class="val" style="font-size:${main.length>12?'17px':'22px'}">${main}</div><div class="trend">${detail}</div></div>`;
  }
  function summaryValues(id,rows){
    const item=config[id];
    const values=item.keys.map((key,index)=>format(sum(rows,key),item.units[index]));
    if(id==='m9_construcciones') return `<span>${values[0]}</span><span>${values[1]}</span>`;
    if(id==='m9_vias_caminos') return `<span>${values[0]}<small>principales</small></span><span>${values[1]}<small>sec./terc.</small></span>`;
    return `<span>${values[0]}</span>`;
  }
  function detailTable(id,rows){
    if(id==='m9_aop_sernap'){
      const sectorRows=scopedSectorRows();
      const keys=Object.keys(sectorRows[0]||{}).filter(key=>key!=='area_protegida');
      const values=keys.map(key=>[key,sum(sectorRows,key)]).filter(([,value])=>value>0).sort((a,b)=>b[1]-a[1]);
      return {title:'AOP por sector agrupado',head:['Sector','Puntos'],rows:values.map(([name,value])=>[name,format(value)])};
    }
    const item=config[id];
    if(!item) return {title:'Áreas protegidas del módulo',head:['Área protegida'],rows:rows.map(row=>[apName(row)||'Sin nombre'])};
    return {title:`${item.name} por área protegida`,head:['Área protegida',...item.labels],rows:rows.map(row=>[apName(row)||'Sin nombre',...item.keys.map((key,index)=>format(row[key],item.units[index]))]).filter(row=>row.slice(1).some(value=>!/^0(?:[,.]00)?(?: km| ha)?$/.test(value)))};
  }
  function tableHTML(spec,id){
    const color=config[id]?.color||'#7f8a7d';
    return `<section class="m9-table-section" id="m9-table-${id}"><h5><i style="background:${color}"></i>${escapeHTML(spec.title)}<span class="m9-table-section-meta">Excel</span></h5>${spec.rows.length?`<table class="m9-table"><thead><tr>${spec.head.map(value=>`<th>${escapeHTML(value)}</th>`).join('')}</tr></thead><tbody>${spec.rows.map(row=>`<tr>${row.map(value=>`<td>${escapeHTML(String(value))}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="m9-empty">Sin registros para la selección.</div>'}</section>`;
  }
  function renderTables(ids,rows){
    const card=document.getElementById('breakdownCard');
    if(!card)return;
    card.innerHTML=`<h4>Detalle de capas activas <span class="mono" style="color:var(--text-dim);font-size:9px">Excel consolidado</span></h4><div class="m9-tables-scroll">${ids.length?ids.map(id=>tableHTML(detailTable(id,rows),id)).join(''):'<div class="m9-empty">Activa una capa temática para consultar su tabla.</div>'}</div>`;
  }
  function renderM9DataPanel(){
    if(currentModule!==MODULE_ID)return;
    const rows=scopedRows();
    const active=activeThematic();
    const grid=document.querySelector('.kpi-grid');
    const card=document.querySelector('.donut-card');
    if(!grid||!card)return;
    const scope=scopeLabel(rows);
    document.getElementById('rightTitle').textContent=selectedAPs.size===1?[...selectedAPs][0]:'Áreas, Obras y Proyectos';
    document.getElementById('rightSub').textContent=`${scope} · indicadores calculados con límites actualizados`;
    const cards=active.map(id=>cardHTML(id,rows));
    if(cards.length<2) cards.push(`<div class="kpi"><div class="lbl">Ámbito del reporte</div><div class="val">${rows.length}</div><div class="trend">áreas protegidas con datos</div></div>`);
    grid.innerHTML=cards.join('')||'<div class="m9-empty">Activa una capa temática para consultar sus indicadores.</div>';
    card.innerHTML=`<h4>Indicadores de capas activas <span class="mono" style="color:var(--text-dim);font-size:9px">${escapeHTML(scope)}</span></h4><div class="m9-summary-list">${active.map(id=>{
      const item=config[id];
      return `<button type="button" data-m9-focus="${id}" class="m9-summary-row" style="border-left:0;border-right:0;border-top:0;background:transparent;color:var(--text);width:100%;text-align:left;cursor:pointer"><i style="background:${item.color}"></i><span>${item.shortName}</span><span class="m9-summary-values">${summaryValues(id,rows)}</span></button>`;
    }).join('')||'<div class="m9-empty">Activa una capa temática en el panel izquierdo.</div>'}</div><div class="m9-note">Las tablas inferiores incluyen todas las capas activas. El filtro superior limita simultáneamente el mapa y los indicadores.</div><a class="m9-download" href="assets/downloads/Indicadores_Areas_Protegidas.xlsx" download>Descargar tabla Excel</a>`;
    card.querySelectorAll('[data-m9-focus]').forEach(button=>button.addEventListener('click',()=>document.getElementById(`m9-table-${button.dataset.m9Focus}`)?.scrollIntoView({behavior:'smooth',block:'nearest'})));
    renderTables(active,rows);
  }

  function refreshLayer(layer){
    if(!layer)return;
    if(layer._m9Data&&layer.clearLayers&&layer.addData){layer.clearLayers();layer.addData(layer._m9Data);return;}
    if(layer.redraw){layer.redraw();return;}
    if(layer.eachLayer)layer.eachLayer(refreshLayer);
  }
  window.refreshM9MapFilter=function(){
    Object.entries(moduleLayers).filter(([key])=>key.startsWith('9:')).forEach(([,layer])=>refreshLayer(layer));
  };
  window.renderM9DataPanel=renderM9DataPanel;

  const previousRenderModule=renderModule;
  const previousToggleLayer=toggleLayer;
  renderModule=function(modId){
    previousRenderModule(modId);
    if(modId===MODULE_ID) setTimeout(()=>{renderM9DataPanel();window.refreshM9MapFilter();},0);
  };
  toggleLayer=function(layerId,rowEl){
    previousToggleLayer(layerId,rowEl);
    if(currentModule===MODULE_ID){
      renderM9DataPanel();
    }
  };
})();
