/**
 * Cuentas CLABE operativas preconfiguradas para recepción CoDi en pey.mx
 * Incluye validación algorítmica del dígito verificador de Banxico (ponderación 3-7-1).
 */

const BANK_CODES = {
  '002': { name: 'Citibanamex', banxicoCode: 40002, color: '#004B87', accent: '#00A9E0' },
  '012': { name: 'BBVA México', banxicoCode: 40012, color: '#072146', accent: '#2DCCCD' },
  '014': { name: 'Santander México', banxicoCode: 40014, color: '#EC0000', accent: '#FF4D4D' },
  '021': { name: 'HSBC México', banxicoCode: 40021, color: '#DB0011', accent: '#FF6B6B' },
  '072': { name: 'Banorte', banxicoCode: 40072, color: '#EB0029', accent: '#FF5252' },
  '127': { name: 'Banco Azteca', banxicoCode: 40127, color: '#006341', accent: '#10B981' },
  '138': { name: 'ABC Capital / Ualá', banxicoCode: 40138, color: '#3B82F6', accent: '#60A5FA' },
  '646': { name: 'STP (Sistema de Transferencias y Pagos)', banxicoCode: 90646, color: '#0F172A', accent: '#38BDF8' },
  '722': { name: 'Mercado Pago W', banxicoCode: 40722, color: '#009EE3', accent: '#38BDF8' },
};

const PREAUTHORIZED_CLABES = [
  {
    id: 'acc_ramon_bbva',
    holderName: 'Ramón Orraca',
    clabe: '012180015826225713',
    bankPrefix: '012',
    bankName: 'BBVA México',
    banxicoCode: 40012,
    role: 'PeyStudio · Audio Colectivo & Lienzo',
    station: 'synth',
    codiStatus: 'ACTIVE',
    bankAccountId: '01JPEYRAMON01218001582622',
  },
  {
    id: 'acc_santiago_bbva',
    holderName: 'Santiago Tena',
    clabe: '012180015913466252',
    bankPrefix: '012',
    bankName: 'BBVA México',
    banxicoCode: 40012,
    role: 'Smart Lockers & Cabinas de Tiempo',
    station: 'locker',
    codiStatus: 'ACTIVE',
    bankAccountId: '01JPEYSANTI01218001591346',
  },
  {
    id: 'acc_adrian_santander',
    holderName: 'Adrian Soto',
    clabe: '014180606004536217',
    bankPrefix: '014',
    bankName: 'Santander México',
    banxicoCode: 40014,
    role: 'Vaquita Split-Pay & Conciliación',
    station: 'split',
    codiStatus: 'ACTIVE',
    bankAccountId: '01JPEYADRIA01418060600453',
  },
  {
    id: 'acc_miriam_bbva',
    holderName: 'Miriam Nava',
    clabe: '012180015355682429',
    bankPrefix: '012',
    bankName: 'BBVA México',
    banxicoCode: 40012,
    role: 'Punto de Venta (POS) & Entregas con PIN',
    station: 'pos',
    codiStatus: 'ACTIVE',
    bankAccountId: '01JPEYMIRIA01218001535568',
  },
  {
    id: 'acc_david_azteca',
    holderName: 'David Perez',
    clabe: '127180016558860385',
    bankPrefix: '127',
    bankName: 'Banco Azteca',
    banxicoCode: 40127,
    role: 'Comedor Solidario & Respaldo Multi-Banco',
    station: 'meals',
    codiStatus: 'ACTIVE',
    bankAccountId: '01JPEYDAVID12718001655886',
  },
];

/**
 * Calcula el dígito verificador esperado para los primeros 17 dígitos de una CLABE según Banxico (3-7-1).
 * @param {string} first17
 * @returns {number | null}
 */
function computeClabeCheckDigit(first17) {
  if (typeof first17 !== 'string' || !/^\d{17}$/.test(first17)) {
    return null;
  }
  const weights = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const digit = Number(first17[i]);
    const weight = weights[i % 3];
    sum += (digit * weight) % 10;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Valida una CLABE de 18 dígitos incluyendo el dígito verificador de Banxico (ponderación 3-7-1).
 * @param {string} clabe
 * @returns {{ valid: boolean, reason?: string, bankName?: string, banxicoCode?: number, expectedCheckDigit?: number }}
 */
function validateClabe(clabe) {
  if (typeof clabe !== 'string' || !/^\d{18}$/.test(clabe)) {
    return { valid: false, reason: 'La CLABE debe contener exactamente 18 dígitos numéricos.' };
  }
  const expectedCheckDigit = computeClabeCheckDigit(clabe.slice(0, 17));
  const actualCheckDigit = Number(clabe[17]);
  if (expectedCheckDigit !== actualCheckDigit) {
    return {
      valid: false,
      expectedCheckDigit,
      reason: `Dígito verificador inválido (esperado ${expectedCheckDigit}, recibido ${actualCheckDigit}).`,
    };
  }
  const prefix = clabe.slice(0, 3);
  const bankInfo = BANK_CODES[prefix] || {
    name: `Institución SPEI/CoDi (${prefix})`,
    banxicoCode: Number(`40${prefix}`),
  };
  return {
    valid: true,
    bankName: bankInfo.name,
    banxicoCode: bankInfo.banxicoCode,
    expectedCheckDigit,
  };
}

module.exports = {
  BANK_CODES,
  PREAUTHORIZED_CLABES,
  computeClabeCheckDigit,
  validateClabe,
};
