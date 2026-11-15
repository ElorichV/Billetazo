const test = require('node:test');
const assert = require('node:assert/strict');
const { PREAUTHORIZED_CLABES, validateClabe, computeClabeCheckDigit } = require('../src/config/clabes');
const { PeyEngine } = require('../src/engine/peyEngine');
const { signStandardWebhook } = require('../src/services/peyClient');
const { createAppServer } = require('../src/server');

test('1. Valida las 5 CLABEs pre-autorizadas con algoritmo dígito verificador Banxico (3-7-1)', () => {
  assert.equal(PREAUTHORIZED_CLABES.length, 5);
  for (const entry of PREAUTHORIZED_CLABES) {
    const check = validateClabe(entry.clabe);
    assert.equal(check.valid, true, `La CLABE de ${entry.holderName} (${entry.clabe}) debe ser válida`);
    assert.equal(computeClabeCheckDigit(entry.clabe.slice(0, 17)), Number(entry.clabe[17]));
  }

  // Rechazar CLABE con dígito verificador alterado
  const tampered = validateClabe('012180015826225719');
  assert.equal(tampered.valid, false);
});

test('2. Inicia con estado funcional limpio (sin datos falsos pre-sembrados) y ejecuta orden QR/Push con idempotencia', async () => {
  const engine = new PeyEngine({ webhookSecret: 'whsec_test_secret_123' });

  // Estado inicial limpio sin comidas falsas ni baldosas de demo
  assert.equal(engine.sponsoredMeals.fundedCount, 0);
  assert.equal(engine.sponsoredMeals.deliveredCount, 0);
  assert.equal(engine.liveStudio.muralTiles.length, 0);

  const order = await engine.createOrder({
    station: 'synth',
    method: 'PUSH',
    phone: '5512345678',
    concept: 'BEAT TECHNO',
    clabeId: 'acc_ramon_bbva',
    metadata: { trackKey: 'cyber_arp', muralWord: 'TECHNO' },
  });

  assert.equal(order.status, 'PUSH_SENT');
  assert.equal(order.amount, 0.01);

  // Primer envío de webhook firmado -> Ejecuta una sola vez
  const firstResult = engine.simulateSignedWebhookForOrder(order.orderId, 'SUCCESS');
  assert.equal(firstResult.httpStatus, 200);
  assert.equal(firstResult.status, 'PAID_AND_EXECUTED');
  assert.equal(firstResult.otpCode, undefined);
  assert.match(engine.orders.get(order.orderId).otpCode, /^\d{6}$/);
  assert.equal(engine.liveStudio.activeTracks.cyber_arp.paidCount, 1);
  assert.equal(engine.liveStudio.muralTiles.length, 1);

  // Segundo envío con el mismo webhookId / transactionId -> Bloqueado por idempotencia
  const secondResult = engine.simulateSignedWebhookForOrder(order.orderId, 'DUPLICATE_REPLAY');
  assert.equal(secondResult.httpStatus, 200);
  assert.equal(secondResult.status, 'DUPLICATE_IGNORED');
  assert.equal(secondResult.idempotent, true);
  assert.equal(engine.liveStudio.activeTracks.cyber_arp.paidCount, 1);
  assert.equal(engine.metrics.duplicatesBlocked, 1);
});

test('3. Rechaza webhooks con firma criptográfica adulterada (401 INVALID_SIGNATURE)', () => {
  const engine = new PeyEngine({ webhookSecret: 'whsec_real_secret' });
  const rawBody = JSON.stringify({
    type: 'codi.qr.payment_received',
    amount: 0.01,
    numRef: '10001',
    transactionId: '01TXNFAKE',
  });
  const forgedHeaders = signStandardWebhook(rawBody, 'whsec_wrong_attacker_secret', 'msg_attack_1');
  const res = engine.processWebhook(rawBody, forgedHeaders);

  assert.equal(res.httpStatus, 401);
  assert.equal(res.status, 'INVALID_SIGNATURE');
  assert.equal(engine.metrics.invalidSignaturesBlocked, 1);
});

test('4. Separa Pago de Identidad/Entrega: Smart Locker requiere OTP de un solo uso y permite liberación manual', async () => {
  const engine = new PeyEngine();
  const order = await engine.createOrder({
    station: 'locker',
    method: 'QR',
    concept: 'CASILLERO A1',
    clabeId: 'acc_santiago_bbva',
    metadata: { lockerId: 'LOCKER-A1', durationSeconds: 60 },
  });

  assert.equal(engine.lockers['LOCKER-A1'].status, 'RESERVED_WAITING_PAYMENT');

  const paid = engine.simulateSignedWebhookForOrder(order.orderId, 'SUCCESS');
  assert.equal(paid.status, 'PAID_AND_EXECUTED');
  paid.otpCode = engine.orders.get(order.orderId).otpCode;
  // El pago NO abre el casillero hasta verificar el OTP
  assert.equal(engine.lockers['LOCKER-A1'].status, 'PAID_WAITING_OTP');

  // OTP incorrecto lanza error
  assert.throws(() => {
    engine.verifyDeliveryOtp({ orderId: order.orderId, otpCode: '000000' });
  }, /Código OTP inválido/);

  // OTP correcto desbloquea el casillero e inicia el temporizador
  const delivered = engine.verifyDeliveryOtp({ orderId: order.orderId, otpCode: paid.otpCode });
  assert.equal(delivered.status, 'DELIVERED');
  assert.equal(engine.lockers['LOCKER-A1'].status, 'UNLOCKED_ACTIVE');
  assert.equal(engine.lockers['LOCKER-A1'].remainingSeconds, 60);

  // Reuso del mismo OTP es rechazado (un solo uso)
  assert.throws(() => {
    engine.verifyDeliveryOtp({ orderId: order.orderId, otpCode: paid.otpCode });
  }, /ya fue utilizado/);

  // Liberación manual de la unidad cuando el usuario termina
  const released = engine.releaseLocker('LOCKER-A1', order.claimToken);
  assert.equal(released.status, 'LOCKED_IDLE');
  assert.equal(released.remainingSeconds, 0);
});

test('5. Maneja Pagos Tardíos emitiendo Voucher Criptográfico y Failover Bancario Multi-CLABE', async () => {
  const engine = new PeyEngine();
  const order = await engine.createOrder({
    station: 'pos',
    method: 'QR',
    concept: 'CITA TARDIA',
    clabeId: 'acc_ramon_bbva',
  });

  // Rechazo en BBVA (012) -> Failover automático a Santander (014)
  const failedOver = engine.simulateSignedWebhookForOrder(order.orderId, 'BANK_REJECT');
  assert.equal(failedOver.status, 'FAILOVER_READY_RETRY');
  assert.equal(failedOver.bankName, 'Santander México');
  assert.equal(engine.metrics.failoversExecuted, 1);

  // Pago tardío después de expiración -> Emite Voucher de crédito/devolución
  const lateRes = engine.simulateSignedWebhookForOrder(order.orderId, 'LATE_PAYMENT');
  assert.equal(lateRes.status, 'LATE_PAYMENT_VOUCHER_ISSUED');
  assert.match(lateRes.voucherCode, /^VCHR-/);
  assert.equal(engine.metrics.latePaymentsHandled, 1);
});

test('6. Concilia automáticamente Vaquita Split-Pay personalizada y actualiza secuenciador musical', async () => {
  const engine = new PeyEngine();
  engine.resetSplitSession({
    title: 'Cena Taquería',
    participants: [
      { slotId: 'p1', name: 'Ana', clabeId: 'acc_ramon_bbva', amount: 0.01 },
      { slotId: 'p2', name: 'Luis', clabeId: 'acc_adrian_santander', amount: 0.01 },
    ],
  });

  assert.equal(engine.splitSession.targetAmount, 0.02);

  for (const participant of engine.splitSession.participants) {
    const ord = await engine.createOrder({
      station: 'split',
      method: 'QR',
      concept: `CUENTA ${participant.slotId}`,
      clabeId: participant.clabeId,
      metadata: { slotId: participant.slotId, dedication: 'Listo mi pago' },
    });
    engine.simulateSignedWebhookForOrder(ord.orderId, 'SUCCESS');
  }

  assert.equal(engine.splitSession.collectedAmount, 0.02);
  assert.equal(engine.splitSession.status, 'COMPLETED_RECONCILED');

  // Actualizar paso del secuenciador y BPM
  const studio = engine.updateStudioSequencer({ trackKey: 'bass_303', stepIndex: 1, active: true, bpm: 132 });
  assert.equal(studio.bpm, 132);
  assert.equal(studio.activeTracks.bass_303.steps[1], true);
});

test('7. Servidor HTTP responde en /api/state, /api/orders, /api/clabes/validate y /api/webhooks/dispatch', async () => {
  const { server } = createAppServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const stateRes = await fetch(`${base}/api/state`);
    assert.equal(stateRes.status, 200);
    const stateData = await stateRes.json();
    assert.equal(stateData.clabes.length, 5);
    assert.equal(stateData.posCatalog.length, 4);

    // Probar sugerencia de dígito verificador con 17 dígitos
    const valRes = await fetch(`${base}/api/clabes/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clabe: '01218001582622571' }),
    });
    assert.equal(valRes.status, 200);
    const valBody = await valRes.json();
    assert.equal(valBody.suggestedDigit, 3);

    const createRes = await fetch(`${base}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        station: 'meals',
        method: 'QR',
        concept: 'TACO PATROCINADO',
        clabeId: 'acc_david_azteca',
      }),
    });
    assert.equal(createRes.status, 201);
    const { order } = await createRes.json();
    assert.ok(order.qrDataUrl.startsWith('data:image/png;base64,'));

    const simRes = await fetch(`${base}/api/webhooks/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.orderId, scenario: 'SUCCESS' }),
    });
    assert.equal(simRes.status, 200);
    const simBody = await simRes.json();
    assert.equal(simBody.chaosResult.status, 'PAID_AND_EXECUTED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

const { verifyStandardWebhook, PeyClient } = require('../src/services/peyClient');

test('8. Verifica la firma con el vector oficial de Standard Webhooks (secreto base64)', () => {
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
  const webhookId = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
  const timestamp = '1614265330';
  const body = '{"test": 2432232314}';
  const headers = signStandardWebhook(body, secret, webhookId, timestamp);
  assert.equal(headers['webhook-signature'], 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
});

test('9. Rechaza webhooks con timestamp fuera de la ventana de 5 minutos (replay)', () => {
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
  const body = '{"type":"codi.qr.payment_received"}';
  const stale = String(Math.floor(Date.now() / 1000) - 301);
  const staleCheck = verifyStandardWebhook(body, signStandardWebhook(body, secret, 'msg_old', stale), secret);
  assert.equal(staleCheck.valid, false);
  assert.match(staleCheck.reason, /timestamp/i);

  const fresh = verifyStandardWebhook(body, signStandardWebhook(body, secret, 'msg_new'), secret);
  assert.equal(fresh.valid, true);
});

test('10. Sin PEY_WEBHOOK_SECRET no usa un secreto fijo conocido', () => {
  const saved = process.env.PEY_WEBHOOK_SECRET;
  delete process.env.PEY_WEBHOOK_SECRET;
  try {
    const a = new PeyClient();
    const b = new PeyClient();
    assert.notEqual(a.webhookSecret, b.webhookSecret);
    assert.ok(!a.webhookSecret.includes('peyos'));
  } finally {
    if (saved !== undefined) process.env.PEY_WEBHOOK_SECRET = saved;
  }
});

test('11. Rutas de simulación y configuración exigen token de administrador en producción', async () => {
  const saved = { env: process.env.NODE_ENV, token: process.env.PEYOS_ADMIN_TOKEN };
  process.env.NODE_ENV = 'production';
  delete process.env.PEYOS_ADMIN_TOKEN;
  const { server, engine } = createAppServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, headers = {}) =>
    fetch(`${base}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  try {
    const order = await engine.createOrder({ station: 'pos', method: 'QR' });
    const secretBefore = engine.peyClient.webhookSecret;

    // Sin token configurado: deshabilitadas
    for (const url of ['/api/chaos/simulate', '/api/webhooks/dispatch']) {
      assert.equal((await post(url, { orderId: order.orderId })).status, 403);
    }
    assert.equal((await post('/api/config/pey', { webhookSecret: 'whsec_attacker' })).status, 403);
    assert.equal(engine.peyClient.webhookSecret, secretBefore);
    assert.equal(engine.orders.get(order.orderId).status, 'QR_READY');

    // Con token configurado: solo con la cabecera correcta
    process.env.PEYOS_ADMIN_TOKEN = 'admin-token-123';
    const wrong = await post('/api/chaos/simulate', { orderId: order.orderId }, { 'x-admin-token': 'nope' });
    assert.equal(wrong.status, 403);
    const ok = await post('/api/chaos/simulate', { orderId: order.orderId }, { 'x-admin-token': 'admin-token-123' });
    assert.equal(ok.status, 200);
    assert.equal(engine.orders.get(order.orderId).status, 'OTP_ISSUED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (saved.env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.env;
    if (saved.token === undefined) delete process.env.PEYOS_ADMIN_TOKEN;
    else process.env.PEYOS_ADMIN_TOKEN = saved.token;
  }
});

test('12. El PIN OTP solo lo recibe quien creó la orden (no viaja en snapshot, SSE ni respuesta del webhook)', async () => {
  const { server, engine } = createAppServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sse = await fetch(`${base}/api/events`);
  const reader = sse.body.getReader();
  const decoder = new TextDecoder();

  try {
    const createRes = await fetch(`${base}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station: 'locker', method: 'QR', metadata: { lockerId: 'LOCKER-A1' } }),
    });
    const { order, claimToken } = await createRes.json();
    assert.match(claimToken, /^[0-9a-f]{32}$/);
    assert.equal(order.claimToken, undefined);

    const result = engine.simulateSignedWebhookForOrder(order.orderId, 'SUCCESS');
    assert.equal(result.otpCode, undefined);
    const otp = engine.orders.get(order.orderId).otpCode;
    assert.match(otp, /^\d{6}$/);

    let streamed = '';
    while (!streamed.includes('order.paid')) {
      const { value, done } = await reader.read();
      if (done) break;
      streamed += decoder.decode(value);
    }
    assert.ok(streamed.includes('order.paid'));
    assert.ok(!streamed.includes(otp), 'el OTP no debe viajar por SSE');
    assert.ok(!streamed.includes(claimToken), 'el claimToken no debe viajar por SSE');

    const state = await (await fetch(`${base}/api/state`)).text();
    assert.ok(!state.includes(otp));
    assert.ok(!state.includes(claimToken));

    const otpUrl = `${base}/api/orders/${order.orderId}/otp`;
    assert.equal((await fetch(otpUrl)).status, 403);
    assert.equal((await fetch(otpUrl, { headers: { 'x-claim-token': 'f'.repeat(32) } })).status, 403);
    const claimed = await fetch(otpUrl, { headers: { 'x-claim-token': claimToken } });
    assert.equal(claimed.status, 200);
    assert.equal((await claimed.json()).otpCode, otp);
  } finally {
    await reader.cancel();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

const http = require('node:http');

test('13. En modo LIVE un fallo de api.pey.mx es error 502, no un QR local falso', async () => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"error":"down"}');
  });
  await new Promise((resolve) => upstream.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${upstream.address().port}`;
  const client = new PeyClient({ apiKey: 'live_key_123456', baseUrl, webhookSecret: 'whsec_dGVzdA==' });
  const { server } = createAppServer(new PeyEngine({ peyClient: client }));
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    await assert.rejects(client.createCodiQr({ amount: 0.01 }), (err) => err.statusCode === 502);
    await assert.rejects(client.createCodiPushNotification({ phone: '5512345678' }), (err) => err.statusCode === 502);
    await assert.rejects(client.registerBankAccount({ clabe: '012180015826225713' }), (err) => err.statusCode === 502);

    const res = await fetch(`${base}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station: 'pos', method: 'QR' }),
    });
    assert.equal(res.status, 502);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('14. JSON malformado es 400 y errores internos son 500 sin filtrar detalles', async () => {
  const { server, engine } = createAppServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bad = await fetch(`${base}/api/orders`, { method: 'POST', body: '{not json' });
    assert.equal(bad.status, 400);

    engine.getSnapshot = () => {
      throw new TypeError('detalle interno secreto');
    };
    const crash = await fetch(`${base}/api/state`);
    assert.equal(crash.status, 500);
    assert.ok(!(await crash.text()).includes('detalle interno secreto'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function signedPayment(engine, order, amount, extra = {}) {
  const body = JSON.stringify({
    type: 'codi.qr.payment_received',
    ...(amount === undefined ? {} : { amount }),
    numRef: String(order.numRef),
    transactionId: `01TXN${Math.random().toString(16).slice(2)}`,
    datePaid: Math.floor(Date.now() / 1000),
    metadata: { externalMetadata: { orderId: order.orderId } },
    ...extra,
  });
  return engine.processWebhook(body, signStandardWebhook(body, engine.peyClient.webhookSecret));
}

test('15. Un pago menor al monto de la orden no emite PIN ni ejecuta efectos', async () => {
  const engine = new PeyEngine();
  const order = await engine.createOrder({ station: 'locker', amount: 0.05, metadata: { lockerId: 'LOCKER-A1' } });

  const under = signedPayment(engine, order, 0.01);
  assert.equal(under.status, 'AMOUNT_MISMATCH');
  assert.equal(engine.orders.get(order.orderId).status, 'UNDERPAID');
  assert.equal(engine.orders.get(order.orderId).otpCode, null);
  assert.equal(engine.lockers['LOCKER-A1'].status, 'RESERVED_WAITING_PAYMENT');
  assert.equal(engine.metrics.totalPaidOrders, 0);

  const order2 = await engine.createOrder({ station: 'pos', amount: 0.05 });
  assert.equal(signedPayment(engine, order2, undefined).status, 'AMOUNT_MISMATCH');

  const order3 = await engine.createOrder({ station: 'pos', amount: 0.05 });
  assert.equal(signedPayment(engine, order3, 0.05).status, 'PAID_AND_EXECUTED');
  assert.equal(engine.metrics.totalPaidOrders, 1);
});

test('16. Casilleros: id desconocido o unidad ocupada se rechazan y la reserva vence', async () => {
  const engine = new PeyEngine();
  await assert.rejects(
    engine.createOrder({ station: 'locker', metadata: { lockerId: 'NO-EXISTE' } }),
    /Unidad/
  );
  await assert.rejects(engine.createOrder({ station: 'locker', metadata: {} }), /Unidad/);

  const first = await engine.createOrder({ station: 'locker', ttlSeconds: 60, metadata: { lockerId: 'POD-CARGA-B2' } });
  await assert.rejects(
    engine.createOrder({ station: 'locker', metadata: { lockerId: 'POD-CARGA-B2' } }),
    /ocupada/
  );

  // La reserva sin pago vence y libera la unidad
  engine.orders.get(first.orderId).expiresAt = Date.now() - 1;
  engine.tickTimers();
  assert.equal(engine.lockers['POD-CARGA-B2'].status, 'LOCKED_IDLE');

  // Otro cliente la reserva; el pago tardío del primero no la secuestra
  const second = await engine.createOrder({ station: 'locker', metadata: { lockerId: 'POD-CARGA-B2' } });
  // Pagado a tiempo según el banco, pero el webhook llegó después de liberar la unidad
  const paidInTime = Math.floor(engine.orders.get(first.orderId).expiresAt / 1000) - 10;
  const latePay = signedPayment(engine, first, first.amount, { datePaid: paidInTime });
  assert.equal(latePay.status, 'LATE_PAYMENT_VOUCHER_ISSUED');
  assert.equal(engine.lockers['POD-CARGA-B2'].activeOrderId, second.orderId);
  assert.equal(engine.lockers['POD-CARGA-B2'].status, 'RESERVED_WAITING_PAYMENT');
});

test('17. Solo quien tiene el claimToken de la orden activa puede cerrar el casillero', async () => {
  const { server, engine } = createAppServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const order = await engine.createOrder({ station: 'locker', metadata: { lockerId: 'SALA-API-C3' } });
    signedPayment(engine, order, order.amount);
    engine.verifyDeliveryOtp({ orderId: order.orderId, otpCode: engine.orders.get(order.orderId).otpCode });
    assert.equal(engine.lockers['SALA-API-C3'].status, 'UNLOCKED_ACTIVE');

    const url = `${base}/api/lockers/SALA-API-C3/release`;
    assert.equal((await fetch(url, { method: 'POST' })).status, 403);
    assert.equal(engine.lockers['SALA-API-C3'].status, 'UNLOCKED_ACTIVE');

    const ok = await fetch(url, { method: 'POST', headers: { 'x-claim-token': order.claimToken } });
    assert.equal(ok.status, 200);
    assert.equal(engine.lockers['SALA-API-C3'].status, 'LOCKED_IDLE');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('18. Un PIN viejo no abre un casillero que ya reservó otra persona', async () => {
  const engine = new PeyEngine();
  const first = await engine.createOrder({ station: 'locker', metadata: { lockerId: 'LOCKER-A1' } });
  signedPayment(engine, first, first.amount);
  engine.releaseLocker('LOCKER-A1', first.claimToken);

  const second = await engine.createOrder({ station: 'locker', metadata: { lockerId: 'LOCKER-A1' } });
  engine.verifyDeliveryOtp({ orderId: first.orderId, otpCode: engine.orders.get(first.orderId).otpCode });

  assert.equal(engine.lockers['LOCKER-A1'].status, 'RESERVED_WAITING_PAYMENT');
  assert.equal(engine.lockers['LOCKER-A1'].activeOrderId, second.orderId);
});
