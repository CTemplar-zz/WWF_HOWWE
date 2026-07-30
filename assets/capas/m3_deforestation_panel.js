(function(){
  const deforestation = window.DEFORESTATION_M3 || {years:[],rows:[]};
  const deforestationYears = Array.isArray(deforestation.years) ? deforestation.years.map(Number) : [];
  const deforestationRows = Array.isArray(deforestation.rows) ? deforestation.rows : [];
  const selectedEcoregions = new Set();
  let activeThreatPanel = 'deforestation';
  let miningOutsideOnly = false;
  window.m3MiningOutsideOnly = false;

  const rightPanel = document.getElementById('right');
  const grid = document.querySelector('.kpi-grid');
  const donutCard = document.querySelector('.donut-card');
  const breakdownCard = document.getElementById('breakdownCard');
  const defaultDonutHTML = donutCard ? donutCard.innerHTML : '';
  const defaultBreakdownHTML = breakdownCard ? breakdownCard.innerHTML : '';
  const previousRenderModule = renderModule;

  const normalizeAP = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/\btipnis\b/g,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();

  const allEcoregions = [...new Set(deforestationRows.map(row=>row.ecoregion))]
    .sort((a,b)=>a.localeCompare(b,'es'));

  function selectedAPKeys(){
    return new Set([...selectedAPs].map(normalizeAP));
  }

  function ensurePanelTabs(){
    let tabs=document.getElementById('m3PanelTabs');
    if(tabs) return tabs;
    tabs=document.createElement('div');
    tabs.id='m3PanelTabs';
    tabs.className='m3-panel-tabs';
    tabs.setAttribute('role','tablist');
    tabs.setAttribute('aria-label','Indicadores de amenazas críticas');
    tabs.innerHTML=`
      <button class="m3-panel-tab" type="button" role="tab" data-threat-panel="deforestation">Deforestación</button>
      <button class="m3-panel-tab" type="button" role="tab" data-threat-panel="mining">Minería</button>
      <button class="m3-panel-tab" type="button" role="tab" data-threat-panel="burns" disabled title="Panel disponible próximamente">Quemas</button>
    `;
    rightPanel?.insertBefore(tabs,rightPanel.querySelector('.info-h'));
    tabs.querySelectorAll('[data-threat-panel]:not(:disabled)').forEach(button=>{
      button.addEventListener('click',()=>{
        activeThreatPanel=button.dataset.threatPanel;
        renderM3DataPanel();
      });
    });
    return tabs;
  }

  function updatePanelTabs(){
    const tabs=ensurePanelTabs();
    tabs.hidden=currentModule!=='3';
    tabs.querySelectorAll('[data-threat-panel]').forEach(button=>{
      const active=button.dataset.threatPanel===activeThreatPanel;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',String(active));
      button.setAttribute('tabindex',active?'0':'-1');
    });
  }

  function formatSurfaceHTML(value){
    return `${formatHa(value)}<span class="unit">${haUnitLabel(value)}</span>`;
  }

  function compactSurface(value){
    if(!Number.isFinite(value)||value<=0) return '0';
    if(value>=1e6) return `${(value/1e6).toFixed(1)}M`;
    if(value>=1e3) return `${(value/1e3).toFixed(value>=1e4?0:1)}k`;
    return Math.round(value).toLocaleString('es-BO');
  }

  function sumRows(rows,key){
    return rows.reduce((total,row)=>{
      const value=Number(row[key]);
      return total+(Number.isFinite(value)?value:0);
    },0);
  }

  function annualChartHTML(annualTotals,ariaLabel,theme='deforestation'){
    const width=360, height=220, left=39, right=8, top=28, bottom=34;
    const chartWidth=width-left-right;
    const chartHeight=height-top-bottom;
    const maxValue=Math.max(1,...annualTotals.map(item=>item.value));
    const paddedMax=maxValue*1.12;
    const slot=chartWidth/Math.max(annualTotals.length,1);
    const barWidth=Math.min(27,slot*.66);
    const gridValues=[0,paddedMax/2,paddedMax];
    const gridLines=gridValues.map(value=>{
      const y=top+chartHeight-(value/paddedMax)*chartHeight;
      return `<line class="m3-chart-grid" x1="${left}" x2="${width-right}" y1="${y}" y2="${y}"></line>
        <text class="m3-chart-axis" x="${left-5}" y="${y+3}" text-anchor="end">${compactSurface(value)}</text>`;
    }).join('');
    const bars=annualTotals.map((item,index)=>{
      const x=left+slot*index+(slot-barWidth)/2;
      const barHeight=(item.value/paddedMax)*chartHeight;
      const y=top+chartHeight-barHeight;
      const latest=index===annualTotals.length-1;
      return `<g>
        <title>${item.year}: ${item.value.toLocaleString('es-BO',{maximumFractionDigits:2})} ha</title>
        <rect class="m3-chart-bar${latest?' latest':''}" x="${x}" y="${y}" width="${barWidth}" height="${Math.max(barHeight,.5)}" rx="3"></rect>
        <text class="m3-chart-value" x="${x+barWidth/2}" y="${Math.max(top-4,y-5)}" text-anchor="middle">${compactSurface(item.value)}</text>
        <text class="m3-chart-axis" x="${x+barWidth/2}" y="${height-11}" text-anchor="middle">${item.year}</text>
      </g>`;
    }).join('');
    return `<div class="m3-chart-wrap ${theme}">
      <svg class="m3-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(ariaLabel)}">
        ${gridLines}
        ${bars}
      </svg>
    </div>`;
  }

  function deforestationRowsForSelectedAPs(){
    if(selectedAPs.size===0) return deforestationRows;
    const selected=selectedAPKeys();
    return deforestationRows.filter(row=>selected.has(normalizeAP(row.name)));
  }

  function scopedDeforestationRows(){
    const rows=deforestationRowsForSelectedAPs();
    if(selectedEcoregions.size===0) return rows;
    return rows.filter(row=>selectedEcoregions.has(row.ecoregion));
  }

  function sumDeforestationYear(rows,year){
    return rows.reduce((total,row)=>{
      const value=Number(row.annual?.[year]);
      return total+(Number.isFinite(value)?value:0);
    },0);
  }

  function deforestationScopeLabel(rows){
    const apCount=new Set(rows.map(row=>normalizeAP(row.name))).size;
    const ecoCount=new Set(rows.map(row=>row.ecoregion)).size;
    const apText=selectedAPs.size===0
      ? `${apCount} áreas protegidas`
      : selectedAPs.size===1
      ? [...selectedAPs][0]
      : `${selectedAPs.size} áreas protegidas`;
    const ecoText=selectedEcoregions.size===0
      ? 'todas las ecorregiones'
      : selectedEcoregions.size===1
      ? [...selectedEcoregions][0]
      : `${ecoCount} ecorregiones`;
    return `${apText} · ${ecoText}`;
  }

  function ecoregionFilterHTML(apRows){
    const latestYear=deforestationYears[deforestationYears.length-1];
    const options=allEcoregions.map(ecoregion=>{
      const active=selectedEcoregions.has(ecoregion);
      const latestValue=sumDeforestationYear(apRows.filter(row=>row.ecoregion===ecoregion),latestYear);
      return `<button class="m3-eco-option${active?' active':''}" type="button" data-ecoregion="${escapeHTML(ecoregion)}" aria-pressed="${active}">
        <span class="m3-eco-check">${active?'✓':''}</span>
        <span>${escapeHTML(ecoregion)}</span>
        <span class="m3-eco-value">${compactSurface(latestValue)} ha</span>
      </button>`;
    }).join('');
    const summary=selectedEcoregions.size===0
      ? 'Vista general agregada'
      : `${selectedEcoregions.size} ${selectedEcoregions.size===1?'ecorregión':'ecorregiones'} seleccionada${selectedEcoregions.size===1?'':'s'}`;
    return `<h4>Filtrar por ecorregión</h4>
      <div class="m3-eco-toolbar">
        <span class="m3-eco-summary">${summary}</span>
        <button class="m3-eco-clear" id="m3ClearEcoregions" type="button">Mostrar todas</button>
      </div>
      <div class="m3-eco-list">${options}</div>
      <div class="m3-panel-note">Los valores laterales corresponden a ${latestYear}. Puedes combinar varias ecorregiones.</div>`;
  }

  function updateDeforestationContext(rows){
    const title=document.getElementById('rightTitle');
    const sub=document.getElementById('rightSub');
    if(!title||!sub) return;
    if(selectedAPs.size===0) title.textContent='Deforestación en APs';
    else if(selectedAPs.size===1) title.textContent=[...selectedAPs][0];
    else title.textContent=`${selectedAPs.size} áreas protegidas`;
    sub.textContent=`2016–2023 · ${deforestationScopeLabel(rows)}`;
  }

  function renderDeforestationPanel(){
    const rows=scopedDeforestationRows();
    const apRows=deforestationRowsForSelectedAPs();
    const annualTotals=deforestationYears.map(year=>({year,value:sumDeforestationYear(rows,year)}));
    const cumulative=annualTotals.reduce((sum,item)=>sum+item.value,0);
    const latest=annualTotals[annualTotals.length-1] || {year:'',value:0};
    const average=deforestationYears.length?cumulative/deforestationYears.length:0;
    const apCount=new Set(rows.map(row=>normalizeAP(row.name))).size;
    const ecoCount=new Set(rows.map(row=>row.ecoregion)).size;
    const clearAP=selectedAPs.size
      ? ` · <a href="#" id="m3ClearAPFilter" style="color:var(--accent)">limpiar AP</a>`
      : '';

    grid.classList.remove('m3-three-kpis');
    breakdownCard.style.display='';
    grid.innerHTML=`
      <div class="kpi"><div class="lbl">Deforestación acumulada</div><div class="val">${formatSurfaceHTML(cumulative)}</div><div class="trend">2016–2023${clearAP}</div></div>
      <div class="kpi"><div class="lbl">Deforestación ${latest.year}</div><div class="val">${formatSurfaceHTML(latest.value)}</div><div class="trend">Último año disponible</div></div>
      <div class="kpi"><div class="lbl">Promedio anual</div><div class="val">${formatSurfaceHTML(average)}</div><div class="trend">Superficie por año</div></div>
      <div class="kpi"><div class="lbl">Cobertura del filtro</div><div class="val">${apCount}<span class="unit">AP</span></div><div class="trend">${ecoCount} ${ecoCount===1?'ecorregión':'ecorregiones'}</div></div>
    `;
    donutCard.innerHTML=`
      <h4>Evolución anual <span class="mono" style="color:var(--text-dim);font-size:10px">superficie (ha)</span></h4>
      ${annualChartHTML(annualTotals,'Evolución anual de la superficie deforestada en hectáreas')}
      <div class="m3-panel-note">${deforestationScopeLabel(rows)}. Datos agregados por año sin porcentajes.</div>
    `;
    breakdownCard.innerHTML=ecoregionFilterHTML(apRows);
    breakdownCard.querySelectorAll('[data-ecoregion]').forEach(button=>{
      button.addEventListener('click',()=>{
        const ecoregion=button.dataset.ecoregion;
        if(selectedEcoregions.has(ecoregion)) selectedEcoregions.delete(ecoregion);
        else selectedEcoregions.add(ecoregion);
        renderM3DataPanel();
      });
    });
    document.getElementById('m3ClearEcoregions')?.addEventListener('click',()=>{
      selectedEcoregions.clear();
      renderM3DataPanel();
    });
    document.getElementById('m3ClearAPFilter')?.addEventListener('click',event=>{
      event.preventDefault();
      document.getElementById('apFilterClear')?.click();
    });
    updateDeforestationContext(rows);
  }

  function miningRows(){
    const features=typeof geoData!=='undefined' && geoData.mineria_ilegal?.features;
    return Array.isArray(features) ? features.map(feature=>feature.properties||{}) : [];
  }

  function hasProtectedArea(row){
    return Boolean(String(row.nombre_ap||'').trim());
  }

  function scopedMiningRows(rows){
    if(miningOutsideOnly) return rows.filter(row=>!hasProtectedArea(row));
    if(selectedAPs.size===0) return rows;
    const selected=selectedAPKeys();
    return rows.filter(row=>selected.has(normalizeAP(row.nombre_ap)));
  }

  function miningScopeLabel(){
    if(miningOutsideOnly) return 'Fuera de área protegida';
    if(selectedAPs.size===0) return 'Bolivia';
    if(selectedAPs.size===1) return [...selectedAPs][0];
    return `${selectedAPs.size} áreas protegidas seleccionadas`;
  }

  function refreshMiningLayerStyle(){
    const layer=typeof moduleLayers!=='undefined' ? moduleLayers['3:mineria_ilegal'] : null;
    const layerDef=MODULES['3']?.layers.find(item=>item.id==='mineria_ilegal');
    if(layer&&layerDef) applyLayerOpacity('mineria_ilegal',layer,layerDef.opacity??78);
  }

  function updateMiningContext(years){
    const title=document.getElementById('rightTitle');
    const sub=document.getElementById('rightSub');
    if(!title||!sub) return;
    title.textContent=selectedAPs.size===0
      ? 'Minería ilegal'
      : selectedAPs.size===1
      ? [...selectedAPs][0]
      : `${selectedAPs.size} áreas protegidas`;
    const period=years.length?`${years[0]}–${years[years.length-1]}`:'Sin años';
    sub.textContent=`${period} · ${miningScopeLabel()} · superficie MINED_HA`;
  }

  function miningAPChartHTML(rows){
    const grouped=new Map();
    rows.filter(hasProtectedArea).forEach(row=>{
      const name=String(row.nombre_ap).trim();
      grouped.set(name,(grouped.get(name)||0)+(Number(row.MINED_HA)||0));
    });
    const values=[...grouped.entries()]
      .map(([name,ha])=>({name,ha}))
      .sort((a,b)=>b.ha-a.ha);
    values.push({
      name:'Fuera de área protegida',
      ha:sumRows(rows.filter(row=>!hasProtectedArea(row)),'MINED_HA'),
      outside:true
    });
    if(!values.length) return '<div class="search-empty">No existen registros de minería ilegal asociados a áreas protegidas.</div>';
    const maxValue=Math.max(...values.map(item=>item.ha),1);
    const selected=selectedAPKeys();
    return `<div class="m3-mining-ap-chart" role="list" aria-label="Superficie de minería ilegal por área protegida">
      ${values.map(item=>{
        const active=item.outside ? miningOutsideOnly : selected.has(normalizeAP(item.name));
        const height=Math.max(2,(item.ha/maxValue)*100);
        const exactValue=item.ha.toLocaleString('es-BO',{maximumFractionDigits:2});
        return `<button class="m3-mining-ap-item${active?' active':''}" type="button" role="listitem"
          data-mining-scope="${item.outside?'outside':'protected'}"
          data-mining-ap="${item.outside?'':escapeHTML(item.name)}" aria-pressed="${active}"
          title="${escapeHTML(item.name)}: ${exactValue} ha">
          <span class="m3-mining-ap-value">${compactSurface(item.ha)} ha</span>
          <span class="m3-mining-ap-track"><span class="m3-mining-ap-bar" style="height:${height}%"></span></span>
          <span class="m3-mining-ap-label">${escapeHTML(item.name)}</span>
        </button>`;
      }).join('')}
    </div>`;
  }

  function renderMiningPanel(){
    const allRows=miningRows();
    const rows=scopedMiningRows(allRows);
    const protectedRows=miningOutsideOnly
      ? []
      : selectedAPs.size===0
      ? allRows.filter(hasProtectedArea)
      : rows;
    const years=[...new Set(allRows.map(row=>Number(row.ANIO)).filter(Number.isFinite))].sort((a,b)=>a-b);
    const annualTotals=years.map(year=>({
      year,
      value:sumRows(rows.filter(row=>Number(row.ANIO)===year),'MINED_HA')
    }));
    const totalHa=sumRows(rows,'MINED_HA');
    const protectedHa=sumRows(protectedRows,'MINED_HA');
    const clearAP=selectedAPs.size||miningOutsideOnly
      ? ` · <a href="#" id="m3ClearMiningAP" style="color:var(--accent)">limpiar filtro</a>`
      : '';

    grid.classList.add('m3-three-kpis');
    breakdownCard.style.display='';
    grid.innerHTML=`
      <div class="kpi">
        <div class="lbl">${selectedAPs.size?'Superficie filtrada':'Minería ilegal total'}</div>
        <div class="val">${formatSurfaceHTML(totalHa)}</div>
        <div class="trend">${miningScopeLabel()}${clearAP}</div>
      </div>
      <div class="kpi">
        <div class="lbl">Superficie en áreas protegidas</div>
        <div class="val">${formatSurfaceHTML(protectedHa)}</div>
        <div class="trend">${selectedAPs.size?'AP seleccionadas':'Todas las AP con registros'}</div>
      </div>
      <div class="kpi">
        <div class="lbl">Polígonos identificados</div>
        <div class="val">${rows.length.toLocaleString('es-BO')}<span class="unit">polígonos</span></div>
        <div class="trend">Registros incluidos en el filtro</div>
      </div>
    `;
    donutCard.innerHTML=`
      <h4>Evolución anual <span class="mono" style="color:var(--text-dim);font-size:10px">superficie (ha)</span></h4>
      ${annualChartHTML(annualTotals,'Evolución anual de la superficie de minería ilegal en hectáreas','mining')}
      <div class="m3-panel-note">${miningScopeLabel()}. Superficie agregada desde MINED_HA; los polígonos fuera de AP se incluyen únicamente en la vista Bolivia.</div>
    `;
    breakdownCard.innerHTML=`
      <div class="m3-mining-ap-heading">
        <h4>Minería ilegal por área protegida</h4>
        <button class="m3-eco-clear" id="m3ClearMiningChart" type="button">Limpiar filtro</button>
      </div>
      ${miningAPChartHTML(allRows)}
      <div class="m3-panel-note">Selecciona una columna para aplicar el filtro al mapa y a la evolución anual.</div>
    `;
    breakdownCard.querySelectorAll('[data-mining-ap]').forEach(button=>{
      button.addEventListener('click',()=>{
        if(button.dataset.miningScope==='outside'){
          miningOutsideOnly=true;
          window.m3MiningOutsideOnly=true;
          if(selectedAPs.size) document.getElementById('apFilterClear')?.click();
          else renderM3DataPanel();
          return;
        }
        miningOutsideOnly=false;
        window.m3MiningOutsideOnly=false;
        toggleAPSelection(button.dataset.miningAp);
      });
    });
    const clearMiningFilter=()=>{
      miningOutsideOnly=false;
      window.m3MiningOutsideOnly=false;
      if(selectedAPs.size) document.getElementById('apFilterClear')?.click();
      else renderM3DataPanel();
    };
    document.getElementById('m3ClearMiningChart')?.addEventListener('click',clearMiningFilter);
    document.getElementById('m3ClearMiningAP')?.addEventListener('click',event=>{
      event.preventDefault();
      clearMiningFilter();
    });
    updateMiningContext(years);
  }

  function renderM3DataPanel(){
    if(currentModule!=='3'||!grid||!donutCard||!breakdownCard) return;
    if(selectedAPs.size&&miningOutsideOnly){
      miningOutsideOnly=false;
      window.m3MiningOutsideOnly=false;
    }
    updatePanelTabs();
    refreshMiningLayerStyle();
    if(activeThreatPanel==='mining') renderMiningPanel();
    else renderDeforestationPanel();
  }

  function restoreDefaultCards(){
    ensurePanelTabs().hidden=true;
    grid?.classList.remove('m3-three-kpis');
    if(donutCard) donutCard.innerHTML=defaultDonutHTML;
    if(breakdownCard){
      breakdownCard.style.display='';
      breakdownCard.innerHTML=defaultBreakdownHTML;
    }
  }

  window.renderM3DataPanel=renderM3DataPanel;
  renderModule=function(modId){
    if(modId!=='3') restoreDefaultCards();
    previousRenderModule(modId);
    if(modId==='3') renderM3DataPanel();
  };

  const app=document.querySelector('.app');
  const handle=document.getElementById('rightResizeHandle');
  const defaultWidth=340;
  let resizing=false;

  function maxPanelWidth(){
    const leftWidth=app.classList.contains('left-collapsed')?0:380;
    return Math.max(300,Math.min(720,window.innerWidth-leftWidth-320));
  }

  function setPanelWidth(width,persist){
    const next=Math.round(Math.max(300,Math.min(maxPanelWidth(),Number(width)||defaultWidth)));
    app.style.setProperty('--right-panel-width',`${next}px`);
    handle.setAttribute('aria-valuenow',String(next));
    if(persist){
      try{localStorage.setItem('geoportalRightPanelWidth',String(next));}catch(error){}
    }
    if(typeof map!=='undefined') map.invalidateSize({pan:false});
  }

  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0) return;
    resizing=true;
    app.classList.add('right-panel-resizing');
    try{handle.setPointerCapture?.(event.pointerId);}catch(_){}
    event.preventDefault();
  });
  document.addEventListener('pointermove',event=>{
    if(resizing) setPanelWidth(window.innerWidth-event.clientX,false);
  });
  document.addEventListener('pointerup',event=>{
    if(!resizing) return;
    resizing=false;
    app.classList.remove('right-panel-resizing');
    try{handle.releasePointerCapture?.(event.pointerId);}catch(_){}
    setPanelWidth(window.innerWidth-event.clientX,true);
  });
  handle.addEventListener('dblclick',()=>setPanelWidth(defaultWidth,true));
  handle.addEventListener('keydown',event=>{
    const current=parseInt(getComputedStyle(app).getPropertyValue('--right-panel-width'),10)||defaultWidth;
    if(event.key==='ArrowLeft'){event.preventDefault();setPanelWidth(current+20,true);}
    else if(event.key==='ArrowRight'){event.preventDefault();setPanelWidth(current-20,true);}
    else if(event.key==='Home'){event.preventDefault();setPanelWidth(defaultWidth,true);}
  });
  window.addEventListener('resize',()=>{
    const current=parseInt(getComputedStyle(app).getPropertyValue('--right-panel-width'),10)||defaultWidth;
    setPanelWidth(current,false);
  });

  let savedWidth=defaultWidth;
  try{savedWidth=parseInt(localStorage.getItem('geoportalRightPanelWidth'),10)||defaultWidth;}catch(error){}
  setPanelWidth(savedWidth,false);
})();
