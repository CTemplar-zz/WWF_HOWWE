(function(){
  const metrics = Array.isArray(window.AP_METRICS_M2) ? window.AP_METRICS_M2 : [];
  const filterWrap = document.getElementById('apFilterWrap');
  const filterButton = document.getElementById('apFilterBtn');
  const filterPanel = document.getElementById('apFilterPanel');
  const filterCount = document.getElementById('apFilterCount');
  const filterList = document.getElementById('apFilterList');
  const filterSearch = document.getElementById('apFilterSearch');
  const filterSummary = document.getElementById('apFilterSummary');
  const singleButton = document.getElementById('apFilterSingle');
  const multipleButton = document.getElementById('apFilterMultiple');
  const clearButton = document.getElementById('apFilterClear');
  const donutCard = document.querySelector('.donut-card');
  const breakdownCard = document.getElementById('breakdownCard');
  const defaultDonutHTML = donutCard ? donutCard.innerHTML : '';
  const defaultBreakdownHTML = breakdownCard ? breakdownCard.innerHTML : '';
  const originalRenderModule = renderModule;
  const filterModules = new Set(Object.keys(MODULES));
  let selectionMode = 'single';

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,' ')
    .trim();

  const metricByName = new Map(metrics.map(row => [normalize(row.name), row]));
  const selectedNormalized = () => new Set([...selectedAPs].map(normalize));
  const availableAPNames = () => new Set(APN.map(ap => normalize(ap.name)));

  function scopedMetrics(){
    const available = availableAPNames();
    const selected = selectedNormalized();
    return metrics.filter(row => available.has(normalize(row.name)) && (selected.size===0 || selected.has(normalize(row.name))));
  }

  function sum(rows,key){
    return rows.reduce((total,row)=>{
      const value=Number(row[key]);
      return total+(Number.isFinite(value)?value:0);
    },0);
  }

  function formatSurface(ha){
    return `${formatHa(ha)}<span class="unit">${haUnitLabel(ha)}</span>`;
  }

  function formatLength(km){
    if(!Number.isFinite(km)||km<=0) return '0 <span class="unit">km</span>';
    const digits=km>=1000?0:km>=100?1:2;
    return `${km.toLocaleString('es-BO',{minimumFractionDigits:digits,maximumFractionDigits:digits})}<span class="unit">km</span>`;
  }

  function metricRow(label,value,color,unit){
    const formatted=unit==='km'
      ? value.toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2})+' km'
      : formatHaCell(value);
    return `<div class="m4-metric-row">
      <span class="mark" style="background:${color}"></span>
      <span class="label">${label}</span>
      <span class="value">${formatted}</span>
    </div>`;
  }

  function scopeLabel(rows){
    if(selectedAPs.size===0) return `${rows.length} áreas protegidas`;
    if(selectedAPs.size===1) return [...selectedAPs][0];
    return `${selectedAPs.size} áreas protegidas seleccionadas`;
  }

  function renderM4DataPanel(){
    if(currentModule!=='4') return;
    const rows=scopedMetrics();
    const grid=document.querySelector('.kpi-grid');
    if(!grid||!donutCard||!breakdownCard) return;

    const apHa=sum(rows,'apHa');
    const aquaticHa=sum(rows,'aquaticTotalHa');
    const lakesHa=sum(rows,'lakesHa');
    const bofedalesHa=sum(rows,'bofedalesHa');
    const label=scopeLabel(rows);
    const clearLink=selectedAPs.size
      ? ` · <a href="#" id="m4ClearAPFilter" style="color:var(--accent)">limpiar</a>`
      : '';

    grid.innerHTML=`
      <div class="kpi"><div class="lbl">Superficie de las APs</div><div class="val">${formatSurface(apHa)}</div><div class="trend">${label}${clearLink}</div></div>
      <div class="kpi"><div class="lbl">Humedales y sistemas acuáticos</div><div class="val">${formatSurface(aquaticHa)}</div><div class="trend">Superficie consolidada</div></div>
      <div class="kpi"><div class="lbl">Lagos y lagunas</div><div class="val">${formatSurface(lakesHa)}</div><div class="trend">Superficie dentro de APs</div></div>
      <div class="kpi"><div class="lbl">Bofedales</div><div class="val">${formatSurface(bofedalesHa)}</div><div class="trend">Superficie combinada</div></div>
    `;

    donutCard.innerHTML=`
      <h4>Desglose de superficies <span class="mono" style="color:var(--text-dim);font-size:10px">${label}</span></h4>
      <div class="m4-metric-list">
        ${metricRow('Aguas blancas',sum(rows,'whiteHa'),'#0084a8','ha')}
        ${metricRow('Aguas claras',sum(rows,'clearHa'),'#004da8','ha')}
        ${metricRow('Aguas mixtas',sum(rows,'mixedHa'),'#ffaa00','ha')}
        ${metricRow('Aguas negras',sum(rows,'blackHa'),'#895a44','ha')}
        ${metricRow('Inundación estacional',sum(rows,'seasonalHa'),'#9f9fe8','ha')}
        ${metricRow('Inundación frecuente',sum(rows,'frequentHa'),'#5656c7','ha')}
      </div>
      <div class="m4-metric-note">Valores de superficie en hectáreas. No se muestran porcentajes.</div>
    `;

    breakdownCard.innerHTML=`
      <h4>Longitud de ríos por clase CSI</h4>
      <div class="m4-metric-list">
        ${metricRow('Clase 1',sum(rows,'river1Km'),'#1f78b4','km')}
        ${metricRow('Clase 2',sum(rows,'river2Km'),'#ffd43b','km')}
        ${metricRow('Clase 3',sum(rows,'river3Km'),'#d7191c','km')}
      </div>
      <div class="m4-metric-note">Longitudes geodésicas acumuladas para las áreas protegidas visibles.</div>
    `;

    const clear=document.getElementById('m4ClearAPFilter');
    if(clear) clear.addEventListener('click',event=>{event.preventDefault();clearSelection();});
    updateRightContext(rows);
    updateFilterControls();
  }

  function refreshActiveDataPanel(){
    if(currentModule==='4' && typeof renderM4Stats==='function') renderM4Stats();
    else if(currentModule==='3' && typeof window.renderM3DataPanel==='function'){
      window.renderM3DataPanel();
    }else if(currentModule==='1' && typeof window.renderM1DataPanel==='function'){
      window.renderM1DataPanel();
    }else if(currentModule==='8' && typeof window.renderM8DataPanel==='function'){
      window.renderM8DataPanel();
    }
  }

  function restoreDefaultCards(){
    if(donutCard) donutCard.innerHTML=defaultDonutHTML;
    if(breakdownCard) breakdownCard.innerHTML=defaultBreakdownHTML;
  }

  function updateRightContext(rows=scopedMetrics()){
    const title=document.getElementById('rightTitle');
    const sub=document.getElementById('rightSub');
    if(!title||!sub) return;
    if(selectedAPs.size===0){
      title.textContent='Bolivia';
      sub.textContent=`${rows.length} áreas protegidas · superficies y longitudes`;
    }else if(selectedAPs.size===1){
      title.textContent=[...selectedAPs][0];
      sub.textContent='1 área protegida seleccionada · filtro espacial activo';
    }else{
      title.textContent=`${selectedAPs.size} áreas protegidas`;
      sub.textContent='Selección múltiple · superficies y longitudes acumuladas';
    }
  }

  function updateMapView(){
    const chosen=APN.filter(ap=>selectedAPs.has(ap.name));
    if(chosen.length===1) map.flyTo(chosen[0].center,7,{duration:.7});
    else if(chosen.length>1){
      const bounds=L.latLngBounds(chosen.map(ap=>ap.center));
      if(bounds.isValid()) map.fitBounds(bounds.pad(.18),{animate:true,duration:.7,maxZoom:7});
    }
    document.getElementById('crumbArea').textContent=selectedAPs.size
      ? `${selectedAPs.size} AP seleccionada${selectedAPs.size===1?'':'s'}`
      : `${APN.length} Áreas Protegidas`;
  }

  function applySelection(name){
    if(selectionMode==='single'){
      selectedAPs.clear();
      selectedAPs.add(name);
    }else{
      if(selectedAPs.has(name)) selectedAPs.delete(name);
      else selectedAPs.add(name);
    }
    updateAPMapFilter();
    renderAPList();
    updateMapView();
    refreshActiveDataPanel();
    renderFilterList(filterSearch.value);
    if(selectionMode==='single') closeFilter();
  }

  function clearSelection(){
    selectedAPs.clear();
    updateAPMapFilter();
    renderAPList();
    updateMapView();
    refreshActiveDataPanel();
    renderFilterList(filterSearch.value);
  }

  window.setProtectedAreaFilter=function(names){
    selectedAPs.clear();
    (Array.isArray(names)?names:[]).forEach(name=>{
      const match=APN.find(ap=>normalize(ap.name)===normalize(name));
      if(match) selectedAPs.add(match.name);
    });
    updateAPMapFilter();
    renderAPList();
    updateMapView();
    refreshActiveDataPanel();
    renderFilterList(filterSearch.value);
  };
  window.clearProtectedAreaFilter=clearSelection;

  function renderFilterList(query=''){
    const q=normalize(query);
    const rows=APN.filter(ap=>!q||normalize(`${ap.name} ${ap.cat}`).includes(q));
    filterList.classList.toggle('ap-filter-mode-single',selectionMode==='single');
    filterList.innerHTML=rows.map(ap=>{
      const selected=selectedAPs.has(ap.name);
      return `<button class="ap-filter-item${selected?' selected':''}" type="button" data-ap="${escapeHTML(ap.name)}" aria-pressed="${selected}">
        <span class="ap-filter-check">${selected?'✓':''}</span>
        <span class="ap-filter-item-name">${escapeHTML(ap.name)}</span>
        <span class="ap-filter-item-cat">${escapeHTML(catAcronym(ap.cat))}</span>
      </button>`;
    }).join('') || '<div class="search-empty">No se encontraron áreas protegidas.</div>';
    filterList.querySelectorAll('[data-ap]').forEach(button=>{
      button.addEventListener('click',()=>applySelection(button.dataset.ap));
    });
    updateFilterControls();
  }

  function updateFilterControls(){
    const count=selectedAPs.size;
    filterCount.textContent=String(count);
    filterCount.classList.toggle('visible',count>0);
    filterButton.classList.toggle('active',count>0||filterPanel.classList.contains('open'));
    filterSummary.textContent=count===0?'Todas las áreas':`${count} seleccionada${count===1?'':'s'}`;
    singleButton.classList.toggle('active',selectionMode==='single');
    multipleButton.classList.toggle('active',selectionMode==='multiple');
    singleButton.setAttribute('aria-pressed',String(selectionMode==='single'));
    multipleButton.setAttribute('aria-pressed',String(selectionMode==='multiple'));
  }

  function openFilter(){
    filterPanel.classList.add('open');
    filterButton.setAttribute('aria-expanded','true');
    filterButton.classList.add('active');
    renderFilterList(filterSearch.value);
    setTimeout(()=>filterSearch.focus(),0);
  }

  function closeFilter(){
    filterPanel.classList.remove('open');
    filterButton.setAttribute('aria-expanded','false');
    updateFilterControls();
  }

  filterButton.addEventListener('click',event=>{
    event.stopPropagation();
    filterPanel.classList.contains('open')?closeFilter():openFilter();
  });
  filterPanel.addEventListener('click',event=>event.stopPropagation());
  filterSearch.addEventListener('input',()=>renderFilterList(filterSearch.value));
  singleButton.addEventListener('click',()=>{
    selectionMode='single';
    if(selectedAPs.size>1){
      const first=selectedAPs.values().next().value;
      selectedAPs.clear();
      if(first) selectedAPs.add(first);
      updateAPMapFilter(); renderAPList(); updateMapView(); refreshActiveDataPanel();
    }
    renderFilterList(filterSearch.value);
  });
  multipleButton.addEventListener('click',()=>{selectionMode='multiple';renderFilterList(filterSearch.value);});
  clearButton.addEventListener('click',clearSelection);
  document.addEventListener('click',event=>{if(!filterWrap.contains(event.target))closeFilter();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeFilter();});

  const originalToggleAPSelection = toggleAPSelection;
  toggleAPSelection=function(name){
    if(filterModules.has(currentModule)) applySelection(name);
    else originalToggleAPSelection(name);
  };
  renderModule=function(modId){
    if(modId!=='4') restoreDefaultCards();
    originalRenderModule(modId);
    filterWrap.classList.toggle('module-hidden',!filterModules.has(modId));
    if(modId==='4' && typeof renderM4Stats==='function') renderM4Stats();
  };

  filterWrap.classList.toggle('module-hidden',!filterModules.has(currentModule));
  renderFilterList();
  if(currentModule==='4' && typeof renderM4Stats==='function') renderM4Stats();
})();
