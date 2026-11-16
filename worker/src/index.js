import { Client } from 'pg';

const ZMG_BOUNDS = {
  minLat: 20.40,
  maxLat: 20.85,
  minLng: -103.60,
  maxLng: -103.15,
};

const MIN_DATE = '2018-01-01';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

function isWithinZmgBounds(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= ZMG_BOUNDS.minLat &&
    lat <= ZMG_BOUNDS.maxLat &&
    lng >= ZMG_BOUNDS.minLng &&
    lng <= ZMG_BOUNDS.maxLng
  );
}

function isValidIncidentDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateStr) {
    return false;
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  return dateStr >= MIN_DATE && dateStr <= todayStr;
}

function cleanText(value, maxLen) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

async function getDbClient(env) {
  const connectionString = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Hyperdrive o DATABASE_URL no configurado.');
  }
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function verifyTurnstile(token, secret, remoteIp) {
  if (!secret) return { ok: true };
  if (!token) {
    return { ok: false, error: 'Falta completar la verificación anti-spam (Turnstile).' };
  }

  const formData = new URLSearchParams();
  formData.append('secret', secret);
  formData.append('response', token);
  if (remoteIp) formData.append('remoteip', remoteIp);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    return { ok: false, error: 'No se pudo validar Turnstile en este momento.' };
  }

  const outcome = await res.json();
  if (!outcome.success) {
    return { ok: false, error: 'Verificación Turnstile inválida o expirada.' };
  }
  return { ok: true };
}

async function handleHealth(env) {
  const payload = {
    status: 'ok',
    service: 'socavones-zmg-api',
    environment: env.ENVIRONMENT || 'production',
    timestamp: new Date().toISOString(),
  };

  if (env.HYPERDRIVE?.connectionString || env.DATABASE_URL) {
    let client;
    try {
      client = await getDbClient(env);
      await client.query('SELECT 1');
      payload.database = 'connected';
    } catch (err) {
      payload.database = 'error';
      payload.database_error = err.message;
      return jsonResponse(payload, 503);
    } finally {
      if (client) await client.end().catch(() => {});
    }
  } else {
    payload.database = 'unconfigured';
  }

  return jsonResponse(payload);
}

async function handleListSocavones(url, env) {
  const conditions = [];
  const params = [];

  const municipio = url.searchParams.get('municipio');
  const causa = url.searchParams.get('causa_aparente');
  const estado = url.searchParams.get('estado');
  const desde = url.searchParams.get('desde');
  const hasta = url.searchParams.get('hasta');

  if (municipio) {
    params.push(municipio);
    conditions.push(`municipio = $${params.length}`);
  }
  if (causa) {
    params.push(causa);
    conditions.push(`causa_aparente = $${params.length}`);
  }
  if (estado) {
    params.push(estado);
    conditions.push(`estado = $${params.length}`);
  }
  if (desde) {
    params.push(desde);
    conditions.push(`fecha_incidente >= $${params.length}::date`);
  }
  if (hasta) {
    params.push(hasta);
    conditions.push(`fecha_incidente <= $${params.length}::date`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT id, fecha_incidente, municipio, colonia, calle_principal, cruces,
           latitud, longitud, causa_aparente, tamano_categoria, estado, fuente,
           reportes_sumados, verificado, creado_en
    FROM socavones
    ${whereClause}
    ORDER BY fecha_incidente DESC, id DESC
    LIMIT 1000
  `;

  let client;
  try {
    client = await getDbClient(env);
    const { rows } = await client.query(sql, params);
    return jsonResponse({ total: rows.length, socavones: rows });
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

async function handleCreateSocavon(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Cuerpo JSON inválido.' }, 400);
  }

  const turnstileToken = body.turnstile_token || body['cf-turnstile-response'];
  const turnstileResult = await verifyTurnstile(
    turnstileToken,
    env.TURNSTILE_SECRET,
    request.headers.get('CF-Connecting-IP'),
  );
  if (!turnstileResult.ok) {
    return jsonResponse({ error: turnstileResult.error }, 403);
  }

  const latitud = Number(body.latitud);
  const longitud = Number(body.longitud);
  if (!isWithinZmgBounds(latitud, longitud)) {
    return jsonResponse(
      {
        error:
          'Coordenadas fuera de la Zona Metropolitana de Guadalajara (latitud 20.40 a 20.85, longitud -103.60 a -103.15).',
      },
      400,
    );
  }

  const fechaIncidente = body.fecha_incidente;
  if (!isValidIncidentDate(fechaIncidente)) {
    return jsonResponse(
      { error: 'La fecha del incidente debe estar entre 2018-01-01 y la fecha actual.' },
      400,
    );
  }

  const municipio = cleanText(body.municipio, 80);
  const causaAparente = cleanText(body.causa_aparente, 60);
  if (!municipio || !causaAparente) {
    return jsonResponse(
      { error: 'Los campos municipio y causa_aparente son obligatorios.' },
      400,
    );
  }

  const colonia = cleanText(body.colonia, 120);
  const callePrincipal = cleanText(body.calle_principal, 150);
  const cruces = cleanText(body.cruces, 150);
  const tamanoCategoria = cleanText(body.tamano_categoria, 30);
  const forzarRegistro = Boolean(body.forzar_registro);

  let client;
  try {
    client = await getDbClient(env);

    if (!forzarRegistro) {
      const dupQuery = `
        SELECT id, fecha_incidente, municipio, colonia, calle_principal, cruces,
               latitud, longitud, causa_aparente, tamano_categoria, estado,
               reportes_sumados,
               ROUND(ST_Distance(ubicacion, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)) AS distancia_m
        FROM socavones
        WHERE ST_DWithin(ubicacion, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 50)
          AND ABS(fecha_incidente - $3::date) <= 30
        ORDER BY distancia_m ASC, fecha_incidente DESC
        LIMIT 1
      `;
      const dupResult = await client.query(dupQuery, [longitud, latitud, fechaIncidente]);
      if (dupResult.rows.length > 0) {
        return jsonResponse({ duplicado: dupResult.rows[0] }, 409);
      }
    }

    const insertSql = `
      INSERT INTO socavones (
        fecha_incidente, municipio, colonia, calle_principal, cruces,
        latitud, longitud, causa_aparente, tamano_categoria, estado, fuente
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Reportado / Activo', 'Reporte ciudadano')
      RETURNING id, fecha_incidente, municipio, colonia, calle_principal, cruces,
                latitud, longitud, causa_aparente, tamano_categoria, estado, fuente,
                reportes_sumados, verificado, creado_en
    `;
    const insertResult = await client.query(insertSql, [
      fechaIncidente,
      municipio,
      colonia,
      callePrincipal,
      cruces,
      latitud,
      longitud,
      causaAparente,
      tamanoCategoria,
    ]);

    return jsonResponse({ socavon: insertResult.rows[0] }, 201);
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

async function handleSumarSocavon(idParam, env) {
  const id = Number.parseInt(idParam, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonResponse({ error: 'ID de socavón inválido.' }, 400);
  }

  let client;
  try {
    client = await getDbClient(env);
    const { rows } = await client.query(
      `
      UPDATE socavones
      SET reportes_sumados = reportes_sumados + 1
      WHERE id = $1
      RETURNING id, fecha_incidente, municipio, colonia, calle_principal, cruces,
                latitud, longitud, causa_aparente, tamano_categoria, estado, fuente,
                reportes_sumados, verificado, creado_en
      `,
      [id],
    );

    if (rows.length === 0) {
      return jsonResponse({ error: 'Registro de socavón no encontrado.' }, 404);
    }
    return jsonResponse({ socavon: rows[0] });
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

async function handleAdminSeed(request, env) {
  if (!env.ADMIN_SEED_TOKEN) {
    return jsonResponse({ error: 'ADMIN_SEED_TOKEN no configurado en el servidor.' }, 503);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const expected = `Bearer ${env.ADMIN_SEED_TOKEN}`;
  if (authHeader !== expected) {
    return jsonResponse({ error: 'No autorizado.' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Cuerpo JSON inválido.' }, 400);
  }

  const registros = Array.isArray(body) ? body : body?.registros;
  if (!Array.isArray(registros) || registros.length === 0) {
    return jsonResponse(
      { error: 'Se esperaba un arreglo no vacío de registros históricos.' },
      400,
    );
  }

  let client;
  try {
    client = await getDbClient(env);
    await client.query('BEGIN');

    const insertSql = `
      INSERT INTO socavones (
        fecha_incidente, municipio, colonia, calle_principal, cruces,
        latitud, longitud, causa_aparente, tamano_categoria, estado, fuente,
        reportes_sumados, verificado
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE)
    `;

    let insertados = 0;
    for (const reg of registros) {
      const lat = Number(reg.latitud);
      const lng = Number(reg.longitud);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error(`Registro ${insertados + 1} tiene coordenadas inválidas.`);
      }

      await client.query(insertSql, [
        reg.fecha_incidente,
        cleanText(reg.municipio, 80) || 'Otro',
        cleanText(reg.colonia, 120),
        cleanText(reg.calle_principal, 150),
        cleanText(reg.cruces, 150),
        lat,
        lng,
        cleanText(reg.causa_aparente, 60) || 'Obra / Desconocida',
        cleanText(reg.tamano_categoria, 30),
        cleanText(reg.estado, 30) || 'Reportado / Activo',
        cleanText(reg.fuente, 50) || 'Registro histórico',
        Number.isInteger(reg.reportes_sumados) && reg.reportes_sumados > 0
          ? reg.reportes_sumados
          : 1,
      ]);
      insertados += 1;
    }

    await client.query('COMMIT');
    return jsonResponse({ ok: true, insertados }, 201);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return jsonResponse({ error: `Error al importar registros: ${err.message}` }, 400);
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        return await handleHealth(env);
      }

      if (request.method === 'GET' && pathname === '/api/config') {
        return jsonResponse({
          turnstileSitekey: env.TURNSTILE_SITEKEY || null,
        });
      }

      if (request.method === 'GET' && pathname === '/api/socavones') {
        return await handleListSocavones(url, env);
      }

      if (request.method === 'POST' && pathname === '/api/socavones') {
        return await handleCreateSocavon(request, env);
      }

      const sumarMatch = pathname.match(/^\/api\/socavones\/(\d+)\/sumar$/);
      if (request.method === 'POST' && sumarMatch) {
        return await handleSumarSocavon(sumarMatch[1], env);
      }

      if (request.method === 'POST' && pathname === '/api/admin/seed') {
        return await handleAdminSeed(request, env);
      }

      if (pathname.startsWith('/api/')) {
        return jsonResponse({ error: 'Ruta API no encontrada.' }, 404);
      }

      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Error interno del servidor.' }, 500);
    }
  },
};

