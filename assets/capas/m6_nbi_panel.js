(function(){
  const layerId='nbi_municipal_2024';
  const dataUrl='assets/capas/nbi_municipal_2024.geojson';
  const grid=document.querySelector('.kpi-grid');
  const donutCard=document.querySelector('.donut-card');
  const breakdownCard=document.getElementById('breakdownCard');
  const defaultGridHTML=grid?grid.innerHTML:'';
  const defaultDonutHTML=donutCard?donutCard.innerHTML:'';
  const defaultBreakdownHTML=breakdownCard?breakdownCard.innerHTML:'';
  const previousRenderModule=renderModule;
  const previousCreateGeoJSONLayer=createGeoJSONLayer;
  const previousApplyLayerOpacity=applyLayerOpacity;

  let nbiData=null;
  let loadingPromise=null;
  let nbiLeafletLayer=null;
  let selectedDepartment='all';
  let selectedMunicipalityCode=null;

  const categorySpecs=[
    {label:'Necesidades satisfechas',key:'n_nbs',color:'#2c7a4b'},
    {label:'En el umbral',key:'n_umbral',color:'#a6c96a'},
    {label:'Pobreza moderada',key:'n_moderada',color:'#e8b84a'},
    {label:'Indigencia',key:'n_indigente',color:'#df7a32'},
    {label:'Marginalidad',key:'n_marginal',color:'#b93a32'}
  ];
  const componentSpecs=[
    {label:'Materiales de vivienda',key:'materiales'},
    {label:'Espacios habitables',key:'espacios'},
    {label:'Agua y saneamiento',key:'agua_saneamiento'},
    {label:'Energía',key:'energia'},
    {label:'Educación',key:'educacion'},
    {label:'Salud',key:'salud'}
  ];

  ACTIVE_LAYER_LEGENDS[layerId]={
    title:'Pobreza por NBI municipal · 2024',
    items:[
      {c:'#2c7a4b',l:'Menos de 30%',v:'Baja'},
      {c:'#a6c96a',l:'30–50%',v:'Media baja'},
      {c:'#e8b84a',l:'50–70%',v:'Media alta'},
      {c:'#df7a32',l:'70–85%',v:'Alta'},
      {c:'#b93a32',l:'85% o más',v:'Muy alta'}
    ]
  };
  LAYER_METADATA[layerId]={
    title:'Pobreza por Necesidades Básicas Insatisfechas (NBI)',
    body:[
      'Indicadores municipales de pobreza por NBI para 2012 y 2024, con población de referencia, niveles de pobreza y carencias sectoriales.',
      'La simbología representa el porcentaje de población pobre por NBI en 2024. El cambio se expresa en puntos porcentuales respecto de 2012.',
      'Fuente local: nbi-bolivia-municipio-pobre-total-2024.geojson.'
    ]
  };

  function num(value){
    const parsed=Number(value);
    return Number.isFinite(parsed)?parsed:0;
  }

  function povertyColor(value){
    const pct=num(value);
    if(pct<30) return '#2c7a4b';
    if(pct<50) return '#a6c96a';
    if(pct<70) return '#e8b84a';
    if(pct<85) return '#df7a32';
    return '#b93a32';
  }

  function featureStyle(feature,opacity=.85){
    const properties=feature?.properties||{};
    const code=String(properties.codigo||'');
    const dimmed=selectedDepartment!=='all'&&properties.nombre_dep!==selectedDepartment;
    const selected=selectedMunicipalityCode===code;
    const color=povertyColor(properties.pct_pobre_2024);
    return {
      color:selected?'#132c38':dimmed?'#b8bdb7':'#ffffff',
      weight:selected?2.6:.7,
      fillColor:color,
      fillOpacity: dimmed ? 0.045 : selected ? Math.min(1,opacity) : opacity*.78,
      opacity: dimmed ? 0.18 : Math.min(1,opacity+.1)
    };
  }

  function formatPct(value,digits=1){
    return `${num(value).toLocaleString('es-BO',{minimumFractionDigits:digits,maximumFractionDigits:digits})}%`;
  }

  function formatPP(value){
    const delta=num(value);
    const sign=delta>0?'+':'';
    return `${sign}${delta.toLocaleString('es-BO',{minimumFractionDigits:1,maximumFractionDigits:1})} pp`;
  }

  function nbiPopup(properties){
    const delta=num(properties.cambio_pobre_pp);
    const deltaColor=delta<=0?'#1f6b3a':'#a9372a';
    return `<div class="feature-popup"><h5>${escapeHTML(properties.nombre||'Municipio')}</h5><table>
      <tr><td>Departamento</td><td><b>${escapeHTML(properties.nombre_dep||'—')}</b></td></tr>
      <tr><td>Pobreza NBI 2024</td><td><b style="color:${povertyColor(properties.pct_pobre_2024)}">${formatPct(properties.pct_pobre_2024,2)}</b></td></tr>
      <tr><td>Pobreza NBI 2012</td><td>${formatPct(properties.pct_pobre_2012,2)}</td></tr>
      <tr><td>Cambio</td><td><b style="color:${deltaColor}">${formatPP(delta)}</b></td></tr>
      <tr><td>Población 2024</td><td>${num(properties.pob_referencia_2024).toLocaleString('es-BO')}</td></tr>
      <tr><td>Necesidades satisfechas</td><td>${formatPct(properties.pct_nbs_2024,2)}</td></tr>
    </table></div>`;
  }

  createGeoJSONLayer=function(id,layerDef){
    if(id!==layerId) return previousCreateGeoJSONLayer(id,layerDef);
    const data=geoData[id]||nbiData;
    if(!data) return L.layerGroup();
    nbiData=data;
    nbiLeafletLayer=L.geoJSON(data,{
      style:feature=>featureStyle(feature,(layerDef.opacity??85)/100),
      onEachFeature:(feature,layer)=>{
        const properties=feature.properties||{};
        layer.bindTooltip(`<b>${escapeHTML(properties.nombre||'Municipio')}</b> · ${formatPct(properties.pct_pobre_2024,1)} pobreza NBI`,{sticky:true,direction:'top',opacity:.96});
        layer.bindPopup(nbiPopup(properties),{maxWidth:285});
        layer.on('click',()=>setMunicipality(String(properties.codigo||''),true));
      }
    });
    return nbiLeafletLayer;
  };

  applyLayerOpacity=function(id,leafletLayer,pct){
    if(id!==layerId) return previousApplyLayerOpacity(id,leafletLayer,pct);
    const opacity=Math.max(0,Math.min(1,num(pct)/100));
    if(leafletLayer?.eachLayer){
      leafletLayer.eachLayer(child=>{
        if(child.feature&&child.setStyle) child.setStyle(featureStyle(child.feature,opacity));
      });
    }
  };

  function ensureData(){
    if(nbiData) return Promise.resolve(nbiData);
    if(geoData[layerId]){
      nbiData=geoData[layerId];
      return Promise.resolve(nbiData);
    }
    if(!loadingPromise){
      loadingPromise=fetch(dataUrl)
        .then(response=>{
          if(!response.ok) throw new Error(`No se pudo cargar ${dataUrl}`);
          return response.json();
        })
        .then(data=>{
          geoData[layerId]=data;
          nbiData=data;
          return data;
        })
        .catch(error=>{
          console.warn('No se pudieron cargar los datos NBI:',error);
          return null;
        });
    }
    return loadingPromise;
  }

  function allRows(){
    return (nbiData?.features||[]).map(feature=>feature.properties||{});
  }

  function scopeRows(){
    const rows=allRows();
    if(selectedMunicipalityCode) return rows.filter(row=>String(row.codigo)===selectedMunicipalityCode);
    if(selectedDepartment!=='all') return rows.filter(row=>row.nombre_dep===selectedDepartment);
    return rows;
  }

  function rankingRows(){
    const rows=allRows();
    return (selectedDepartment==='all'?rows:rows.filter(row=>row.nombre_dep===selectedDepartment))
      .sort((a,b)=>num(b.pct_pobre_2024)-num(a.pct_pobre_2024));
  }

  function aggregate(rows){
    const result={municipalities:rows.length,pop2012:0,pop2024:0,poor2012:0,poor2024:0,categories:[],components:[]};
    rows.forEach(row=>{
      result.pop2012+=num(row.pob_referencia_2012);
      result.pop2024+=num(row.pob_referencia_2024);
      result.poor2012+=num(row.n_pobre_2012);
      result.poor2024+=num(row.n_pobre_2024);
    });
    const pct=(value,total)=>total>0?value/total*100:0;
    result.pctPoor2012=pct(result.poor2012,result.pop2012);
    result.pctPoor2024=pct(result.poor2024,result.pop2024);
    result.delta=result.pctPoor2024-result.pctPoor2012;
    result.categories=categorySpecs.map(spec=>{
      const count2012=rows.reduce((sum,row)=>sum+num(row[`${spec.key}_2012`]),0);
      const count2024=rows.reduce((sum,row)=>sum+num(row[`${spec.key}_2024`]),0);
      return {...spec,pct2012:pct(count2012,result.pop2012),pct2024:pct(count2024,result.pop2024)};
    });
    result.components=componentSpecs.map(spec=>{
      const count2012=rows.reduce((sum,row)=>sum+num(row[`n_c_${spec.key}_2012`]),0);
      const count2024=rows.reduce((sum,row)=>sum+num(row[`n_c_${spec.key}_2024`]),0);
      const pct2012=pct(count2012,result.pop2012);
      const pct2024=pct(count2024,result.pop2024);
      return {...spec,pct2012,pct2024,delta:pct2024-pct2012};
    });
    return result;
  }

  function compactPopulation(value){
    const total=num(value);
    if(total>=1e6) return `${(total/1e6).toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2})}<span class="unit">M hab.</span>`;
    if(total>=1e3) return `${(total/1e3).toLocaleString('es-BO',{minimumFractionDigits:1,maximumFractionDigits:1})}<span class="unit">mil hab.</span>`;
    return `${Math.round(total).toLocaleString('es-BO')}<span class="unit">hab.</span>`;
  }

  function departmentOptions(){
    const departments=[...new Set(allRows().map(row=>row.nombre_dep).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
    return `<option value="all">Bolivia · todos los departamentos</option>${departments.map(name=>`<option value="${escapeHTML(name)}"${selectedDepartment===name?' selected':''}>${escapeHTML(name)}</option>`).join('')}`;
  }

  function comparisonChart(categories){
    return `<div class="m6-chart-legend"><span class="previous"><i></i>2012</span><span><i></i>2024</span></div>
      <div class="m6-compare-chart">${categories.map(item=>`<div class="m6-compare-row">
        <div class="m6-compare-label">${escapeHTML(item.label)}</div>
        <div class="m6-paired-bars">
          <div class="m6-bar-line"><span class="m6-year">2012</span><span class="m6-bar-track"><i class="m6-bar previous" style="width:${Math.max(.3,item.pct2012).toFixed(2)}%;background:${item.color}"></i></span><span class="m6-bar-value">${formatPct(item.pct2012)}</span></div>
          <div class="m6-bar-line"><span class="m6-year">2024</span><span class="m6-bar-track"><i class="m6-bar" style="width:${Math.max(.3,item.pct2024).toFixed(2)}%;background:${item.color}"></i></span><span class="m6-bar-value">${formatPct(item.pct2024)}</span></div>
        </div>
      </div>`).join('')}</div>`;
  }

  function componentChart(components){
    return `<div class="m6-component-chart">${components.map(item=>{
      const changeClass=item.delta<=0?'better':'worse';
      return `<div class="m6-component-row">
        <span class="m6-component-label">${escapeHTML(item.label)}</span>
        <span class="m6-bar-track"><i class="m6-bar" style="width:${Math.max(.3,item.pct2024).toFixed(2)}%;background:#4a8aa8"></i></span>
        <span class="m6-bar-value">${formatPct(item.pct2024)}</span>
        <span class="m6-delta ${changeClass}">${formatPP(item.delta)}</span>
      </div>`;
    }).join('')}</div>`;
  }

  function rankingChart(rows){
    const top=rows.slice(0,8);
    const max=Math.max(1,...top.map(row=>num(row.pct_pobre_2024)));
    return `<div class="m6-ranking">${top.map((row,index)=>`<button class="m6-rank-row${selectedMunicipalityCode===String(row.codigo)?' active':''}" type="button" data-m6-code="${escapeHTML(String(row.codigo))}">
      <span class="m6-rank-num">${index+1}</span>
      <span class="m6-rank-name">${escapeHTML(row.nombre)}<small>${escapeHTML(row.nombre_dep)}</small><span class="m6-bar-track" style="display:block;margin-top:4px"><i class="m6-bar" style="width:${(num(row.pct_pobre_2024)/max*100).toFixed(2)}%;background:${povertyColor(row.pct_pobre_2024)}"></i></span></span>
      <span class="m6-rank-value">${formatPct(row.pct_pobre_2024)}</span>
    </button>`).join('')}</div>`;
  }

  function scopeLabel(rows){
    if(selectedMunicipalityCode) return rows[0]?.nombre||'Municipio';
    if(selectedDepartment!=='all') return selectedDepartment;
    return 'Bolivia';
  }

  function updateContext(rows){
    const title=document.getElementById('rightTitle');
    const sub=document.getElementById('rightSub');
    if(!title||!sub) return;
    if(selectedMunicipalityCode&&rows[0]){
      title.textContent=rows[0].nombre;
      sub.textContent=`${rows[0].nombre_dep} · ${rows[0].nombre_prov} · NBI 2012–2024`;
    }else{
      title.textContent=selectedDepartment==='all'?'Pobreza por NBI':`NBI · ${selectedDepartment}`;
      sub.textContent=`${rows.length} municipios · indicadores ponderados por población`;
    }
  }

  function renderLoading(){
    if(!grid||!donutCard||!breakdownCard) return;
    grid.innerHTML='<div class="kpi" style="grid-column:1/-1"><div class="lbl">Indicadores NBI</div><div class="trend">Cargando información municipal…</div></div>';
    donutCard.innerHTML='<h4>Distribución de niveles NBI</h4><div class="m6-panel-note">Preparando indicadores 2012–2024…</div>';
    breakdownCard.style.display='none';
  }

  function renderM6DataPanel(){
    if(currentModule!=='6'||!grid||!donutCard||!breakdownCard) return;
    if(!nbiData){
      renderLoading();
      ensureData().then(()=>{if(currentModule==='6')renderM6DataPanel();});
      return;
    }
    const rows=scopeRows();
    const metrics=aggregate(rows);
    const label=scopeLabel(rows);
    const deltaClass=metrics.delta<=0?'m6-better':'m6-worse';
    const deltaText=metrics.delta<=0?'reducción respecto de 2012':'aumento respecto de 2012';

    grid.classList.remove('m3-three-kpis');
    grid.innerHTML=`
      <div class="kpi"><div class="lbl">Pobreza por NBI 2024</div><div class="val">${formatPct(metrics.pctPoor2024)}</div><div class="trend">${metrics.poor2024.toLocaleString('es-BO')} personas</div></div>
      <div class="kpi"><div class="lbl">Pobreza por NBI 2012</div><div class="val">${formatPct(metrics.pctPoor2012)}</div><div class="trend">Periodo de comparación</div></div>
      <div class="kpi"><div class="lbl">Cambio 2012–2024</div><div class="val">${formatPP(metrics.delta)}</div><div class="trend ${deltaClass}">${metrics.delta<=0?'▼':'▲'} ${deltaText}</div></div>
      <div class="kpi"><div class="lbl">Población de referencia</div><div class="val">${compactPopulation(metrics.pop2024)}</div><div class="trend">${metrics.municipalities} municipio${metrics.municipalities===1?'':'s'} · 2024</div></div>
    `;

    donutCard.innerHTML=`
      <h4>Estructura de los niveles NBI <span class="mono" style="color:var(--text-dim);font-size:10px">2012 vs 2024</span></h4>
      <div class="m6-filter-toolbar">
        <select class="m6-select" id="m6DepartmentSelect" aria-label="Filtrar indicadores NBI por departamento">${departmentOptions()}</select>
        <button class="m6-clear" id="m6ResetFilter" type="button"${selectedDepartment==='all'&&!selectedMunicipalityCode?' disabled':''}>Restablecer</button>
      </div>
      ${comparisonChart(metrics.categories)}
      <div class="m6-panel-note">Pobreza NBI = pobreza moderada + indigencia + marginalidad. Vista: ${escapeHTML(label)}.</div>
    `;

    breakdownCard.style.display='';
    breakdownCard.innerHTML=`
      <h4>Carencias de la población · 2024</h4>
      ${componentChart(metrics.components)}
      <div class="m6-panel-note">La etiqueta muestra el cambio en puntos porcentuales respecto de 2012.</div>
      <h4 class="m6-section-title">Municipios con mayor pobreza NBI</h4>
      ${rankingChart(rankingRows())}
      <div class="m6-panel-note">Selecciona un municipio para actualizar todos los indicadores y resaltarlo en el mapa.</div>
    `;

    document.getElementById('m6DepartmentSelect')?.addEventListener('change',event=>{
      selectedDepartment=event.target.value;
      selectedMunicipalityCode=null;
      refreshLayerStyles();
      zoomToScope();
      renderM6DataPanel();
    });
    document.getElementById('m6ResetFilter')?.addEventListener('click',()=>{
      selectedDepartment='all';
      selectedMunicipalityCode=null;
      refreshLayerStyles();
      map.flyTo([-16.5,-64.5],5,{duration:.7});
      renderM6DataPanel();
    });
    breakdownCard.querySelectorAll('[data-m6-code]').forEach(button=>{
      button.addEventListener('click',()=>setMunicipality(button.dataset.m6Code,true));
    });
    updateContext(rows);
  }

  function refreshLayerStyles(){
    if(!nbiLeafletLayer) return;
    const layerDef=MODULES['6'].layers.find(layer=>layer.id===layerId);
    applyLayerOpacity(layerId,nbiLeafletLayer,layerDef?.opacity??85);
  }

  function zoomToScope(){
    if(!nbiLeafletLayer) return;
    const bounds=L.latLngBounds();
    nbiLeafletLayer.eachLayer(layer=>{
      const properties=layer.feature?.properties||{};
      if(selectedDepartment==='all'||properties.nombre_dep===selectedDepartment){
        if(layer.getBounds) bounds.extend(layer.getBounds());
      }
    });
    if(bounds.isValid()) map.fitBounds(bounds.pad(.08),{animate:true,duration:.7,maxZoom:7});
  }

  function setMunicipality(code,focusMap){
    const row=allRows().find(item=>String(item.codigo)===String(code));
    if(!row) return;
    selectedMunicipalityCode=String(code);
    selectedDepartment=row.nombre_dep||'all';
    refreshLayerStyles();
    if(focusMap&&nbiLeafletLayer){
      nbiLeafletLayer.eachLayer(layer=>{
        if(String(layer.feature?.properties?.codigo)===selectedMunicipalityCode&&layer.getBounds){
          map.fitBounds(layer.getBounds().pad(.22),{animate:true,duration:.7,maxZoom:9});
        }
      });
    }
    renderM6DataPanel();
  }

  function restoreDefaultCards(){
    if(grid){
      grid.classList.remove('m3-three-kpis');
      grid.innerHTML=defaultGridHTML;
    }
    if(donutCard) donutCard.innerHTML=defaultDonutHTML;
    if(breakdownCard){
      breakdownCard.style.display='';
      breakdownCard.innerHTML=defaultBreakdownHTML;
    }
  }

  window.renderM6DataPanel=renderM6DataPanel;
  window.setM6Municipality=setMunicipality;
  renderModule=function(modId){
    if(modId!=='6') restoreDefaultCards();
    previousRenderModule(modId);
    if(modId==='6') renderM6DataPanel();
  };
})();
