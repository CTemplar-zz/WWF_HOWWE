const DEFAULT_INE_API = 'https://wgeoportal.ine.gob.bo/api/v1';
const DEFAULT_ORIGINS = [
  'https://ctemplar-zz.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
];
const CODE_PATTERN = /^\d{11}-[DMA]$/;

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(','))
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = allowedOrigins(env);
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'Content-Disposition, X-INE-Personas, X-INE-Viviendas, X-INE-Codigos',
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  };
}

function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request, env),
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

async function parseCodes(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    throw new RequestError(400, 'El cuerpo debe ser JSON válido.');
  }
  if (!Array.isArray(payload.codigos)) {
    throw new RequestError(400, 'Se requiere una lista llamada "codigos".');
  }
  const codes = [...new Set(payload.codigos.map(String).map(value => value.trim()).filter(Boolean))];
  const invalid = codes.filter(code => !CODE_PATTERN.test(code));
  if (invalid.length) {
    throw new RequestError(400, `Hay ${invalid.length} códigos con formato inválido.`);
  }
  const maxCodes = Math.max(1, Number(env.MAX_CODES || 5000));
  if (!codes.length) throw new RequestError(400, 'La selección no contiene códigos INE.');
  if (codes.length > maxCodes) {
    throw new RequestError(413, `La selección supera el máximo permitido de ${maxCodes} códigos.`);
  }
  return codes;
}

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function ineFetch(base, path, token, payload) {
  const headers = {
    'Content-Type': 'application/json',
    'Origin': 'https://geoportal.ine.gob.bo',
    'Referer': 'https://geoportal.ine.gob.bo/',
    'User-Agent': 'WWF-HOWWE-Geoportal/1.0'
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['X-Session-Token'] = token;
  }
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload || {})
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`El servicio del INE respondió ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return response;
}

async function openIneSession(base) {
  const response = await ineFetch(base, '/geoportal/registroSesion', '', {});
  const data = await response.json();
  if (!data.session_token) throw new Error('El INE no devolvió un token de sesión.');
  return data.session_token;
}

async function closeIneSession(base, token) {
  if (!token) return;
  try {
    await ineFetch(base, '/geoportal/salidaSesion', token, {});
  } catch (_) {
    // El cierre es de mejor esfuerzo y no debe invalidar un PDF ya generado.
  }
}

async function handleApi(request, env, path) {
  const codes = await parseCodes(request, env);
  const base = String(env.INE_API_BASE || DEFAULT_INE_API).replace(/\/$/, '');
  let token = '';
  try {
    token = await openIneSession(base);
    const validationResponse = await ineFetch(base, '/ficha-tecnica/verificar-validar', token, { codigos: codes });
    const validation = await validationResponse.json();
    if (path === '/validate') {
      return jsonResponse(request, env, validation);
    }
    if (!validation.validado) {
      return jsonResponse(request, env, {
        error: 'SELECCION_NO_VALIDA',
        message: validation.mensaje || 'El INE no validó la selección.',
        ...validation
      }, 422);
    }
    const pdfResponse = await ineFetch(base, '/generar-pdf', token, { codigos: codes });
    const pdf = await pdfResponse.arrayBuffer();
    const signature = new Uint8Array(pdf.slice(0, 4));
    if (String.fromCharCode(...signature) !== '%PDF') {
      throw new Error('El servicio del INE no devolvió un archivo PDF.');
    }
    return new Response(pdf, {
      status: 200,
      headers: {
        ...corsHeaders(request, env),
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Ficha_INE_Censo_2024.pdf"',
        'X-INE-Personas': String(validation.cantidad_personas || 0),
        'X-INE-Viviendas': String(validation.cantidad_viviendas || 0),
        'X-INE-Codigos': String(codes.length)
      }
    });
  } finally {
    await closeIneSession(base, token);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse(request, env, { ok: true, service: 'geoportal-ine-report' });
    }
    if (request.method !== 'POST' || !['/validate', '/report'].includes(url.pathname)) {
      return jsonResponse(request, env, { error: 'NOT_FOUND', message: 'Ruta no disponible.' }, 404);
    }
    const origin = request.headers.get('Origin') || '';
    if (!allowedOrigins(env).includes(origin)) {
      return jsonResponse(request, env, { error: 'ORIGIN_NOT_ALLOWED', message: 'Origen no autorizado.' }, 403);
    }
    try {
      return await handleApi(request, env, url.pathname);
    } catch (error) {
      const status = error instanceof RequestError ? error.status : 502;
      return jsonResponse(request, env, {
        error: status === 502 ? 'INE_UPSTREAM_ERROR' : 'INVALID_REQUEST',
        message: error.message || 'No se pudo completar la solicitud.'
      }, status);
    }
  }
};
