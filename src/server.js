const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { PeyEngine } = require('./engine/peyEngine');
const { validateClabe, computeClabeCheckDigit, BANK_CODES } = require('./config/clabes');

// Carga ligera de variables de entorno desde .env si existe
function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch (_err) {
    // Continuar con process.env actual
  }
}

loadDotEnv();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function readRawBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('Payload demasiado grande.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function createAppServer(engineInstance) {
  const engine = engineInstance || new PeyEngine();
  const sseClients = new Set();

  const timerInterval = setInterval(() => {
    engine.tickTimers();
  }, 1000);
  timerInterval.unref();

  engine.on('state_change', (message) => {
    const frame = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(frame);
      } catch (_err) {
        sseClients.delete(client);
      }
    }
  });

  const publicDir = path.join(__dirname, '..', 'public');

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;

      // 1. SSE Real-Time Stream
      if (req.method === 'GET' && pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(`data: ${JSON.stringify({ event: 'connected', snapshot: engine.getSnapshot() })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      // 2. Estado Completo
      if (req.method === 'GET' && pathname === '/api/state') {
        sendJson(res, 200, engine.getSnapshot());
        return;
      }

      // 3. Crear Orden CoDi (/codi/qr o /codi/pn)
      if (req.method === 'POST' && pathname === '/api/orders') {
        const raw = await readRawBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const order = await engine.createOrder({
          station: body.station || 'pos',
          method: body.method || 'QR',
          phone: body.phone || '',
          amount: body.amount ?? 0.01,
          concept: body.concept || 'Cobro CoDi PeyOS',
          clabeId: body.clabeId || 'acc_miriam_bbva',
          ttlSeconds: body.ttlSeconds || 180,
          metadata: body.metadata || {},
        });
        sendJson(res, 201, { ok: true, order });
        return;
      }

      // 4. Endpoint Oficial de Webhooks de Pey (Standard Webhooks HMAC-SHA256)
      if (
        req.method === 'POST' &&
        (pathname === '/api/webhooks/pey' || pathname === '/codi/pn' || pathname === '/webhooks/codi')
      ) {
        const rawBody = await readRawBody(req);
        const result = engine.processWebhook(rawBody, req.headers);
        sendJson(res, result.httpStatus, result);
        return;
      }

      // 5. Verificar PIN OTP de Entrega / Desbloqueo de Casillero / Redención
      const otpMatch = pathname.match(/^\/api\/orders\/([^/]+)\/verify-otp$/);
      if (req.method === 'POST' && otpMatch) {
        const orderId = decodeURIComponent(otpMatch[1]);
        const raw = await readRawBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const order = engine.verifyDeliveryOtp({
          orderId,
          otpCode: body.otpCode,
        });
        sendJson(res, 200, { ok: true, order });
        return;
      }

      // 6. Despacho / Confirmación de Webhook Firmado (Compatible con /api/chaos/simulate y /api/webhooks/dispatch)
      if (
        req.method === 'POST' &&
        (pathname === '/api/chaos/simulate' || pathname === '/api/webhooks/dispatch')
      ) {
        const raw = await readRawBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const { orderId, scenario = 'SUCCESS' } = body;

        if (scenario === 'INVALID_SIGNATURE') {
          const forgedBody = JSON.stringify({
            type: 'codi.qr.payment_received',
            amount: 0.01,
            numRef: '99999',
            transactionId: '01FORGEDTXN',
          });
          const result = engine.processWebhook(forgedBody, {
            'webhook-id': `msg_forged_${Date.now()}`,
            'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
            'webhook-signature': 'v1,FIRMA_FALSA_ATAQUE_MITM_999999999=',
          });
          sendJson(res, 200, { ok: true, chaosResult: result });
          return;
        }

        const result = engine.simulateSignedWebhookForOrder(orderId, scenario);
        sendJson(res, 200, { ok: true, chaosResult: result });
        return;
      }

      // 7. Validador de CLABE Banxico en tiempo real
      if (req.method === 'POST' && pathname === '/api/clabes/validate') {
        const raw = await readRawBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const clabeStr = String(body.clabe || '').replace(/\D/g, '');
        const prefix = clabeStr.slice(0, 3);
        const bankInfo = BANK_CODES[prefix] || null;
        if (clabeStr.length === 17) {
          const suggestedDigit = computeClabeCheckDigit(clabeStr);
          sendJson(res, 200, {
            ok: true,
            valid: false,
            suggestedDigit,
            bankName: bankInfo?.name || null,
            reason: `Falta el dígito verificador (sugerido: ${suggestedDigit}).`,
          });
          return;
        }
        const validation = validateClabe(clabeStr);
        sendJson(res, 200, { ok: true, ...validation });
        return;
      }

      // 8. Alta de Cuenta CLABE Propia
      if (req.method === 'POST' && pathname === '/api/clabes') {
        const raw = await readRawBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const clabeEntry = await engine.registerNewClabe({
          holderName: body.holderName,
          clabe: body.clabe,
          role: body.role,
        });
        sendJson(res, 201, { ok: true, clabe: clabeEntry });
        return;
      }

      // 9. Configurar API Key / Webhook Secret de portal.mipey.mx en caliente
      if (req.method === 'POST' && pathname === '/api/config/pey') {
        const raw = await readRawBody(req);
        const body = raw ? JSON.parse(raw) : {};
        engine.peyClient.setRuntimeCredentials({
          apiKey: body.apiKey,
          webhookSecret: body.webhookSecret,
          defaultBankAccountId: body.defaultBankAccountId,
        });
        engine._broadcastState('config.updated', engine.peyClient.getPublicStatus());
        sendJson(res, 200, { ok: true, peyStatus: engine.peyClient.getPublicStatus() });
        return;
      }

      // 10. Crear o Reiniciar Vaquita Split-Pay
      if (
        req.method === 'POST' &&
        (pathname === '/api/split/reset' || pathname === '/api/split/create')
      ) {
        const raw = await readRawBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const splitSession = engine.resetSplitSession(body);
        sendJson(res, 200, { ok: true, splitSession });
        return;
      }

      // 11. Actualizar Secuenciador de PeyStudio
      if (req.method === 'POST' && pathname === '/api/studio/sequencer') {
        const raw = await readRawBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const studio = engine.updateStudioSequencer(body);
        sendJson(res, 200, { ok: true, liveStudio: studio });
        return;
      }

      // 12. Liberar / Cerrar Locker manualmente
      const releaseMatch = pathname.match(/^\/api\/lockers\/([^/]+)\/release$/);
      if (req.method === 'POST' && releaseMatch) {
        const lockerId = decodeURIComponent(releaseMatch[1]);
        const locker = engine.releaseLocker(lockerId);
        sendJson(res, 200, { ok: true, locker });
        return;
      }

      // 13. Archivos Estáticos del Frontend
      let safePath = pathname === '/' ? '/index.html' : pathname;
      safePath = path.normalize(safePath).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(publicDir, safePath);

      if (filePath.startsWith(publicDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff',
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Ruta no encontrada.' });
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : 'Error procesando la solicitud.',
      });
    }
  });

  return { server, engine };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const persistPath = path.join(__dirname, '..', 'data', 'peyos-state.json');
  const engine = new PeyEngine({ persistPath });
  const { server } = createAppServer(engine);
  server.listen(port, host, () => {
    console.log(`PeyOS corriendo en http://${host}:${port}`);
  });
}

module.exports = { createAppServer };
