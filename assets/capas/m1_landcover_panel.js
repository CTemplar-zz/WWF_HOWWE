(function(){
  const dataset=window.LANDCOVER_M1||{year:2024,rows:[]};
  const rows=Array.isArray(dataset.rows)?dataset.rows:[];
  const grid=document.querySelector('.kpi-grid');
  const donutCard=document.querySelector('.donut-card');
  const breakdownCard=document.getElementById('breakdownCard');
  const defaultGridHTML=grid?grid.innerHTML:'';
  const defaultDonutHTML=donutCard?donutCard.innerHTML:'';
  const defaultBreakdownHTML=breakdownCard?breakdownCard.innerHTML:'';
  const previousRenderModule=renderModule;

  const normalizeAP=value=>String(value||'')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/\btipnis\b/g,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();

  function selectedAPKeys(){
    return new Set([...selectedAPs].map(normalizeAP));
  }

  function scopedRows(){
    if(selectedAPs.size===0) return rows;
    const selected=selectedAPKeys();
    return rows.filter(row=>selected.has(normalizeAP(row.name)));
  }

  function aggregateClasses(sourceRows){
    const byCode=new Map();
    sourceRows.forEach(row=>{
      const code=Number(row.classCode);
      const current=byCode.get(code)||{
        code,
        name:row.className,
        color:row.color,
        areaHa:0
      };
      current.areaHa+=Number(row.areaHa)||0;
      byCode.set(code,current);
    });
    return [...byCode.values()].sort((a,b)=>b.areaHa-a.areaHa||a.code-b.code);
  }

  function surfaceHTML(value){
    return `${formatHa(value)}<span class="unit">${haUnitLabel(value)}</span>`;
  }

  function surfaceText(value){
    return `${Number(value||0).toLocaleString('es-BO',{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    })} ha`;
  }

  function scopeLabel(sourceRows){
    if(selectedAPs.size===1) return [...selectedAPs][0];
    if(selectedAPs.size>1) return `${selectedAPs.size} áreas protegidas seleccionadas`;
    const count=new Set(sourceRows.map(row=>normalizeAP(row.name))).size;
    return `${count} áreas protegidas`;
  }

  function barsHTML(classes){
    const max=Math.max(1,...classes.map(item=>item.areaHa));
    if(!classes.length){
      return '<div class="search-empty">No hay datos de cobertura para la selección actual.</div>';
    }
    return `<div class="m1-landcover-list">${classes.map(item=>{
      const width=Math.max(.8,item.areaHa/max*100);
      const border=item.color.toLowerCase()==='#ffffff'?'border:1px solid var(--border);':'';
      return `<div class="m1-landcover-row">
        <div class="m1-landcover-head">
          <span class="m1-landcover-swatch" style="background:${item.color};${border}"></span>
          <span class="m1-landcover-name">${escapeHTML(item.name)}</span>
          <span class="m1-landcover-code">C${item.code}</span>
          <span class="m1-landcover-value">${surfaceText(item.areaHa)}</span>
        </div>
        <div class="m1-landcover-track" aria-hidden="true">
          <span class="m1-landcover-bar" style="width:${width.toFixed(3)}%;background:${item.color};${border}"></span>
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  function updateContext(sourceRows){
    const title=document.getElementById('rightTitle');
    const sub=document.getElementById('rightSub');
    if(!title||!sub) return;
    title.textContent=selectedAPs.size===1?[...selectedAPs][0]:'Cobertura en áreas protegidas';
    sub.textContent=`MapBiomas ${dataset.year||2024} · ${scopeLabel(sourceRows)}`;
  }

  function renderM1DataPanel(){
    if(currentModule!=='1'||!grid||!donutCard||!breakdownCard) return;
    const sourceRows=scopedRows();
    const classes=aggregateClasses(sourceRows);
    const totalHa=classes.reduce((sum,item)=>sum+item.areaHa,0);
    const apCount=new Set(sourceRows.map(row=>normalizeAP(row.name))).size;
    const dominant=classes[0];
    const clearLink=selectedAPs.size
      ? ' · <a href="#" id="m1ClearAPFilter" style="color:var(--accent)">limpiar filtro</a>'
      : '';

    grid.classList.remove('m3-three-kpis');
    grid.innerHTML=`
      <div class="kpi">
        <div class="lbl">Superficie tabulada</div>
        <div class="val">${surfaceHTML(totalHa)}</div>
        <div class="trend">${scopeLabel(sourceRows)}${clearLink}</div>
      </div>
      <div class="kpi">
        <div class="lbl">Clases presentes</div>
        <div class="val">${classes.length}<span class="unit">clases</span></div>
        <div class="trend">Coberturas con superficie</div>
      </div>
      <div class="kpi">
        <div class="lbl">Áreas protegidas</div>
        <div class="val">${apCount}<span class="unit">AP</span></div>
        <div class="trend">Incluidas en el filtro</div>
      </div>
      <div class="kpi">
        <div class="lbl">Cobertura dominante</div>
        <div class="val m1-dominant">${dominant?escapeHTML(dominant.name):'Sin datos'}</div>
        <div class="trend">${dominant?surfaceText(dominant.areaHa):'0 ha'}</div>
      </div>
    `;

    donutCard.innerHTML=`
      <h4>Superficie por tipo de cobertura
        <span class="mono" style="color:var(--text-dim);font-size:10px">hectáreas</span>
      </h4>
      ${barsHTML(classes)}
      <div class="m1-panel-note">Las barras están ordenadas por superficie y usan los mismos colores de la leyenda MapBiomas del mapa.</div>
    `;
    breakdownCard.style.display='none';
    document.getElementById('m1ClearAPFilter')?.addEventListener('click',event=>{
      event.preventDefault();
      document.getElementById('apFilterClear')?.click();
    });
    updateContext(sourceRows);
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

  window.renderM1DataPanel=renderM1DataPanel;
  renderModule=function(modId){
    if(modId!=='1') restoreDefaultCards();
    previousRenderModule(modId);
    if(modId==='1') renderM1DataPanel();
  };
})();
