# ⚡ PeyOS Live — Orquestador CoDi ($0.01 MXN), Gemelo Digital IoT & Estudio Colectivo en Tiempo Real

Proyecto desarrollado para el **Cursor Hackatón México · Ciudad de México** integrando la API de **[pey.mx](https://docs.pey.mx)** (`POST /codi/qr`, `POST /codi/pn`, `POST /bank-account` y `Standard Webhooks` firmados con HMAC-SHA256).

---

## 🎯 Qué resuelve y por qué destaca con CoDi ($0.01 MXN)

En México las pasarelas tradicionales de tarjeta hacen inviables los micropagos por sus comisiones fijas (~$3.50 MXN + IVA), y las transferencias SPEI manuales sufren de capturas falsas y conciliación manual. **PeyOS Live** demuestra cómo **un cobro CoDi de $0.01 MXN confirmado desde el servidor** dispara en milisegundos acciones físicas, creativas y financieras verificables:

1. **🎵 Estación 1 — Experiencias para una Demo en Vivo (#11, #12, #13, #15):**
   - **Sintetizador Colectivo Web Audio API:** Cada pago de `$0.01 MXN` activa pistas musicales reales en el navegador (Bassline 303, Arpegio Cyberpunk, Batería Synthwave, Pad Espacial) y acelera el BPM.
   - **Mural Colectivo & Historia IA:** Agrega baldosas con dedicatoria al mural compartido y vota con dinero el siguiente giro narrativo.
2. **🔐 Estación 2 — Servicios que se Activan Solos / Gemelo Digital IoT (#8, #9, #10):**
   - **Casillero de Recogida (`LOCKER-A1`), Cabina IA (`POD-CARGA-B2`) y Sala Pro (`SALA-API-C3`):** Etiquetados explícitamente como *Equipo Simulado (Gemelo Digital IoT)*.
   - **Separación Pago ≠ Identidad/Entrega:** Cuando llega el webhook de `pey.mx`, el servidor **no abre la cerradura a ciegas**: emite un **PIN OTP de un solo uso (6 dígitos)** que el usuario valida en la terminal para liberar el solenoide e iniciar el temporizador en vivo.
3. **🤝 Estación 3 — Coordinación y Control para Negocios (#16, #17, #19):**
   - **Vaquita Split-Pay Multi-CLABE:** Divide una cuenta entre 3 participantes pagando `$0.01 MXN` cada uno a distintas instituciones (BBVA `012`, Santander `014`, Banco Azteca `127`). Concilia automáticamente cada pago por `numRef` y detiene recordatorios sin sumar comprobantes a mano.
4. **🌮 Estación 4 — Negocios que Cobran y Entregan (#1, #2, #5, #20):**
   - **POS WhatsApp Cero Capturas Falsas & Comidas Patrocinadas:** Separa en tiempo real *Comidas Financiadas* vs *Comidas Entregadas* mediante validación de OTP al entregar.

---

## 🛡️ Cumplimiento de todos los escenarios técnicos de la rúbrica

| Regla de la hoja del Hackatón | Implementación en PeyOS Live |
| :--- | :--- |
| **Del QR a la solicitud de pago (`/codi/qr` y `/codi/pn`)** | Soporta generación de QR CoDi escaneable y envío de notificación push directa al celular de 10 dígitos. |
| **Confirmar desde servidor y evitar doble ejecución** | Verificación criptográfica **Standard Webhooks (`HMAC-SHA256`)** y deduplicación atómica por `webhook-id` y `transactionId`. Los reintentos devuelven `200 OK` pero bloquean la segunda ejecución. |
| **Un pago no prueba identidad ni entrega** | El webhook cambia el estado a `OTP_ISSUED` y genera un PIN único de 6 dígitos (`verifyDeliveryOtp`). Una vez usado para abrir el casillero o entregar la comida, el PIN se quema (`DELIVERED`). |
| **Pagos tardíos, fallas y devoluciones** | Si el webhook llega después de `expiresAt`, la orden pasa a `LATE_PAYMENT_VOUCHER_ISSUED` y emite un **Voucher Criptográfico (`VCHR-...`)** firmado por el servidor. Si un banco rechaza o falla, ejecuta **Failover Multi-CLABE** automático hacia otro banco. |
| **Si simulas equipo, indícalo en la demo** | El módulo de Smart Lockers y Tiempo de Uso incluye el badge visible `⚠️ Equipo Simulado (Gemelo Digital IoT)` y un panel de pruebas de 1 clic para el jurado. |

---

## 🏦 Cuentas CLABE Pre-Autorizadas Incluidas (Imagen 2)

Todas las cuentas pre-autorizadas del hackatón están precargadas y validadas con el algoritmo de dígito verificador de Banxico (ponderación `3-7-1`):

| Titular | CLABE (18 dígitos) | Banco | Rol en PeyOS Live |
| :--- | :--- | :--- | :--- |
| **Ramón Orraca** | `012180015826225713` | BBVA México (`012`) | Estación 1 · Live Synth & Mural IA |
| **Santiago Tena** | `012180015913466252` | BBVA México (`012`) | Estación 2 · Smart Locker & Tiempo IoT |
| **Adrian Soto** | `014180606004536217` | Santander (`014`) | Estación 3 · Vaquita Split-Pay |
| **Miriam Nava** | `012180015355682429` | BBVA México (`012`) | Estación 4 · POS WhatsApp & Entrega OTP |
| **David Perez** | `127180016558860385` | Banco Azteca (`127`) | Estación 5 · Comidas Patrocinadas & Failover |

---

## 🚀 Cómo ejecutar y probar localmente en 30 segundos

```bash
npm install
npm test
npm start
```

Abre `http://localhost:3000` en tu navegador.
- Para conectar tu API Key en vivo de `portal.mipey.mx`, haz clic en **"🔑 Configurar API Key Pey"** en la barra superior o define `PEY_API_KEY` y `PEY_WEBHOOK_SECRET` en tu archivo `.env`.
- Endpoint para configurar en la sección Desarrollador de Pey: `POST /api/webhooks/pey` (también escucha en `POST /codi/pn`).
