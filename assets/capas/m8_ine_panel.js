(function(){
  const MODULE_ID='8';
  const COMMUNITIES_ID='ine_comunidades_m8';
  const BLOCKS_ID='ine_manzanas_m8';
  const DATA_URL='assets/capas/ine_m8_data.json';
  const COMMUNITIES_URL='assets/capas/ine_comunidades_m8.geojson';
  const BLOCKS_URL='assets/capas/ine_manzanas_m8.geojson';
  const grid=document.querySelector('.kpi-grid');
  const donutCard=document.querySelector('.donut-card');
  const breakdownCard=document.getElementById('breakdownCard');
  const defaultGridHTML=grid?grid.innerHTML:'';
  const defaultDonutHTML=donutCard?donutCard.innerHTML:'';
  const defaultBreakdownHTML=breakdownCard?breakdownCard.innerHTML:'';
  const previousRenderModule=renderModule;
  const previousCreateGeoJSONLayer=createGeoJSONLayer;
  const previousApplyLayerOpacity=applyLayerOpacity;

  let censusData=null;
  let communitiesData=null;
  let blocksData=null;
  let loadPromise=null;
  let communitiesLayer=null;
  let blocksLayer=null;
  let selectionLabel='Sin selección para reporte';
  let statusMessage='Selecciona una o más áreas protegidas, unidades en el mapa o dibuja un límite.';
  let statusKind='info';
  let busy=false;
  let drawMode=null;
  let drawLayer=null;
  let drawStart=null;
  let polygonPoints=[];
  const selectedCodes=new Set();

  const style=document.createElement('style');
  style.textContent=`
    .m8-toolbar{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:9px 0}
    .m8-btn{border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:7px;padding:8px 9px;font:600 11px Inter,sans-serif;cursor:pointer;text-align:center}
    .m8-btn:hover{border-color:#5b6fb3;color:#40579d}.m8-btn.primary{grid-column:1/-1;background:#5b6fb3;color:#fff;border-color:#5b6fb3;font-size:12px;padding:10px}
    .m8-btn.secondary{background:color-mix(in srgb,#5b6fb3 10%,var(--panel))}.m8-btn.danger{color:#a13d35}.m8-btn:disabled{opacity:.48;cursor:not-allowed}
    .m8-status{font-size:11px;line-height:1.45;border-radius:7px;padding:8px 10px;background:var(--panel-2);color:var(--text-dim);margin-top:8px}
    .m8-status.success{background:#e7f3eb;color:#1f6b3a}.m8-status.error{background:#fbe9e7;color:#9d3028}.m8-status.working{background:#eef1fb;color:#40579d}
    .m8-scope{font-size:11px;color:var(--text-dim);margin-top:5px}.m8-scope strong{color:var(--text)}
    .m8-unit-list{max-height:240px;overflow:auto;display:flex;flex-direction:column;gap:4px;margin-top:8px}
    .m8-unit-row{display:grid;grid-template-columns:12px 1fr auto;gap:7px;align-items:center;padding:6px 7px;border:1px solid var(--border);border-radius:6px;font-size:10px}
    .m8-unit-row i{width:8px;height:8px;border-radius:50%;background:#5b6fb3}.m8-unit-row small{color:var(--text-dim)}
    .m8-draw-help{font-size:10px;color:var(--text-dim);line-height:1.45;margin:4px 0 8px}.m8-draw-active{outline:2px solid #5b6fb3!important}
    .m8-source-note{font-size:9px;color:var(--text-dim);line-height:1.4;margin-top:8px}
  `;
  document.head.appendChild(style);

  ACTIVE_LAYER_LEGENDS[COMMUNITIES_ID]={title:'Comunidades y centros urbanos INE',items:[
    {c:'#5b6fb3',l:'Comunidad rural',v:'Código -D'},
    {c:'#8c5bc0',l:'Centro urbano',v:'Código -M'}
  ]};
  ACTIVE_LAYER_LEGENDS[BLOCKS_ID]={title:'Manzanas censales INE',items:[{c:'#e08a24',l:'Manzana censal',v:'Código -A'}]};
  LAYER_METADATA[COMMUNITIES_ID]={title:'Comunidades y centros urbanos · Censo 2024',body:[
    'Puntos oficiales consultados mediante la API del Geoportal del INE y extraídos dentro de áreas protegidas.',
    'COD_INE es el identificador utilizado para validar y generar fichas técnicas oficiales.'
  ]};
  LAYER_METADATA[BLOCKS_ID]={title:'Manzanas censales · Censo 2024',body:[
    'Manzanas oficiales consultadas mediante la API del Geoportal del INE.',
    'Las geometrías fueron reparadas y asignadas a las áreas protegidas mediante su centroide.'
  ]};

  const num=value=>Number.isFinite(Number(value))?Number(value):0;
  const compact=value=>num(value).toLocaleString('es-BO');
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const codeOf=feature=>String(feature?.properties?.COD_INE||'');
  const groupOf=feature=>`${normalize(feature?.properties?.NOMBRE)}|${feature?.properties?.COD_MPIO||''}`;

  function pointStyle(feature){
    const code=codeOf(feature);
    const selected=selectedCodes.has(code);
    const urban=code.endsWith('-M');
    return {radius:selected?7:4,color:selected?'#172554':'#fff',weight:selected?2:1,fillColor:urban?'#8c5bc0':'#5b6fb3',fillOpacity:.92,opacity:1};
  }
  function blockStyle(feature,opacity=.7){
    const selected=selectedCodes.has(codeOf(feature));
    return {color:selected?'#8f3b00':'#b45f06',weight:selected?2.2:.65,fillColor:'#e08a24',fillOpacity:selected ? .55 : Math.max(.08,opacity*.24),opacity:selected?1:opacity};
  }
  function popup(feature){
    const p=feature.properties||{};
    return `<div class="feature-popup"><h5>${escapeHTML(p.NOMBRE||'Unidad censal')}</h5><table>
      <tr><td>Tipo</td><td><b>${escapeHTML((p.TIPO_UNIDAD||'').replaceAll('_',' '))}</b></td></tr>
      <tr><td>Código INE</td><td><span class="mono">${escapeHTML(p.COD_INE||'—')}</span></td></tr>
      <tr><td>Municipio</td><td>${escapeHTML(p.MUNICIPIO||'—')}</td></tr>
    </table><div style="margin-top:7px;font-size:10px;color:var(--text-dim)">Haz clic para agregar o quitar esta unidad del reporte.</div></div>`;
  }
  function toggleCode(code){
    if(!code||drawMode) return;
    if(selectedCodes.has(code)) selectedCodes.delete(code); else selectedCodes.add(code);
    selectionLabel='Selección individual en el mapa';
    statusMessage=selectedCodes.size?'Unidades seleccionadas. Ya puedes verificar o generar la ficha.':'La selección está vacía.';
    statusKind='info';
    refreshLayerStyles();
    renderM8DataPanel();
  }

  createGeoJSONLayer=function(id,layerDef){
    if(id===COMMUNITIES_ID){
      communitiesData=geoData[id]||communitiesData;
      communitiesLayer=L.geoJSON(communitiesData||{type:'FeatureCollection',features:[]},{
        pointToLayer:(feature,latlng)=>L.circleMarker(latlng,pointStyle(feature)),
        onEachFeature:(feature,layer)=>{
          layer.bindTooltip(`<b>${escapeHTML(feature.properties?.NOMBRE||'Comunidad')}</b>`,{sticky:true,direction:'top'});
          layer.bindPopup(popup(feature),{maxWidth:300});
          layer.on('click',()=>toggleCode(codeOf(feature)));
        }
      });
      return communitiesLayer;
    }
    if(id===BLOCKS_ID){
      blocksData=geoData[id]||blocksData;
      blocksLayer=L.geoJSON(blocksData||{type:'FeatureCollection',features:[]},{
        style:feature=>blockStyle(feature,(layerDef.opacity??70)/100),
        onEachFeature:(feature,layer)=>{
          layer.bindTooltip(`<b>${escapeHTML(feature.properties?.NOMBRE||'Manzana')}</b>`,{sticky:true,direction:'top'});
          layer.bindPopup(popup(feature),{maxWidth:300});
          layer.on('click',()=>toggleCode(codeOf(feature)));
        }
      });
      return blocksLayer;
    }
    return previousCreateGeoJSONLayer(id,layerDef);
  };

  applyLayerOpacity=function(id,layer,pct){
    if(id===COMMUNITIES_ID){
      layer?.eachLayer(child=>{if(child.feature&&child.setStyle)child.setStyle(pointStyle(child.feature));});
      return;
    }
    if(id===BLOCKS_ID){
      const opacity=Math.max(0,Math.min(1,num(pct)/100));
      layer?.eachLayer(child=>{if(child.feature&&child.setStyle)child.setStyle(blockStyle(child.feature,opacity));});
      return;
    }
    previousApplyLayerOpacity(id,layer,pct);
  };

  function ensureData(){
    if(censusData&&communitiesData&&blocksData) return Promise.resolve();
    if(!loadPromise){
      loadPromise=Promise.all([
        censusData?Promise.resolve(censusData):fetch(DATA_URL).then(r=>{if(!r.ok)throw new Error('No se pudo cargar la relación INE');return r.json();}),
        communitiesData?Promise.resolve(communitiesData):fetch(COMMUNITIES_URL).then(r=>{if(!r.ok)throw new Error('No se pudieron cargar las comunidades');return r.json();}),
        blocksData?Promise.resolve(blocksData):fetch(BLOCKS_URL).then(r=>{if(!r.ok)throw new Error('No se pudieron cargar las manzanas');return r.json();})
      ]).then(([data,communities,blocks])=>{
        censusData=data; communitiesData=communities; blocksData=blocks;
        geoData[COMMUNITIES_ID]=communities; geoData[BLOCKS_ID]=blocks;
      }).catch(error=>{statusMessage=error.message;statusKind='error';console.warn(error);});
    }
    return loadPromise;
  }

  function scopedSummary(){
    const rows=censusData?.summary||[];
    if(selectedAPs.size===0) return rows;
    const selected=new Set([...selectedAPs].map(normalize));
    return rows.filter(row=>selected.has(normalize(row.AP_NOMBRE)));
  }
  function sum(rows,key){return rows.reduce((total,row)=>total+num(row[key]),0);}
  function selectedAPLabel(){
    if(selectedAPs.size===0) return 'Todas las áreas protegidas';
    if(selectedAPs.size===1) return [...selectedAPs][0];
    return `${selectedAPs.size} áreas protegidas`;
  }
  function applyProtectedAreaSelection(){
    if(selectedAPs.size===0){statusMessage='Primero selecciona una o más áreas protegidas con el filtro superior.';statusKind='error';renderM8DataPanel();return;}
    const selected=new Set([...selectedAPs].map(normalize));
    selectedCodes.clear();
    (censusData?.relations||[]).forEach(row=>{
      if(selected.has(normalize(row.AP_NOMBRE))&&num(row.EN_RESUMEN)===1) selectedCodes.add(String(row.COD_INE));
    });
    selectionLabel=`Unidades de ${selectedAPLabel()}`;
    statusMessage=`${selectedCodes.size.toLocaleString('es-BO')} códigos preparados sin doble conteo.`;
    statusKind='success';
    refreshLayerStyles();renderM8DataPanel();
  }

  function representative(feature){
    const geometry=feature?.geometry;
    if(!geometry) return null;
    if(geometry.type==='Point') return [geometry.coordinates[1],geometry.coordinates[0]];
    let rings=[];
    if(geometry.type==='Polygon') rings=[geometry.coordinates[0]];
    if(geometry.type==='MultiPolygon') rings=geometry.coordinates.map(poly=>poly[0]);
    if(!rings.length) return null;
    const ring=rings.sort((a,b)=>b.length-a.length)[0];
    let area=0,cx=0,cy=0;
    for(let i=0;i<ring.length-1;i++){
      const [x1,y1]=ring[i], [x2,y2]=ring[i+1]; const cross=x1*y2-x2*y1;
      area+=cross;cx+=(x1+x2)*cross;cy+=(y1+y2)*cross;
    }
    if(Math.abs(area)>1e-12) return [cy/(3*area),cx/(3*area)];
    const bounds=L.geoJSON(feature).getBounds();const center=bounds.getCenter();return [center.lat,center.lng];
  }
  function inside(point,polygon){
    if(!point||polygon.length<3)return false;
    const [y,x]=point;let hit=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const yi=polygon[i].lat,xi=polygon[i].lng,yj=polygon[j].lat,xj=polygon[j].lng;
      if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))hit=!hit;
    }
    return hit;
  }
  function selectWithin(polygon){
    selectedCodes.clear();
    [...(communitiesData?.features||[]),...(blocksData?.features||[])].forEach(feature=>{
      if(inside(representative(feature),polygon)) selectedCodes.add(codeOf(feature));
    });
    selectionLabel=`Selección espacial (${drawMode==='rectangle'?'rectángulo':'polígono'})`;
    statusMessage=selectedCodes.size?`${selectedCodes.size.toLocaleString('es-BO')} unidades encontradas. Se eliminará cualquier doble conteo al generar el reporte.`:'No se encontraron unidades censales dentro del límite.';
    statusKind=selectedCodes.size?'success':'error';
    refreshLayerStyles();renderM8DataPanel();
  }
  function removeDrawHandlers(){
    map.off('mousedown',rectangleStart);map.off('mousemove',rectangleMove);map.off('mouseup',rectangleEnd);
    map.off('click',polygonAdd);map.off('dblclick',polygonEnd);
    map.dragging.enable();map.doubleClickZoom.enable();document.getElementById('map')?.classList.remove('m8-draw-active');
  }
  function cancelDrawing(removeShape=false){
    removeDrawHandlers();drawMode=null;drawStart=null;polygonPoints=[];
    if(removeShape&&drawLayer){map.removeLayer(drawLayer);drawLayer=null;}
  }
  function beginRectangle(){
    cancelDrawing(true);drawMode='rectangle';map.dragging.disable();document.getElementById('map')?.classList.add('m8-draw-active');
    statusMessage='Arrastra sobre el mapa para dibujar el rectángulo.';statusKind='working';
    map.on('mousedown',rectangleStart);map.on('mousemove',rectangleMove);map.on('mouseup',rectangleEnd);renderM8DataPanel();
  }
  function rectangleStart(event){drawStart=event.latlng;drawLayer=L.rectangle(L.latLngBounds(drawStart,drawStart),{color:'#5b6fb3',weight:2,fillOpacity:.08}).addTo(map);}
  function rectangleMove(event){if(drawStart&&drawLayer)drawLayer.setBounds(L.latLngBounds(drawStart,event.latlng));}
  function rectangleEnd(event){
    if(!drawStart)return;const bounds=L.latLngBounds(drawStart,event.latlng);const polygon=[bounds.getSouthWest(),bounds.getNorthWest(),bounds.getNorthEast(),bounds.getSouthEast()];
    removeDrawHandlers();selectWithin(polygon);drawMode=null;drawStart=null;
  }
  function beginPolygon(){
    cancelDrawing(true);drawMode='polygon';map.doubleClickZoom.disable();document.getElementById('map')?.classList.add('m8-draw-active');
    statusMessage='Haz clic para agregar vértices y doble clic para terminar el polígono.';statusKind='working';
    map.on('click',polygonAdd);map.on('dblclick',polygonEnd);renderM8DataPanel();
  }
  function polygonAdd(event){polygonPoints.push(event.latlng);if(drawLayer)map.removeLayer(drawLayer);drawLayer=L.polygon(polygonPoints,{color:'#5b6fb3',weight:2,fillOpacity:.08}).addTo(map);}
  function polygonEnd(){
    if(polygonPoints.length<3){statusMessage='El polígono necesita al menos tres vértices.';statusKind='error';cancelDrawing(false);renderM8DataPanel();return;}
    const polygon=polygonPoints.slice();removeDrawHandlers();selectWithin(polygon);drawMode=null;polygonPoints=[];
  }
  function clearReportSelection(){
    selectedCodes.clear();selectionLabel='Sin selección para reporte';statusMessage='Selección limpiada.';statusKind='info';cancelDrawing(true);refreshLayerStyles();renderM8DataPanel();
  }
  function refreshLayerStyles(){
    communitiesLayer?.eachLayer(layer=>{if(layer.feature&&layer.setStyle)layer.setStyle(pointStyle(layer.feature));});
    blocksLayer?.eachLayer(layer=>{if(layer.feature&&layer.setStyle)layer.setStyle(blockStyle(layer.feature,.7));});
  }

  function normalizedReportCodes(){
    const codes=new Set(selectedCodes);const selectedBlockGroups=new Set();
    (blocksData?.features||[]).forEach(feature=>{if(codes.has(codeOf(feature)))selectedBlockGroups.add(groupOf(feature));});
    (communitiesData?.features||[]).forEach(feature=>{
      const code=codeOf(feature);if(code.endsWith('-M')&&codes.has(code)&&selectedBlockGroups.has(groupOf(feature)))codes.delete(code);
    });
    return [...codes].filter(code=>/^\d{11}-[DMA]$/.test(code)).sort();
  }
  function workerUrl(path){return `${String(window.INE_REPORT_WORKER_URL||'').replace(/\/$/,'')}${path}`;}
  async function callWorker(path,download){
    const codes=normalizedReportCodes();
    if(!codes.length){statusMessage='No hay códigos seleccionados para generar la ficha.';statusKind='error';renderM8DataPanel();return;}
    if(!window.INE_REPORT_WORKER_URL){statusMessage='Falta configurar la dirección del Worker de Cloudflare en ine_m8_config.js.';statusKind='error';renderM8DataPanel();return;}
    busy=true;statusMessage=download?'Generando la ficha oficial del INE…':'Validando la selección con el INE…';statusKind='working';renderM8DataPanel();
    try{
      const response=await fetch(workerUrl(path),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codigos:codes})});
      if(!response.ok){let message=`Error ${response.status}`;try{const data=await response.json();message=data.message||data.error||message;}catch(_){message=await response.text()||message;}throw new Error(message);}
      if(download){
        const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`Ficha_INE_${new Date().toISOString().slice(0,10)}.pdf`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
        const people=response.headers.get('X-INE-Personas');const houses=response.headers.get('X-INE-Viviendas');
        statusMessage=`Ficha descargada${people?` · ${Number(people).toLocaleString('es-BO')} personas`:''}${houses?` · ${Number(houses).toLocaleString('es-BO')} viviendas`:''}.`;statusKind='success';
      }else{
        const data=await response.json();statusMessage=`Selección válida: ${num(data.cantidad_personas).toLocaleString('es-BO')} personas y ${num(data.cantidad_viviendas).toLocaleString('es-BO')} viviendas.`;statusKind='success';
      }
    }catch(error){statusMessage=error.message||'No se pudo conectar con el servicio de reportes.';statusKind='error';}
    finally{busy=false;renderM8DataPanel();}
  }

  function recentSelectedRows(){
    const codes=new Set(normalizedReportCodes());const rows=[];
    [...(communitiesData?.features||[]),...(blocksData?.features||[])].forEach(feature=>{if(codes.has(codeOf(feature)))rows.push(feature.properties||{});});
    return rows.slice(0,20);
  }
  function renderLoading(){
    grid.innerHTML='<div class="kpi" style="grid-column:1/-1"><div class="lbl">Datos INE</div><div class="trend">Cargando comunidades, manzanas y relaciones…</div></div>';
    donutCard.innerHTML='<h4>Generación de ficha oficial</h4><div class="m8-status working">Preparando datos censales…</div>';breakdownCard.style.display='none';
  }
  function renderM8DataPanel(){
    if(currentModule!==MODULE_ID||!grid||!donutCard||!breakdownCard)return;
    if(!censusData||!communitiesData||!blocksData){renderLoading();ensureData().then(()=>{if(currentModule===MODULE_ID)renderM8DataPanel();});return;}
    const rows=scopedSummary();const reportCodes=normalizedReportCodes();const rural=sum(rows,'COM_RURALES');const urban=sum(rows,'CENTROS_URB');const blocks=sum(rows,'MANZANAS');
    grid.classList.remove('m3-three-kpis');grid.innerHTML=`
      <div class="kpi"><div class="lbl">Personas</div><div class="val">${compact(sum(rows,'PERSONAS'))}</div><div class="trend">${selectedAPLabel()}</div></div>
      <div class="kpi"><div class="lbl">Viviendas</div><div class="val">${compact(sum(rows,'VIVIENDAS'))}</div><div class="trend">Datos validados por INE</div></div>
      <div class="kpi"><div class="lbl">Comunidades</div><div class="val">${compact(rural+urban)}</div><div class="trend">${compact(rural)} rurales · ${compact(urban)} centros urbanos</div></div>
      <div class="kpi"><div class="lbl">Manzanas</div><div class="val">${compact(blocks)}</div><div class="trend">Centroide dentro del AP</div></div>`;
    donutCard.innerHTML=`<h4>Generar ficha oficial INE <span class="mono" style="color:var(--text-dim);font-size:10px">Censo 2024</span></h4>
      <div class="m8-scope"><strong>${escapeHTML(selectionLabel)}</strong><br>${reportCodes.length.toLocaleString('es-BO')} códigos listos para enviar.</div>
      <div class="m8-toolbar">
        <button class="m8-btn secondary" id="m8UseAP" type="button"${selectedAPs.size===0||busy?' disabled':''}>Usar AP filtradas</button>
        <button class="m8-btn" id="m8Clear" type="button"${busy?' disabled':''}>Limpiar selección</button>
        <button class="m8-btn" id="m8Rectangle" type="button"${busy?' disabled':''}>Dibujar rectángulo</button>
        <button class="m8-btn" id="m8Polygon" type="button"${busy?' disabled':''}>Dibujar polígono</button>
        <button class="m8-btn" id="m8Validate" type="button"${!reportCodes.length||busy?' disabled':''}>Verificar con INE</button>
        <button class="m8-btn primary" id="m8Report" type="button"${!reportCodes.length||busy?' disabled':''}>${busy?'Procesando…':'Generar y descargar PDF'}</button>
      </div>
      <div class="m8-draw-help">También puedes activar las capas y hacer clic en comunidades o manzanas individuales. Para un área protegida completa, utiliza el filtro superior y luego “Usar AP filtradas”.</div>
      <div class="m8-status ${statusKind}">${escapeHTML(statusMessage)}</div>
      <div class="m8-source-note">La ficha se genera en tiempo real mediante el servicio oficial del INE. La selección se ajusta para no sumar simultáneamente un centro urbano y sus manzanas.</div>`;
    const selectedRows=recentSelectedRows();breakdownCard.style.display='';breakdownCard.innerHTML=`<h4>Unidades seleccionadas <span class="mono" style="color:var(--text-dim);font-size:10px">${reportCodes.length.toLocaleString('es-BO')}</span></h4>
      <div class="m8-unit-list">${selectedRows.length?selectedRows.map(row=>`<div class="m8-unit-row"><i style="background:${row.TIPO_UNIDAD==='MANZANA'?'#e08a24':row.TIPO_UNIDAD==='CENTRO_URBANO'?'#8c5bc0':'#5b6fb3'}"></i><span>${escapeHTML(row.NOMBRE||'Unidad')}<br><small>${escapeHTML(row.MUNICIPIO||'')} · ${escapeHTML(row.COD_INE||'')}</small></span><small>${escapeHTML((row.TIPO_UNIDAD||'').replaceAll('_',' '))}</small></div>`).join(''):'<div class="m8-status">Aún no hay unidades seleccionadas para el reporte.</div>'}</div>${reportCodes.length>20?`<div class="m8-source-note">Se muestran las primeras 20 de ${reportCodes.length.toLocaleString('es-BO')} unidades.</div>`:''}`;
    document.getElementById('m8UseAP')?.addEventListener('click',applyProtectedAreaSelection);document.getElementById('m8Clear')?.addEventListener('click',clearReportSelection);document.getElementById('m8Rectangle')?.addEventListener('click',beginRectangle);document.getElementById('m8Polygon')?.addEventListener('click',beginPolygon);document.getElementById('m8Validate')?.addEventListener('click',()=>callWorker('/validate',false));document.getElementById('m8Report')?.addEventListener('click',()=>callWorker('/report',true));
    const title=document.getElementById('rightTitle');const sub=document.getElementById('rightSub');if(title)title.textContent=selectedAPs.size?selectedAPLabel():'Datos INE';if(sub)sub.textContent='Comunidades, manzanas y fichas oficiales · Censo 2024';
  }
  function restoreDefault(){
    cancelDrawing(true);if(grid)grid.innerHTML=defaultGridHTML;if(donutCard)donutCard.innerHTML=defaultDonutHTML;if(breakdownCard){breakdownCard.style.display='';breakdownCard.innerHTML=defaultBreakdownHTML;}
  }
  window.renderM8DataPanel=renderM8DataPanel;
  renderModule=function(modId){if(modId!==MODULE_ID)restoreDefault();previousRenderModule(modId);if(modId===MODULE_ID)renderM8DataPanel();};
})();
