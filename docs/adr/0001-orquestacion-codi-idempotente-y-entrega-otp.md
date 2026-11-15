# 1. Orquestación CoDi idempotente y separación de pago y entrega mediante PIN OTP

Fecha: 2026-11-15
Estado: Aceptado

## Contexto

Los cobros digitales CoDi (`codi/qr` y `codi/pn`) liquidan transferencias en segundos sin comisión por transacción, lo que habilita micropagos desde $0.01 MXN. Sin embargo, al conectar pagos reales con acciones físicas o digitales automáticas surgen cuatro riesgos operativos:

1. Reintentos de red o entregas duplicadas del webhook pueden disparar dos veces la misma orden.
2. Un pago puede confirmarse en el banco después de que expiró el turno o la reservación local.
3. La confirmación de un pago demuestra que los fondos llegaron a la cuenta CLABE, pero no autentica la identidad de quien recoge un pedido o abre un casillero.
4. Una cuenta receptora o institución bancaria puede presentar intermitencias o rechazos.

## Decisión

Implementamos `PeyEngine` (`src/engine/peyEngine.js`) y `PeyClient` (`src/services/peyClient.js`) con cuatro mecanismos deterministas:

1. **Verificación Standard Webhooks e idempotencia en servidor**: `verifyStandardWebhook` valida la firma `HMAC-SHA256` (`webhook-signature`, `webhook-timestamp`, `webhook-id`) usando `crypto.timingSafeEqual`. `processWebhook` registra cada `webhook-id` y `transactionId` en conjuntos atómicos; cualquier reintento responde `200 OK` (`DUPLICATE_IGNORED`) sin volver a ejecutar efectos secundarios.
2. **Separación entre pago y entrega con OTP de un solo uso**: al confirmarse un pago dentro de su ventana de vigencia, la orden pasa a `OTP_ISSUED` y genera un PIN de 6 dígitos. El desbloqueo del casillero o la entrega de comida requiere invocar `verifyDeliveryOtp`, que quema el PIN y transiciona la orden a `DELIVERED`.
3. **Compensación automática de pagos tardíos**: si `datePaid` supera `expiresAt`, la orden cambia a `LATE_PAYMENT_VOUCHER_ISSUED` y genera un voucher `VCHR-*` firmado con HMAC para reembolso o reasignación de saldo.
4. **Failover multi-CLABE**: `triggerBankRejectionAndFailover` reasigna la orden hacia una cuenta CLABE pre-autorizada de otra institución bancaria cuando ocurre un rechazo o falla.

## Consecuencias

- Las estaciones en vivo (PeyStudio, Smart Lockers, Vaquita Split-Pay y Comedor Solidario) reaccionan en tiempo real mediante Server-Sent Events (`/api/events`) únicamente ante eventos verificados por el servidor.
- Los casilleros y entregas quedan protegidos frente a suplantación o ataques de repetición.
- El sistema opera tanto conectado a `https://api.pey.mx` como en modo local firmando sus propios webhooks de prueba con la misma ruta criptográfica.
