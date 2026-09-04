import fs from 'node:fs';
import path from 'node:path';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.filter(values => values.some(Boolean)).map(values =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  );
}

const [summaryPath, sectorsPath, outputPath] = process.argv.slice(2);
if (!summaryPath || !sectorsPath || !outputPath) {
  throw new Error('Uso: node build_m9_panel_data.mjs resumen.csv sectores.csv salida.js');
}

const numericSummary = new Set([
  'aop_total', 'viviendas_num', 'viviendas_area_ha', 'caminos_principales_km',
  'caminos_secundarios_terciarios_km', 'lineas_mt_km', 'lineas_at_km',
  'plantas_num', 'represas_num',
]);
const summary = parseCsv(fs.readFileSync(summaryPath, 'utf8')).map(row =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key, numericSummary.has(key) ? Number(value || 0) : value]))
);
const sectors = parseCsv(fs.readFileSync(sectorsPath, 'utf8')).map(row =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key === 'area_protegida' ? value : Number(value || 0)]))
);

const payload = { generated: '2026-09-04', summary, sectors };
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `window.M9_AOP_DATA=${JSON.stringify(payload)};\n`);
