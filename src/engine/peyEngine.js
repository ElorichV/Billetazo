const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('node:events');
const { PREAUTHORIZED_CLABES, validateClabe } = require('../config/clabes');
const { PeyClient, signStandardWebhook, verifyStandardWebhook } = require('../services/peyClient');

const STORY_CHAPTERS = [
  {
    chapter: 1,
    title: 'Nodo Central CoDi · Ciudad de México',
    narrative:
      'La red de pagos instantáneos opera sin fricción. Cada transacción liquidada desbloquea infraestructura física, creativa y comercial en tiempo real.',
    options: [
      { id: 'opt_cyber', label: 'Sincronizar sintetizador analógico con la red bancaria', style: 'Audio Reactivo', votes: 0 },
      { id: 'opt_robot', label: 'Despachar pedido verificado con PIN criptográfico', style: 'Logística Autónoma', votes: 0 },
      { id: 'opt_ai', label: 'Ejecutar conciliación multi-CLABE automática', style: 'FinTech Core', votes: 0 },
    ],
  },
];

const STORY_CONTINUATIONS = {
  opt_cyber: {
    title: 'Secuencia Audio-Financiera Sincronizada',
    narrative:
      'La liquidación CoDi activó el oscilador principal y sumó una nueva capa armónica al estudio compartido.',
  },
  opt_robot: {
    title: 'Entrega Liberada por Token de Un Solo Uso',
    narrative:
      'El pago quedó separado de la entrega: tras validar el PIN de 6 dígitos en la terminal, el casillero liberó el pedido.',
  },
  opt_ai: {
    title: 'Conciliación Multi-Banco Completada',
    narrative:
      'La firma HMAC-SHA256 fue verificada sin intervención humana y los fondos se reflejaron al instante en la cuenta destino.',
  },
};

const POS_CATALOG = [
  {
    id: 'item_tacos_pastor',
    name: 'Orden de Tacos al Pastor (3 pzas)',
    category: 'Cocina en Vivo',
    icon: '🌮',
    amount: 0.01,
    clabeId: 'acc_miriam_bbva',
    isSponsoredMeal: false,
    description: 'Orden recién salida del trompo con piña, cilantro y validación de entrega por PIN.',
  },
  {
    id: 'item_cafe_olla',
    name: 'Café de Especialidad Cold Brew',
    category: 'Barra de Café',
    icon: '☕',
    amount: 0.01,
    clabeId: 'acc_miriam_bbva',
    isSponsoredMeal: false,
    description: 'Extracción en frío de grano chiapaneco. Sin filas ni comprobantes manuales.',
  },
  {
    id: 'item_comida_solidaria',
    name: 'Comida Patrocinada (Comedor Abierto)',
    category: 'Impacto Social',
    icon: '🍲',
    amount: 0.01,
    clabeId: 'acc_david_azteca',
    isSponsoredMeal: true,
    description: 'Deja pagada una comida completa en el tablero comunitario para quien la necesite hoy.',
  },
  {
    id: 'item_kit_hidratacion',
    name: 'Kit Energético & Electrolitos',
    category: 'Tienda Express',
    icon: '⚡',
    amount: 0.01,
    clabeId: 'acc_david_azteca',
    isSponsoredMeal: false,
    description: 'Bebida isotónica + snack proteico con retiro inmediato en mostrador mediante OTP.',
  },
];

class PeyEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.peyClient = options.peyClient || new PeyClient(options);
    this.persistPath = options.persistPath || null;
    this.clabes = structuredClone(PREAUTHORIZED_CLABES);
    this.orders = new Map();
    this.processedWebhookIds = new Set();
    this.processedTransactionIds = new Set();
    this.vouchers = new Map();
    this.webhookLogs = [];
    this.posCatalog = structuredClone(POS_CATALOG);

    this.metrics = {
      totalOrdersCreated: 0,
      totalPaidOrders: 0,
      totalCentavosCollectedMxn: 0,
      duplicatesBlocked: 0,
      latePaymentsHandled: 0,
      failoversExecuted: 0,
      otpDeliveriesVerified: 0,
      webhooksVerified: 0,
      invalidSignaturesBlocked: 0,
    };

    // Estado funcional de PeyStudio: Sintetizador + Secuenciador 8 pasos + Lienzo Colectivo + Narrativa
    this.liveStudio = {
      bpm: 124,
      isPlaying: false,
      activeTracks: {
        bass_303: {
          name: 'Bassline 303 Ácido',
          instrument: 'Sawtooth 110Hz',
          active: true,
          paidCount: 0,
          lastPayer: null,
          color: '#10b981',
          steps: [true, false, true, false, true, true, false, true],
        },
        cyber_arp: {
          name: 'Arpegio Cyberpunk',
          instrument: 'Square Lead',
          active: false,
          paidCount: 0,
          lastPayer: null,
          color: '#6366f1',
          steps: [true, true, false, true, true, false, true, true],
        },
        neon_drums: {
          name: 'Pulso Percusivo Sub',
          instrument: 'Analog Kick',
          active: false,
          paidCount: 0,
          lastPayer: null,
          color: '#f59e0b',
          steps: [true, false, false, false, true, false, true, false],
        },
        chord_pad: {
          name: 'Pad Atmosférico',
          instrument: 'Warm Triangle',
          active: false,
          paidCount: 0,
          lastPayer: null,
          color: '#ec4899',
          steps: [true, false, false, true, false, false, true, false],
        },
      },
      muralTiles: [],
      storyHistory: structuredClone(STORY_CHAPTERS),
      storyVotes: {
        opt_cyber: 0,
        opt_robot: 0,
        opt_ai: 0,
      },
      aiJobs: [],
    };

    // Estado funcional de Smart Lockers & Cabinas de Tiempo
    this.lockers = {
      'LOCKER-A1': {
        id: 'LOCKER-A1',
        name: 'Casillero Inteligente #A1',
        subtitle: 'Compartimento de Paquetería & Retail',
        icon: '📦',
        type: 'LOCKER',
        clabeId: 'acc_santiago_bbva',
        defaultDurationSeconds: 60,
        status: 'LOCKED_IDLE', // LOCKED_IDLE | RESERVED_WAITING_PAYMENT | PAID_WAITING_OTP | UNLOCKED_ACTIVE
        activeOrderId: null,
        otpHint: null,
        remainingSeconds: 0,
        unlockedUntil: null,
        totalUnlocks: 0,
      },
      'POD-CARGA-B2': {
        id: 'POD-CARGA-B2',
        name: 'Cabina de Carga & Cómputo #B2',
        subtitle: 'Estación de Energía + GPU por Minuto',
        icon: '🔋',
        type: 'TIME_SESSION',
        clabeId: 'acc_santiago_bbva',
        defaultDurationSeconds: 90,
        status: 'LOCKED_IDLE',
        activeOrderId: null,
        otpHint: null,
        remainingSeconds: 0,
        unlockedUntil: null,
        totalUnlocks: 0,
      },
      'SALA-API-C3': {
        id: 'SALA-API-C3',
        name: 'Cabina Acústica Privada #C3',
        subtitle: 'Acceso Temporal por Pase CoDi',
        icon: '🎙️',
        type: 'SESSION_PASS',
        clabeId: 'acc_santiago_bbva',
        defaultDurationSeconds: 120,
        status: 'LOCKED_IDLE',
        activeOrderId: null,
        otpHint: null,
        remainingSeconds: 0,
        unlockedUntil: null,
        totalUnlocks: 0,
      },
    };

    // Estado funcional de Vaquita Split-Pay Multi-CLABE
    this.splitSession = this._createInitialSplitSession();

    // Estado funcional de Comidas Patrocinadas & POS (sin datos falsos pre-cargados)
    this.sponsoredMeals = {
      fundedCount: 0,
      deliveredCount: 0,
      availableTokens: [],
      history: [],
    };

    if (this.persistPath) {
      this._loadPersistedState();
    }
  }

  _createInitialSplitSession(custom = {}) {
    const defaultParticipants = [
      {
        slotId: 'split_1',
        name: 'Integrante 1 · BBVA',
        clabeId: 'acc_ramon_bbva',
        amount: 0.01,
        status: 'PENDING',
        orderId: null,
        paidAt: null,
      },
      {
        slotId: 'split_2',
        name: 'Integrante 2 · Santander',
        clabeId: 'acc_adrian_santander',
        amount: 0.01,
        status: 'PENDING',
        orderId: null,
        paidAt: null,
      },
      {
        slotId: 'split_3',
        name: 'Integrante 3 · Azteca',
        clabeId: 'acc_david_azteca',
        amount: 0.01,
        status: 'PENDING',
        orderId: null,
        paidAt: null,
      },
    ];

    const participants = Array.isArray(custom.participants) && custom.participants.length > 0
      ? custom.participants.map((p, idx) => ({
          slotId: p.slotId || `split_${idx + 1}`,
          name: String(p.name || `Participante ${idx + 1}`).slice(0, 40),
          clabeId: p.clabeId || defaultParticipants[idx % defaultParticipants.length].clabeId,
          amount: Number(p.amount) > 0 ? Number(Number(p.amount).toFixed(2)) : 0.01,
          status: 'PENDING',
          orderId: null,
          paidAt: null,
        }))
      : defaultParticipants;

    const targetAmount = Number(
      participants.reduce((acc, p) => acc + Number(p.amount || 0.01), 0).toFixed(2)
    );

    return {
      id: `split_${crypto.randomBytes(4).toString('hex')}`,
      title: String(custom.title || 'Cuenta Compartida Multi-CLABE').slice(0, 60),
      targetAmount,
      collectedAmount: 0,
      status: 'COLLECTING',
      dedications: [],
      participants,
    };
  }

  _loadPersistedState() {
    try {
      if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.clabes) && data.clabes.length >= 5) {
        this.clabes = data.clabes;
      }
      if (data.metrics) {
        this.metrics = { ...this.metrics, ...data.metrics };
      }
      if (data.liveStudio) {
        this.liveStudio = { ...this.liveStudio, ...data.liveStudio };
      }
      if (data.lockers) {
        for (const [k, v] of Object.entries(data.lockers)) {
          if (this.lockers[k]) {
            this.lockers[k] = { ...this.lockers[k], ...v };
          }
        }
      }
      if (data.splitSession) {
        this.splitSession = data.splitSession;
      }
      if (data.sponsoredMeals) {
        this.sponsoredMeals = data.sponsoredMeals;
      }
      if (Array.isArray(data.orders)) {
        this.orders = new Map(data.orders.map((o) => [o.orderId, o]));
      }
      if (Array.isArray(data.vouchers)) {
        this.vouchers = new Map(data.vouchers.map((v) => [v.voucherCode, v]));
      }
      if (Array.isArray(data.webhookLogs)) {
        this.webhookLogs = data.webhookLogs;
      }
      if (Array.isArray(data.processedWebhookIds)) {
        this.processedWebhookIds = new Set(data.processedWebhookIds);
      }
      if (Array.isArray(data.processedTransactionIds)) {
        this.processedTransactionIds = new Set(data.processedTransactionIds);
      }
    } catch (_err) {
      // Si el archivo de estado no existe o está corrupto, continúa con estado limpio
    }
  }

  _savePersistedState() {
    if (!this.persistPath) return;
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const payload = {
        clabes: this.clabes,
        metrics: this.metrics,
        liveStudio: this.liveStudio,
        lockers: this.lockers,
        splitSession: this.splitSession,
        sponsoredMeals: this.sponsoredMeals,
        orders: Array.from(this.orders.values()).slice(0, 100),
        vouchers: Array.from(this.vouchers.values()),
        webhookLogs: this.webhookLogs.slice(0, 50),
        processedWebhookIds: Array.from(this.processedWebhookIds).slice(-200),
        processedTransactionIds: Array.from(this.processedTransactionIds).slice(-200),
      };
      fs.writeFileSync(this.persistPath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (_err) {
      // Ignorar errores de escritura en entornos de solo lectura
    }
  }

  getClabeById(clabeId) {
    return this.clabes.find((c) => c.id === clabeId) || this.clabes[0];
  }

  /**
   * Registra una nueva cuenta CLABE validando los 18 dígitos y el dígito verificador de Banxico.
   */
  async registerNewClabe({ holderName, clabe, role }) {
    const check = validateClabe(clabe);
    if (!check.valid) {
      throw new Error(check.reason);
    }
    const existing = this.clabes.find((c) => c.clabe === clabe);
    if (existing) {
      return existing;
    }
    const remote = await this.peyClient.registerBankAccount({
      clabe,
      holderName: holderName || 'Titular CoDi',
    });
    const entry = {
      id: `acc_custom_${crypto.randomBytes(3).toString('hex')}`,
      holderName: String(holderName || 'Cuenta CoDi').slice(0, 60),
      clabe,
      bankPrefix: clabe.slice(0, 3),
      bankName: check.bankName,
      banxicoCode: check.banxicoCode,
      role: String(role || 'Cuenta Receptora CoDi').slice(0, 80),
      station: 'custom',
      codiStatus: remote.codiStatus || 'ACTIVE',
      bankAccountId: remote.id,
    };
    this.clabes.push(entry);
    this._broadcastState('clabe.registered', entry);
    return entry;
  }

  /**
   * Actualiza pasos del secuenciador musical o el BPM en PeyStudio.
   */
  updateStudioSequencer({ trackKey, stepIndex, active, bpm }) {
    if (typeof bpm === 'number' && bpm >= 80 && bpm <= 170) {
      this.liveStudio.bpm = Math.round(bpm);
    }
    if (trackKey && this.liveStudio.activeTracks[trackKey]) {
      const track = this.liveStudio.activeTracks[trackKey];
      if (typeof stepIndex === 'number' && stepIndex >= 0 && stepIndex < 8) {
        track.steps[stepIndex] = typeof active === 'boolean' ? active : !track.steps[stepIndex];
      }
    }
    this._broadcastState('studio.updated', this.liveStudio);
    return this.liveStudio;
  }

  /**
   * Libera manualmente un casillero o cabina activa cuando el usuario termina de usarlo.
   */
  releaseLocker(lockerId) {
    const locker = this.lockers[lockerId];
    if (!locker) {
      throw new Error('Unidad no encontrada.');
    }
    locker.status = 'LOCKED_IDLE';
    locker.activeOrderId = null;
    locker.otpHint = null;
    locker.remainingSeconds = 0;
    locker.unlockedUntil = null;
    this._broadcastState('locker.released', locker);
    return locker;
  }

  /**
   * Crea una orden de cobro CoDi ($0.01 MXN por defecto) por QR (/codi/qr) o Notificación Push (/codi/pn).
   */
  async createOrder({
    station = 'synth',
    method = 'QR', // 'QR' | 'PUSH'
    phone = '',
    amount = 0.01,
    concept = 'Cobro CoDi PeyOS',
    clabeId = 'acc_ramon_bbva',
    ttlSeconds = 180,
    metadata = {},
  }) {
    const parsedAmount = Number(amount);
    const resolvedAmount = Number.isFinite(parsedAmount) && parsedAmount > 0
      ? Number(parsedAmount.toFixed(2))
      : 0.01;
    const orderId = `ord_${crypto.randomBytes(6).toString('hex')}`;
    const numRef = String(100000 + ((this.metrics.totalOrdersCreated + 1) % 899999));
    const targetAccount = this.getClabeById(clabeId);
    const now = Date.now();
    const expiresAt = now + Number(ttlSeconds) * 1000;

    let codiResult;
    const normalizedMethod = String(method).toUpperCase() === 'PUSH' ? 'PUSH' : 'QR';

    if (normalizedMethod === 'PUSH') {
      codiResult = await this.peyClient.createCodiPushNotification({
        amount: resolvedAmount,
        concept,
        phone,
        numRef,
        bankAccountId: targetAccount.bankAccountId,
      });
    } else {
      codiResult = await this.peyClient.createCodiQr({
        amount: resolvedAmount,
        concept,
        expiration: ttlSeconds,
        numRef,
        bankAccountId: targetAccount.bankAccountId,
        clabe: targetAccount.clabe,
      });
    }

    const order = {
      orderId,
      numRef,
      station,
      method: normalizedMethod,
      phone: normalizedMethod === 'PUSH' ? codiResult.phone : null,
      amount: resolvedAmount,
      concept: String(concept).slice(0, 50),
      clabeId: targetAccount.id,
      clabe: targetAccount.clabe,
      holderName: targetAccount.holderName,
      bankName: targetAccount.bankName,
      bankAccountId: targetAccount.bankAccountId,
      status: normalizedMethod === 'PUSH' ? 'PUSH_SENT' : 'QR_READY',
      codiQrId: codiResult.codiQrId || null,
      pushId: codiResult.pushId || null,
      qrDataUrl: codiResult.qrDataUrl || null,
      qrString: codiResult.qrString || null,
      apiSource: codiResult.source,
      createdAt: now,
      expiresAt,
      paidAt: null,
      deliveredAt: null,
      transactionId: null,
      otpCode: null,
      claimToken: crypto.randomBytes(16).toString('hex'),
      voucherCode: null,
      failoverHistory: [],
      metadata,
    };

    this.orders.set(orderId, order);
    this.metrics.totalOrdersCreated += 1;

    // Si es orden de Locker/Tiempo, reservar la unidad mientras se confirma el pago
    if (station === 'locker' && metadata.lockerId && this.lockers[metadata.lockerId]) {
      const locker = this.lockers[metadata.lockerId];
      if (locker.status === 'LOCKED_IDLE') {
        locker.status = 'RESERVED_WAITING_PAYMENT';
        locker.activeOrderId = orderId;
      }
    }

    // Si es orden de Vaquita Split-Pay, asociar al participante
    if (station === 'split' && metadata.slotId) {
      const slot = this.splitSession.participants.find((p) => p.slotId === metadata.slotId);
      if (slot && slot.status !== 'PAID') {
        slot.orderId = orderId;
        slot.status = 'PAYMENT_REQUESTED';
      }
    }

    this._broadcastState('order.created', order);
    return order;
  }

  /**
   * Procesa un webhook entrante de pey.mx (`codi.qr.payment_received` o `codi.pn.payment_received`)
   * verificando autenticidad Standard Webhooks, idempotencia, expiración (pagos tardíos) y efectos por módulo.
   */
  processWebhook(rawBody, headers = {}) {
    const normalizedHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      normalizedHeaders[k.toLowerCase()] = v;
    }

    const verification = verifyStandardWebhook(
      rawBody,
      normalizedHeaders,
      this.peyClient.webhookSecret
    );

    if (!verification.valid) {
      this.metrics.invalidSignaturesBlocked += 1;
      const logEntry = {
        id: `log_${crypto.randomBytes(4).toString('hex')}`,
        timestamp: Date.now(),
        webhookId: verification.webhookId || 'missing',
        eventType: 'SECURITY_REJECTED',
        outcome: 'INVALID_SIGNATURE',
        reason: verification.reason,
      };
      this._pushWebhookLog(logEntry);
      this._broadcastState('webhook.rejected', logEntry);
      return {
        httpStatus: 401,
        status: 'INVALID_SIGNATURE',
        reason: verification.reason,
      };
    }

    this.metrics.webhooksVerified += 1;
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (_err) {
      return { httpStatus: 400, status: 'INVALID_JSON', reason: 'Cuerpo JSON malformado.' };
    }

    const webhookId = verification.webhookId;
    const transactionId = payload.transactionId || '';

    // 1. Idempotencia: Evita ejecutar dos veces la misma orden o el mismo webhook
    if (
      this.processedWebhookIds.has(webhookId) ||
      (transactionId && this.processedTransactionIds.has(transactionId))
    ) {
      this.metrics.duplicatesBlocked += 1;
      const dupLog = {
        id: `log_${crypto.randomBytes(4).toString('hex')}`,
        timestamp: Date.now(),
        webhookId,
        transactionId,
        eventType: payload.type || 'unknown',
        numRef: payload.numRef,
        outcome: 'DUPLICATE_BLOCKED_IDEMPOTENT',
        reason: 'Webhook o transacción ya procesada previamente. Orden protegida contra doble ejecución.',
      };
      this._pushWebhookLog(dupLog);
      this._broadcastState('webhook.duplicate_blocked', dupLog);
      return {
        httpStatus: 200,
        status: 'DUPLICATE_IGNORED',
        idempotent: true,
        webhookId,
        transactionId,
      };
    }

    this.processedWebhookIds.add(webhookId);
    if (transactionId) {
      this.processedTransactionIds.add(transactionId);
    }

    // Buscar la orden por externalMetadata.orderId, codiQrId o numRef
    const externalOrderId = payload?.metadata?.externalMetadata?.orderId;
    let order = externalOrderId ? this.orders.get(externalOrderId) : null;
    if (!order && payload.codiQrId) {
      for (const candidate of this.orders.values()) {
        if (candidate.codiQrId === payload.codiQrId) {
          order = candidate;
          break;
        }
      }
    }
    if (!order && payload.numRef) {
      for (const candidate of this.orders.values()) {
        if (String(candidate.numRef) === String(payload.numRef)) {
          order = candidate;
          break;
        }
      }
    }

    if (!order) {
      const unmatchedLog = {
        id: `log_${crypto.randomBytes(4).toString('hex')}`,
        timestamp: Date.now(),
        webhookId,
        transactionId,
        eventType: payload.type,
        numRef: payload.numRef,
        outcome: 'UNMATCHED_ORDER_CONCILED',
        reason: 'Pago recibido sin orden previa local; registrado en libro mayor de conciliación.',
      };
      this._pushWebhookLog(unmatchedLog);
      this._broadcastState('webhook.unmatched', unmatchedLog);
      return { httpStatus: 200, status: 'UNMATCHED_RECORDED', webhookId };
    }

    if (order.status === 'PAID' || order.status === 'OTP_ISSUED' || order.status === 'DELIVERED') {
      this.metrics.duplicatesBlocked += 1;
      return {
        httpStatus: 200,
        status: 'ALREADY_EXECUTED',
        idempotent: true,
        orderId: order.orderId,
      };
    }

    const now = Date.now();
    const paidTimestampMs = payload.datePaid ? Number(payload.datePaid) * 1000 : now;
    const isLate = paidTimestampMs > order.expiresAt || order.status === 'EXPIRED';

    this.metrics.totalPaidOrders += 1;
    this.metrics.totalCentavosCollectedMxn = Number(
      (this.metrics.totalCentavosCollectedMxn + Number(payload.amount || order.amount || 0.01)).toFixed(2)
    );

    order.paidAt = paidTimestampMs;
    order.transactionId = transactionId || `01JTXN${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    order.payerClabe = payload?.metadata?.clabe || '012180009999999999';
    order.trackingKey = payload?.metadata?.trackingKey || `TRK-${order.numRef}`;

    // 2. Pagos tardíos: emitir Voucher Criptográfico de crédito/devolución
    if (isLate) {
      this.metrics.latePaymentsHandled += 1;
      order.status = 'LATE_PAYMENT_VOUCHER_ISSUED';
      const voucherCode = `VCHR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const voucherSignature = crypto
        .createHmac('sha256', this.peyClient.webhookSecret)
        .update(`${voucherCode}:${order.orderId}:${order.amount}`)
        .digest('hex')
        .slice(0, 16);

      const voucher = {
        voucherCode,
        signature: voucherSignature,
        orderId: order.orderId,
        amount: order.amount,
        payerClabe: order.payerClabe,
        status: 'ACTIVE_CREDIT',
        reason: 'Pago confirmado por Banxico después de expirar la ventana de reserva. Crédito verificable generado.',
        createdAt: now,
      };
      this.vouchers.set(voucherCode, voucher);
      order.voucherCode = voucherCode;

      if (order.station === 'locker' && order.metadata?.lockerId && this.lockers[order.metadata.lockerId]) {
        const locker = this.lockers[order.metadata.lockerId];
        if (locker.activeOrderId === order.orderId) {
          locker.status = 'LOCKED_IDLE';
          locker.activeOrderId = null;
        }
      }

      const lateLog = {
        id: `log_${crypto.randomBytes(4).toString('hex')}`,
        timestamp: now,
        webhookId,
        transactionId: order.transactionId,
        orderId: order.orderId,
        eventType: payload.type,
        numRef: order.numRef,
        clabe: order.clabe,
        holderName: order.holderName,
        outcome: 'LATE_PAYMENT_COMPENSATED',
        reason: `Orden expirada. Se emitió Voucher Criptográfico ${voucherCode} para devolución o reasignación.`,
        payload,
      };
      this._pushWebhookLog(lateLog);
      this._broadcastState('order.late_payment', { order, voucher, log: lateLog });
      return {
        httpStatus: 200,
        status: 'LATE_PAYMENT_VOUCHER_ISSUED',
        orderId: order.orderId,
        voucherCode,
      };
    }

    // 3. Separación de Pago e Identidad/Entrega: Emitir OTP de un solo uso
    const otpCode = String(100000 + crypto.randomInt(0, 899999));
    order.otpCode = otpCode;
    order.status = 'OTP_ISSUED';

    this._executeStationSideEffect(order, payload);

    const successLog = {
      id: `log_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: now,
      webhookId,
      transactionId: order.transactionId,
      orderId: order.orderId,
      eventType: payload.type,
      numRef: order.numRef,
      clabe: order.clabe,
      holderName: order.holderName,
      outcome: 'EXECUTED_ONCE_VERIFIED',
      reason: `Pago $${Number(order.amount).toFixed(2)} confirmado en ${order.bankName} (${order.holderName}). PIN OTP emitido al comprador.`,
      payload,
    };
    this._pushWebhookLog(successLog);
    this._broadcastState('order.paid', { order, log: successLog });

    return {
      httpStatus: 200,
      status: 'PAID_AND_EXECUTED',
      orderId: order.orderId,
      transactionId: order.transactionId,
    };
  }

  _executeStationSideEffect(order, _payload) {
    const meta = order.metadata || {};

    if (order.station === 'synth') {
      const trackKey = meta.trackKey || 'cyber_arp';
      if (this.liveStudio.activeTracks[trackKey]) {
        const track = this.liveStudio.activeTracks[trackKey];
        track.active = true;
        track.paidCount += 1;
        track.lastPayer = meta.payerAlias || order.holderName;
      }
      this.liveStudio.bpm = Math.min(160, this.liveStudio.bpm + 2);

      const word = String(meta.muralWord || order.concept || 'PEY LIVE').toUpperCase().slice(0, 18);
      const colors = ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7'];
      const color = meta.tileColor || colors[this.liveStudio.muralTiles.length % colors.length];
      this.liveStudio.muralTiles.unshift({
        id: `tile_${order.orderId}`,
        word,
        color,
        author: meta.payerAlias || `Ref #${order.numRef}`,
        clabe: order.clabe,
        timestamp: Date.now(),
      });
      this.liveStudio.muralTiles = this.liveStudio.muralTiles.slice(0, 24);

      if (meta.storyOption && STORY_CONTINUATIONS[meta.storyOption]) {
        const next = STORY_CONTINUATIONS[meta.storyOption];
        if (typeof this.liveStudio.storyVotes?.[meta.storyOption] === 'number') {
          this.liveStudio.storyVotes[meta.storyOption] += 1;
        }
        this.liveStudio.storyHistory.unshift({
          chapter: this.liveStudio.storyHistory.length + 1,
          title: next.title,
          narrative: next.narrative,
          fundedBy: order.numRef,
        });
      }

      this.liveStudio.aiJobs.unshift({
        jobId: `ai_${order.orderId}`,
        prompt: meta.aiPrompt || `Bloque audiovisual generado por orden #${order.numRef}`,
        status: 'COMPLETED_DELIVERED',
        completedAt: Date.now(),
      });
    } else if (order.station === 'locker') {
      const lockerId = meta.lockerId || 'LOCKER-A1';
      const locker = this.lockers[lockerId] || this.lockers['LOCKER-A1'];
      locker.status = 'PAID_WAITING_OTP';
      locker.activeOrderId = order.orderId;
    } else if (order.station === 'split') {
      const slotId = meta.slotId;
      let slot = this.splitSession.participants.find((p) => p.slotId === slotId || p.orderId === order.orderId);
      if (!slot) {
        slot = this.splitSession.participants.find((p) => p.status !== 'PAID');
      }
      if (slot && slot.status !== 'PAID') {
        slot.status = 'PAID';
        slot.orderId = order.orderId;
        slot.paidAt = Date.now();
        const shareAmount = Number(slot.amount || order.amount || 0.01);
        this.splitSession.collectedAmount = Number((this.splitSession.collectedAmount + shareAmount).toFixed(2));
        if (meta.dedication) {
          this.splitSession.dedications.push({
            author: meta.payerAlias || slot.name,
            message: String(meta.dedication).slice(0, 80),
            paidAt: Date.now(),
          });
        }
        const allPaid = this.splitSession.participants.every((p) => p.status === 'PAID');
        if (allPaid) {
          this.splitSession.status = 'COMPLETED_RECONCILED';
        }
      }
    } else if (order.station === 'pos' || order.station === 'meals') {
      if (meta.isSponsoredMeal || order.station === 'meals') {
        const mealToken = `COMIDA-${order.numRef}`;
        this.sponsoredMeals.fundedCount += 1;
        this.sponsoredMeals.availableTokens.unshift({
          token: mealToken,
          itemName: meta.itemName || order.concept,
          donor: meta.payerAlias || order.holderName,
          clabe: order.clabe,
          orderId: order.orderId,
          status: 'AVAILABLE',
          createdAt: Date.now(),
        });
      }
    }
  }

  /**
   * Valida el código OTP de un solo uso para liberar el casillero, activar el tiempo de uso o confirmar entrega.
   */
  verifyDeliveryOtp({ orderId, otpCode }) {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error('Orden no encontrada.');
    }
    if (order.status === 'DELIVERED') {
      throw new Error('Este código OTP de un solo uso ya fue utilizado y quemado.');
    }
    if (order.status !== 'OTP_ISSUED') {
      throw new Error(`La orden aún no tiene un pago confirmado (estado actual: ${order.status}).`);
    }
    if (String(order.otpCode).trim() !== String(otpCode).trim()) {
      throw new Error('Código OTP inválido. No coincide con el token criptográfico de entrega.');
    }

    order.status = 'DELIVERED';
    order.deliveredAt = Date.now();
    this.metrics.otpDeliveriesVerified += 1;

    if (order.station === 'locker') {
      const lockerId = order.metadata?.lockerId || 'LOCKER-A1';
      const locker = this.lockers[lockerId] || this.lockers['LOCKER-A1'];
      const durationSec = Number(order.metadata?.durationSeconds || locker.defaultDurationSeconds || 60);
      locker.status = 'UNLOCKED_ACTIVE';
      locker.remainingSeconds = (locker.remainingSeconds || 0) + durationSec;
      locker.unlockedUntil = Date.now() + locker.remainingSeconds * 1000;
      locker.totalUnlocks += 1;
      locker.otpHint = null;
    }

    if (order.station === 'meals' || order.metadata?.isSponsoredMeal) {
      const tokenEntry = this.sponsoredMeals.availableTokens.find((t) => t.orderId === order.orderId);
      if (tokenEntry) {
        this.sponsoredMeals.availableTokens = this.sponsoredMeals.availableTokens.filter(
          (t) => t.token !== tokenEntry.token
        );
        this.sponsoredMeals.deliveredCount += 1;
        this.sponsoredMeals.history.unshift({
          token: tokenEntry.token,
          itemName: tokenEntry.itemName || order.concept,
          donor: tokenEntry.donor,
          status: 'DELIVERED',
          deliveredAt: Date.now(),
        });
      }
    }

    this._broadcastState('order.delivered', order);
    return order;
  }

  /**
   * Ejecuta failover automático hacia otra CLABE pre-autorizada ante rechazo bancario o timeout.
   */
  triggerBankRejectionAndFailover(orderId, reason = 'Cobro rechazado en app bancaria o timeout de institución.') {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error('Orden no encontrada para ejecutar failover.');
    }
    const previousClabe = order.clabe;
    const previousBank = order.bankName;

    const alternate =
      this.clabes.find((c) => c.clabe !== previousClabe && c.bankPrefix !== previousClabe.slice(0, 3)) ||
      this.clabes.find((c) => c.clabe !== previousClabe) ||
      this.clabes[0];

    order.failoverHistory.push({
      fromClabe: previousClabe,
      fromBank: previousBank,
      toClabe: alternate.clabe,
      toBank: alternate.bankName,
      reason,
      timestamp: Date.now(),
    });

    order.clabeId = alternate.id;
    order.clabe = alternate.clabe;
    order.holderName = alternate.holderName;
    order.bankName = alternate.bankName;
    order.bankAccountId = alternate.bankAccountId;
    order.status = 'FAILOVER_READY_RETRY';
    order.expiresAt = Date.now() + 180 * 1000;

    this.metrics.failoversExecuted += 1;
    this._broadcastState('order.failover', order);
    return this.toPublicOrder(order);
  }

  /**
   * Construye y despacha un webhook firmado con Standard Webhooks (HMAC-SHA256) para una orden.
   */
  simulateSignedWebhookForOrder(orderId, scenario = 'SUCCESS') {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error('Orden no encontrada.');
    }

    if (scenario === 'BANK_REJECT') {
      return this.triggerBankRejectionAndFailover(orderId);
    }

    let datePaid = Math.floor(Date.now() / 1000);
    if (scenario === 'LATE_PAYMENT') {
      order.expiresAt = Date.now() - 10000;
      datePaid = Math.floor((order.expiresAt + 5000) / 1000);
    }

    const eventType =
      order.method === 'PUSH' ? 'codi.pn.payment_received' : 'codi.qr.payment_received';
    const transactionId =
      scenario === 'DUPLICATE_REPLAY' && order.transactionId
        ? order.transactionId
        : `01M3QR${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

    const webhookPayload = {
      amount: order.amount,
      apiKeyId: '01M3QMMR6X9CBVDY1SF3G8QWNW',
      bankAccountId: order.bankAccountId,
      ...(order.method === 'QR' ? { codiQrId: order.codiQrId || '35a13c183a' } : {}),
      concept: order.concept,
      datePaid,
      metadata: {
        clabe: order.clabe,
        bankCode: Number(`40${order.clabe.slice(0, 3)}`),
        accountType: 40,
        description: order.concept,
        trackingKey: `CODI-${order.numRef}`,
        externalMetadata: {
          orderId: order.orderId,
          station: order.station,
        },
      },
      numRef: String(order.numRef),
      transactionId,
      type: eventType,
    };

    const rawBody = JSON.stringify(webhookPayload);
    const webhookId =
      scenario === 'DUPLICATE_REPLAY' && order.lastWebhookId
        ? order.lastWebhookId
        : `msg_${crypto.randomBytes(8).toString('hex')}`;

    order.lastWebhookId = webhookId;
    const headers = signStandardWebhook(rawBody, this.peyClient.webhookSecret, webhookId);
    return this.processWebhook(rawBody, headers);
  }

  /**
   * Configura o reinicia una sesión de Vaquita Split-Pay con participantes personalizados.
   */
  resetSplitSession(custom = {}) {
    this.splitSession = this._createInitialSplitSession(custom);
    this._broadcastState('split.reset', this.splitSession);
    return this.splitSession;
  }

  /**
   * Actualiza cada segundo los contadores de los casilleros/sesiones activas.
   */
  tickTimers() {
    const now = Date.now();
    let changed = false;
    for (const locker of Object.values(this.lockers)) {
      if (locker.status === 'UNLOCKED_ACTIVE' && locker.unlockedUntil) {
        const remaining = Math.max(0, Math.ceil((locker.unlockedUntil - now) / 1000));
        if (remaining !== locker.remainingSeconds) {
          locker.remainingSeconds = remaining;
          changed = true;
        }
        if (remaining === 0) {
          locker.status = 'LOCKED_IDLE';
          locker.activeOrderId = null;
          locker.unlockedUntil = null;
          changed = true;
        }
      }
    }
    if (changed) {
      this._broadcastState('timers.tick', this.lockers);
    }
  }

  _pushWebhookLog(entry) {
    this.webhookLogs.unshift(entry);
    if (this.webhookLogs.length > 40) {
      this.webhookLogs.length = 40;
    }
  }

  _broadcastState(eventName, detail) {
    if (eventName !== 'timers.tick') {
      this._savePersistedState();
    }
    this.emit('state_change', {
      event: eventName,
      detail,
      snapshot: this.getSnapshot(),
    });
  }

  /**
   * Vista de la orden sin secretos: el PIN y el claimToken solo los conoce quien creó la orden.
   */
  toPublicOrder(order) {
    const { otpCode: _otp, claimToken: _claim, lastWebhookId: _wh, ...rest } = order;
    return rest;
  }

  /**
   * Entrega el PIN de una orden pagada solo a quien presenta el claimToken recibido al crearla.
   */
  getOrderOtp(orderId, claimToken) {
    const order = this.orders.get(orderId);
    const provided = Buffer.from(String(claimToken || ''), 'utf8');
    const expected = Buffer.from(String(order?.claimToken || ''), 'utf8');
    if (!order || !expected.length || provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      throw Object.assign(new Error('Token de orden inválido.'), { statusCode: 403 });
    }
    return { orderId, status: order.status, otpCode: order.status === 'OTP_ISSUED' ? order.otpCode : null };
  }

  getSnapshot() {
    return {
      peyStatus: this.peyClient.getPublicStatus(),
      clabes: this.clabes,
      posCatalog: this.posCatalog,
      metrics: this.metrics,
      liveStudio: this.liveStudio,
      lockers: this.lockers,
      splitSession: this.splitSession,
      sponsoredMeals: this.sponsoredMeals,
      orders: Array.from(this.orders.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 30)
        .map((o) => this.toPublicOrder(o)),
      vouchers: Array.from(this.vouchers.values()),
      webhookLogs: this.webhookLogs.slice(0, 30),
    };
  }
}

module.exports = {
  PeyEngine,
};
