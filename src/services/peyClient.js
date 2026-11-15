const crypto = require('node:crypto');
const QRCode = require('qrcode');

const DEFAULT_BASE_URL = process.env.PEY_API_BASE_URL || 'https://api.pey.mx';
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

// Sin secreto configurado se usa uno aleatorio por proceso: nadie externo puede firmar webhooks válidos.
function randomWebhookSecret() {
  return `whsec_${crypto.randomBytes(24).toString('base64')}`;
}

/**
 * Standard Webhooks: el secreto es base64 después del prefijo whsec_.
 * @param {string} secret
 * @returns {Buffer}
 */
function resolveSecretKey(secret) {
  if (!secret) {
    throw new Error('Falta el secreto de webhooks.');
  }
  return Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
}

/**
 * Firma un payload siguiendo el estándar Standard Webhooks usado por pey.mx.
 * Formato firmado: "${webhookId}.${timestamp}.${rawBody}"
 */
function signStandardWebhook(rawBody, secret, webhookId, timestamp) {
  const msgId = webhookId || `msg_${crypto.randomBytes(10).toString('hex')}`;
  const ts = String(timestamp || Math.floor(Date.now() / 1000));
  const payloadToSign = `${msgId}.${ts}.${rawBody}`;
  const hmac = crypto.createHmac('sha256', resolveSecretKey(secret)).update(payloadToSign).digest('base64');
  return {
    'webhook-id': msgId,
    'webhook-timestamp': ts,
    'webhook-signature': `v1,${hmac}`,
  };
}

/**
 * Verifica la autenticidad de un webhook entrante según Standard Webhooks.
 * @param {string} rawBody
 * @param {Record<string, string | undefined>} headers
 * @param {string} secret
 * @returns {{ valid: boolean, webhookId: string, reason?: string }}
 */
function verifyStandardWebhook(rawBody, headers, secret) {
  const webhookId = headers['webhook-id'] || headers['svix-id'] || '';
  const timestamp = headers['webhook-timestamp'] || headers['svix-timestamp'] || '';
  const signatureHeader = headers['webhook-signature'] || headers['svix-signature'] || '';

  if (!webhookId) {
    return { valid: false, webhookId: '', reason: 'Falta cabecera obligatoria webhook-id (idempotencia).' };
  }

  if (!signatureHeader || !timestamp) {
    return {
      valid: false,
      webhookId,
      reason: 'Faltan cabeceras de firma Standard Webhooks (webhook-timestamp / webhook-signature).',
    };
  }

  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > TIMESTAMP_TOLERANCE_SECONDS) {
    return { valid: false, webhookId, reason: 'webhook-timestamp fuera de la ventana permitida (posible replay).' };
  }

  const expected = signStandardWebhook(rawBody, secret, webhookId, timestamp)['webhook-signature'];
  const providedSignatures = signatureHeader.split(' ');

  const expectedBuf = Buffer.from(expected, 'utf8');
  for (const candidate of providedSignatures) {
    const candidateBuf = Buffer.from(candidate.trim(), 'utf8');
    if (
      candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf)
    ) {
      return { valid: true, webhookId };
    }
  }

  return { valid: false, webhookId, reason: 'Firma criptográfica Standard Webhooks inválida (HMAC mismatch).' };
}

/**
 * Construye una cadena JSON compatible con el estándar CoDi de Banxico para generación de QR.
 */
function buildSyntheticCodiQrString({ idc, amount, concept, numRef, clabe }) {
  return JSON.stringify({
    TYP: 20,
    v: { DEV: '29442719514356328159/0', AMO: Number(amount), CON: concept, REF: String(numRef) },
    ic: {
      IDC: idc,
      SER: 996909821,
      CLABE: clabe,
      ENC: crypto.createHash('sha256').update(`${idc}:${clabe}:${numRef}`).digest('base64'),
    },
    CRY: crypto.createHash('sha256').update(`banxico:${idc}`).digest('base64'),
  });
}

class PeyClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = options.apiKey || process.env.PEY_API_KEY || '';
    this.webhookSecret = options.webhookSecret || process.env.PEY_WEBHOOK_SECRET || randomWebhookSecret();
    this.defaultBankAccountId = options.defaultBankAccountId || process.env.PEY_DEFAULT_BANK_ACCOUNT_ID || '';
  }

  isLiveConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 6);
  }

  setRuntimeCredentials({ apiKey, webhookSecret, defaultBankAccountId }) {
    if (typeof apiKey === 'string') {
      this.apiKey = apiKey.trim();
    }
    if (typeof webhookSecret === 'string' && webhookSecret.trim()) {
      this.webhookSecret = webhookSecret.trim();
    }
    if (typeof defaultBankAccountId === 'string') {
      this.defaultBankAccountId = defaultBankAccountId.trim();
    }
  }

  getPublicStatus() {
    return {
      mode: this.isLiveConfigured() ? 'LIVE_PEY_API' : 'LOCAL_CODI_ENGINE',
      baseUrl: this.baseUrl,
      hasApiKey: this.isLiveConfigured(),
      maskedApiKey: this.isLiveConfigured()
        ? `${this.apiKey.slice(0, 4)}...${this.apiKey.slice(-4)}`
        : null,
      webhookStandard: 'Standard Webhooks (HMAC-SHA256)',
    };
  }

  /**
   * POST autenticado a api.pey.mx. En modo LIVE un fallo es error 502: nunca se cae a datos locales,
   * porque un QR local no se puede pagar.
   */
  async _liveRequest(endpoint, payload) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (_err) {
      throw Object.assign(new Error(`api.pey.mx no respondió (${endpoint}).`), { statusCode: 502 });
    }
    if (!res.ok) {
      throw Object.assign(new Error(`api.pey.mx respondió ${res.status} (${endpoint}).`), { statusCode: 502 });
    }
    return res.json();
  }

  /**
   * Crea un código QR de CoDi vía POST https://api.pey.mx/codi/qr
   */
  async createCodiQr({ amount = 0.01, concept, expiration = 180, numRef, bankAccountId, clabe }) {
    const cleanRef = String(numRef || Math.floor(10000 + Math.random() * 90000)).slice(0, 7);
    const payload = {
      amount: Number(amount),
      concept: String(concept || 'PeyOS Cobro CoDi').slice(0, 40),
      expiration: Number(expiration),
      numRef: cleanRef,
    };

    const resolvedBankAccountId = bankAccountId || this.defaultBankAccountId;
    if (resolvedBankAccountId) {
      payload.bankAccountId = resolvedBankAccountId;
    }

    if (this.isLiveConfigured()) {
      const data = await this._liveRequest('/codi/qr', payload);
      const qrString = data.qrString || JSON.stringify(data);
      const qrDataUrl = await QRCode.toDataURL(qrString, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280,
      });
      return {
        source: 'LIVE_PEY_API',
        codiQrId: data.id || `35${crypto.randomBytes(4).toString('hex')}`,
        qrString,
        qrDataUrl,
        requestPayload: payload,
      };
    }

    const codiQrId = `35${crypto.randomBytes(4).toString('hex')}`;
    const qrString = buildSyntheticCodiQrString({
      idc: codiQrId,
      amount: payload.amount,
      concept: payload.concept,
      numRef: cleanRef,
      clabe: clabe || '012180015826225713',
    });
    const qrDataUrl = await QRCode.toDataURL(qrString, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
    });

    return {
      source: 'LOCAL_CODI_ENGINE',
      codiQrId,
      qrString,
      qrDataUrl,
      requestPayload: payload,
    };
  }

  /**
   * Envía una notificación push CoDi directa al celular vía POST https://api.pey.mx/codi/pn
   */
  async createCodiPushNotification({ amount = 0.01, concept, phone, numRef, bankAccountId }) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      throw new Error('El número celular para CoDi Push (/codi/pn) debe tener exactamente 10 dígitos.');
    }
    const cleanRef = String(numRef || Math.floor(10000 + Math.random() * 90000)).slice(0, 7);
    const payload = {
      amount: Number(amount),
      concept: String(concept || 'PeyOS Cobro CoDi').slice(0, 40),
      phone: cleanPhone,
      numRef: cleanRef,
    };

    const resolvedBankAccountId = bankAccountId || this.defaultBankAccountId;
    if (resolvedBankAccountId) {
      payload.bankAccountId = resolvedBankAccountId;
    }

    if (this.isLiveConfigured()) {
      const data = await this._liveRequest('/codi/pn', payload);
      return {
        source: 'LIVE_PEY_API',
        pushId: data.id || `pn_${crypto.randomBytes(5).toString('hex')}`,
        phone: cleanPhone,
        requestPayload: payload,
        apiResponse: data,
      };
    }

    return {
      source: 'LOCAL_CODI_ENGINE',
      pushId: `pn_${crypto.randomBytes(5).toString('hex')}`,
      phone: cleanPhone,
      requestPayload: payload,
      apiResponse: { status: 'DISPATCHED', phone: cleanPhone, numRef: cleanRef },
    };
  }

  /**
   * Registra una cuenta bancaria (CLABE) vía POST https://api.pey.mx/bank-account
   */
  async registerBankAccount({ clabe, holderName }) {
    const payload = { clabe, holderName };
    if (this.isLiveConfigured()) {
      const data = await this._liveRequest('/bank-account', payload);
      return { source: 'LIVE_PEY_API', ...data };
    }
    return {
      source: 'LOCAL_CODI_ENGINE',
      id: `01JPEY${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
      clabe,
      holderName,
      codiStatus: 'ACTIVE',
    };
  }
}

module.exports = {
  PeyClient,
  signStandardWebhook,
  verifyStandardWebhook,
  buildSyntheticCodiQrString,
};
