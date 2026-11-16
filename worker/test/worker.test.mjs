import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('GET /api/health returns service status', async () => {
  const req = new Request('https://example.com/api/health');
  const res = await worker.fetch(req, { ENVIRONMENT: 'test' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'socavones-zmg-api');
  assert.equal(body.database, 'unconfigured');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});

test('OPTIONS preflight returns 204 with CORS headers', async () => {
  const req = new Request('https://example.com/api/socavones', { method: 'OPTIONS' });
  const res = await worker.fetch(req, {});
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
});

test('POST /api/socavones rejects coordinates outside ZMG bounding box', async () => {
  const req = new Request('https://example.com/api/socavones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fecha_incidente: '2025-06-15',
      municipio: 'Guadalajara',
      causa_aparente: 'Lluvia / Inundación',
      latitud: 19.4326,
      longitud: -99.1332,
    }),
  });
  const res = await worker.fetch(req, {});
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Zona Metropolitana de Guadalajara/);
});

test('POST /api/socavones rejects invalid date before 2018-01-01', async () => {
  const req = new Request('https://example.com/api/socavones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fecha_incidente: '2017-12-31',
      municipio: 'Guadalajara',
      causa_aparente: 'Lluvia / Inundación',
      latitud: 20.67,
      longitud: -103.35,
    }),
  });
  const res = await worker.fetch(req, {});
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /2018-01-01/);
});

test('POST /api/admin/seed requires valid Bearer token', async () => {
  const req = new Request('https://example.com/api/admin/seed', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer wrong-token',
    },
    body: JSON.stringify([]),
  });
  const res = await worker.fetch(req, { ADMIN_SEED_TOKEN: 'secret-seed-token' });
  assert.equal(res.status, 401);
});

