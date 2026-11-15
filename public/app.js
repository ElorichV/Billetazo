(() => {
  let currentState = null;
  let selectedOrderId = null;
  let activeTab = 'pos';
  let kioskPinBuffer = '';
  let kioskOrderId = null;

  // =========================================================================
  // MOTOR WEB AUDIO API + ANALYSER CANVAS EN TIEMPO REAL
  // =========================================================================
  const synthAudio = {
    ctx: null,
    analyser: null,
    enabled: false,
    stepTimer: null,
    stepIndex: 0,
    animFrame: null,

    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
          this.analyser = this.ctx.createAnalyser();
          this.analyser.fftSize = 128;
          this.analyser.connect(this.ctx.destination);
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    },

    destinationNode() {
      return this.analyser || (this.ctx ? this.ctx.destination : null);
    },

    playPaymentChime() {
      this.ensureContext();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const freqs = [523.25, 659.25, 783.99, 1046.5];
      freqs.forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now + idx * 0.055);
        gain.gain.setValueAtTime(0.07, now + idx * 0.055);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.055 + 0.24);
        osc.connect(gain);
        gain.connect(this.destinationNode());
        osc.start(now + idx * 0.055);
        osc.stop(now + idx * 0.055 + 0.25);
      });
    },

    playUnlockSound() {
      this.ensureContext();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      [440, 880].forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now + i * 0.08);
        gain.gain.setValueAtTime(0.08, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.18);
        osc.connect(gain);
        gain.connect(this.destinationNode());
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.2);
      });
    },

    toggle() {
      this.enabled = !this.enabled;
      if (this.enabled) {
        this.ensureContext();
        this.startLoop();
        this.startVisualizer();
      } else {
        this.stopLoop();
      }
      return this.enabled;
    },

    startLoop() {
      this.stopLoop();
      const bpm = currentState?.liveStudio?.bpm || 124;
      const intervalMs = Math.max(110, Math.round((60 / bpm / 2) * 1000));
      this.stepTimer = setInterval(() => {
        if (!this.enabled || !this.ctx || !currentState) return;
        const tracks = currentState.liveStudio.activeTracks || {};
        const step = this.stepIndex % 8;
        const now = this.ctx.currentTime;

        // Resaltar visualmente el paso activo en el secuenciador
        document.querySelectorAll('.seq-pad').forEach((pad) => {
          const padStep = Number(pad.getAttribute('data-step'));
          pad.classList.toggle('playing-step', padStep === step);
        });

        const bass = tracks.bass_303;
        if (bass?.active && (bass.steps ? bass.steps[step] : step % 2 === 0)) {
          const notes = [110, 110, 130.81, 98, 110, 146.83, 130.81, 98];
          this._tone(notes[step], 'sawtooth', 0.055, 0.15, now);
        }

        const arp = tracks.cyber_arp;
        if (arp?.active && (arp.steps ? arp.steps[step] : true)) {
          const notes = [440, 523.25, 659.25, 880, 659.25, 523.25, 783.99, 659.25];
          this._tone(notes[step], 'square', 0.035, 0.11, now);
        }

        const drums = tracks.neon_drums;
        if (drums?.active && (drums.steps ? drums.steps[step] : step % 2 === 0)) {
          this._tone(68, 'sine', 0.1, 0.13, now);
        }

        const padTrack = tracks.chord_pad;
        if (padTrack?.active && (padTrack.steps ? padTrack.steps[step] : step === 0)) {
          const chordNotes = [261.63, 329.63, 392.0, 523.25, 329.63, 392.0, 493.88, 523.25];
          this._tone(chordNotes[step], 'triangle', 0.04, 0.35, now);
        }

        this.stepIndex += 1;
      }, intervalMs);
    },

    stopLoop() {
      if (this.stepTimer) {
        clearInterval(this.stepTimer);
        this.stepTimer = null;
      }
      document.querySelectorAll('.seq-pad.playing-step').forEach((el) => {
        el.classList.remove('playing-step');
      });
    },

    _tone(freq, type, vol, dur, now) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(gain);
      gain.connect(this.destinationNode());
      osc.start(now);
      osc.stop(now + dur + 0.01);
    },

    startVisualizer() {
      const canvas = document.getElementById('audio-visualizer');
      if (!canvas) return;
      const c2d = canvas.getContext('2d');
      const bufferLength = this.analyser ? this.analyser.frequencyBinCount : 32;
      const dataArray = new Uint8Array(bufferLength);

      const draw = () => {
        this.animFrame = requestAnimationFrame(draw);
        const w = canvas.width;
        const h = canvas.height;
        c2d.fillStyle = '#050811';
        c2d.fillRect(0, 0, w, h);

        if (this.analyser && this.enabled) {
          this.analyser.getByteFrequencyData(dataArray);
        } else {
          for (let i = 0; i < bufferLength; i++) {
            dataArray[i] = 10 + Math.sin(Date.now() / 450 + i * 0.4) * 8;
          }
        }

        const barWidth = (w / bufferLength) * 0.82;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 255;
          const barHeight = Math.max(4, v * (h - 14));
          const grad = c2d.createLinearGradient(0, h, 0, h - barHeight);
          grad.addColorStop(0, '#10b981');
          grad.addColorStop(0.6, '#06b6d4');
          grad.addColorStop(1, '#6366f1');
          c2d.fillStyle = grad;
          c2d.fillRect(x, h - barHeight, barWidth, barHeight);
          x += w / bufferLength;
        }
      };

      if (!this.animFrame) {
        draw();
      }
    },
  };

  // =========================================================================
  // UTILIDADES GENERALES
  // =========================================================================
  function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  let adminToken = '';

  async function apiPost(url, body = {}, extraHeaders = {}) {
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (adminToken) headers['x-admin-token'] = adminToken;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.status === 403 && !adminToken) {
      const token = window.prompt('Token de administrador para esta acción:');
      if (token) {
        adminToken = token.trim();
        return apiPost(url, body, extraHeaders);
      }
    }
    if (res.status === 403) adminToken = '';
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || data.reason || 'Error en la operación.');
    }
    if (data.claimToken && data.order?.orderId) {
      orderClaims.set(data.order.orderId, data.claimToken);
    }
    return data;
  }

  // El servidor no publica PINs: cada navegador pide solo los de las órdenes que creó.
  const orderClaims = new Map();
  const orderOtps = new Map();
  const otpRequests = new Map();

  function claimOtp(orderId) {
    if (orderOtps.has(orderId)) return Promise.resolve(orderOtps.get(orderId));
    const claimToken = orderClaims.get(orderId);
    if (!claimToken) return Promise.resolve(null);
    if (!otpRequests.has(orderId)) {
      const request = fetch(`/api/orders/${encodeURIComponent(orderId)}/otp`, {
        headers: { 'x-claim-token': claimToken },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.otpCode) orderOtps.set(orderId, data.otpCode);
          return data.otpCode || null;
        })
        .catch(() => null)
        .finally(() => otpRequests.delete(orderId));
      otpRequests.set(orderId, request);
    }
    return otpRequests.get(orderId);
  }

  function attachOwnOtps(snapshot) {
    const pending = [];
    for (const order of snapshot.orders || []) {
      if (order.status !== 'OTP_ISSUED') continue;
      if (orderOtps.has(order.orderId)) order.otpCode = orderOtps.get(order.orderId);
      else if (orderClaims.has(order.orderId)) pending.push(order.orderId);
    }
    for (const token of snapshot.sponsoredMeals?.availableTokens || []) {
      if (orderOtps.has(token.orderId)) token.otpCode = orderOtps.get(token.orderId);
    }
    for (const locker of Object.values(snapshot.lockers || {})) {
      if (locker.status === 'PAID_WAITING_OTP' && orderOtps.has(locker.activeOrderId)) {
        locker.otpHint = orderOtps.get(locker.activeOrderId);
      }
    }
    if (pending.length) {
      Promise.all(pending.map(claimOtp)).then((otps) => {
        if (otps.some(Boolean) && currentState === snapshot) renderAll(snapshot);
      });
    }
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatClabeReadable(clabe) {
    const s = String(clabe || '');
    if (s.length !== 18) return s;
    return `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 17)} ${s.slice(17)}`;
  }

  function switchTab(tabName) {
    activeTab = tabName;
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      const isMatch = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', String(isMatch));
    });
    document.querySelectorAll('.module-view').forEach((view) => {
      const isMatch = view.id === `view-${tabName}`;
      view.classList.toggle('active', isMatch);
      view.hidden = !isMatch;
    });
  }

  function focusActiveOrderDock() {
    const panel = document.getElementById('active-order-panel');
    if (panel && window.innerWidth < 1180) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // =========================================================================
  // RENDERIZADO COMPLETO DEL ESTADO
  // =========================================================================
  function renderAll(snapshot) {
    currentState = snapshot;
    attachOwnOtps(snapshot);
    renderTopStatus(snapshot.peyStatus);
    renderMetrics(snapshot.metrics);
    renderClabeSelectors(snapshot.clabes);
    renderActiveOrder(snapshot.orders);
    renderPosView(snapshot.posCatalog, snapshot.orders, snapshot.sponsoredMeals);
    renderLockersView(snapshot.lockers, snapshot.orders);
    renderSplitView(snapshot.splitSession, snapshot.clabes);
    renderStudioView(snapshot.liveStudio);
    renderClabesView(snapshot.clabes, snapshot.webhookLogs, snapshot.orders);
  }

  function renderTopStatus(peyStatus) {
    const badge = document.getElementById('api-mode-badge');
    const dot = document.getElementById('api-mode-dot');
    if (!badge || !peyStatus) return;
    if (peyStatus.hasApiKey) {
      badge.textContent = `api.pey.mx (${peyStatus.maskedApiKey})`;
      if (dot) dot.className = 'mode-dot live';
    } else {
      badge.textContent = 'Motor CoDi Local + HMAC';
      if (dot) dot.className = 'mode-dot';
    }
  }

  function renderMetrics(m) {
    if (!m) return;
    document.getElementById('metric-orders').textContent = String(m.totalOrdersCreated);
    document.getElementById('metric-paid').textContent = `${m.totalPaidOrders} ($${Number(m.totalCentavosCollectedMxn).toFixed(2)} MXN)`;
    document.getElementById('metric-duplicates').textContent = String(m.duplicatesBlocked);
    document.getElementById('metric-late').textContent = String(m.latePaymentsHandled);
    document.getElementById('metric-failovers').textContent = String(m.failoversExecuted);
    document.getElementById('metric-otp').textContent = String(m.otpDeliveriesVerified);
  }

  function renderClabeSelectors(clabes) {
    const select = document.getElementById('order-clabe');
    if (!select || !Array.isArray(clabes)) return;
    const currentVal = select.value;
    select.innerHTML = clabes
      .map(
        (c) =>
          `<option value="${escapeHtml(c.id)}">${escapeHtml(c.holderName)} · ${escapeHtml(c.bankName)} (${escapeHtml(c.clabe)})</option>`
      )
      .join('');
    if (currentVal && clabes.some((c) => c.id === currentVal)) {
      select.value = currentVal;
    }
  }

  // =========================================================================
  // TERMINAL DE ORDEN ACTIVA (CHECKOUT DOCK)
  // =========================================================================
  function renderActiveOrder(orders = []) {
    const emptyEl = document.getElementById('active-order-empty');
    const contentEl = document.getElementById('active-order-content');
    const badgeEl = document.getElementById('active-order-badge');

    let order = orders.find((o) => o.orderId === selectedOrderId) || orders[0];
    if (!order) {
      emptyEl.hidden = false;
      contentEl.hidden = true;
      badgeEl.textContent = 'Sin orden';
      return;
    }

    selectedOrderId = order.orderId;
    emptyEl.hidden = true;
    contentEl.hidden = false;
    badgeEl.textContent = order.status;

    document.getElementById('ao-id').textContent = order.orderId;
    document.getElementById('ao-amount').textContent = `$${Number(order.amount).toFixed(2)} MXN`;
    document.getElementById('ao-concept').textContent = order.concept;
    document.getElementById('ao-holder').textContent = order.holderName;
    document.getElementById('ao-bank').textContent = order.bankName;
    document.getElementById('ao-clabe').textContent = order.clabe;
    document.getElementById('ao-ref').textContent = order.numRef;

    const isPaidOrLater = ['OTP_ISSUED', 'DELIVERED', 'PAID'].includes(order.status);
    const isDelivered = order.status === 'DELIVERED';

    document.getElementById('step-created').className = 'step active';
    document.getElementById('step-paid').className = `step ${isPaidOrLater ? 'active' : ''}`;
    document.getElementById('step-otp').className = `step ${order.otpCode ? 'active' : ''}`;
    document.getElementById('step-delivered').className = `step ${isDelivered ? 'active' : ''}`;

    const qrWrapper = document.getElementById('ao-qr-wrapper');
    const pushWrapper = document.getElementById('ao-push-wrapper');
    if (order.method === 'PUSH') {
      qrWrapper.hidden = true;
      pushWrapper.hidden = false;
      document.getElementById('ao-phone').textContent = order.phone || '5512345678';
    } else {
      qrWrapper.hidden = false;
      pushWrapper.hidden = true;
      if (order.qrDataUrl) {
        document.getElementById('ao-qr-img').src = order.qrDataUrl;
      }
    }

    const otpBox = document.getElementById('ao-otp-box');
    if (order.otpCode && order.status === 'OTP_ISSUED') {
      otpBox.hidden = false;
      document.getElementById('ao-otp-code').textContent = order.otpCode;
      const otpInput = document.getElementById('input-verify-otp');
      if (otpInput && otpInput.getAttribute('data-order-id') !== order.orderId) {
        otpInput.value = order.otpCode;
        otpInput.setAttribute('data-order-id', order.orderId);
      }
    } else {
      otpBox.hidden = true;
    }

    const voucherBox = document.getElementById('ao-voucher-box');
    if (order.voucherCode) {
      voucherBox.hidden = false;
      document.getElementById('ao-voucher-code').textContent = order.voucherCode;
    } else {
      voucherBox.hidden = true;
    }

    // Píldoras de órdenes recientes para cambiar rápidamente
    const recentContainer = document.getElementById('recent-orders-pills');
    if (recentContainer) {
      recentContainer.innerHTML = orders
        .slice(0, 6)
        .map(
          (o) => `
          <button type="button" class="order-pill-btn ${o.orderId === selectedOrderId ? 'active' : ''}" data-select-order="${escapeHtml(o.orderId)}">
            #${escapeHtml(o.numRef)} · ${escapeHtml(o.status)}
          </button>
        `
        )
        .join('');
    }
  }

  // =========================================================================
  // VISTA 1: PUNTO DE VENTA (POS) & COMEDOR SOLIDARIO
  // =========================================================================
  function renderPosView(catalog = [], orders = [], meals = {}) {
    document.getElementById('meals-funded').textContent = String(meals.fundedCount || 0);
    document.getElementById('meals-delivered').textContent = String(meals.deliveredCount || 0);
    document.getElementById('meals-available').textContent = String((meals.availableTokens || []).length);

    const catalogGrid = document.getElementById('pos-catalog-grid');
    if (catalogGrid) {
      catalogGrid.innerHTML = catalog
        .map(
          (item) => `
          <article class="pos-item-card">
            <div>
              <div class="pos-item-top">
                <div class="pos-item-icon" aria-hidden="true">${escapeHtml(item.icon)}</div>
                <span class="pos-item-price">$${Number(item.amount).toFixed(2)} MXN</span>
              </div>
              <span class="pos-item-cat">${escapeHtml(item.category)}</span>
              <h4 class="pos-item-title">${escapeHtml(item.name)}</h4>
              <p class="pos-item-desc">${escapeHtml(item.description)}</p>
            </div>
            <div class="pos-item-actions">
              <button
                type="button"
                class="btn btn-primary btn-sm"
                style="flex:1"
                data-pos-order="${escapeHtml(item.id)}"
                data-pos-method="QR"
              >
                📱 Cobrar QR
              </button>
              <button
                type="button"
                class="btn btn-glass btn-sm"
                data-pos-order="${escapeHtml(item.id)}"
                data-pos-method="PUSH"
                title="Enviar cobro Push al celular"
              >
                📲 Push
              </button>
            </div>
          </article>
        `
        )
        .join('');
    }

    // Kanban Columna 1: En Cobro CoDi
    const pendingOrders = orders.filter((o) =>
      ['QR_READY', 'PUSH_SENT', 'FAILOVER_READY_RETRY'].includes(o.status)
    );
    document.getElementById('kanban-count-pending').textContent = String(pendingOrders.length);
    const pendingEl = document.getElementById('kanban-pending-list');
    pendingEl.innerHTML = pendingOrders.length
      ? pendingOrders
          .map(
            (o) => `
          <div class="kanban-ticket">
            <div class="kanban-ticket-top">
              <strong>${escapeHtml(o.concept)}</strong>
              <span class="mono">#${escapeHtml(o.numRef)}</span>
            </div>
            <div class="small-muted">${escapeHtml(o.bankName)} · $${Number(o.amount).toFixed(2)} MXN</div>
            <div style="display:flex; gap:0.4rem; margin-top:0.2rem;">
              <button type="button" class="btn btn-outline btn-xs" data-select-order="${escapeHtml(o.orderId)}">
                Ver QR
              </button>
              <button type="button" class="btn btn-emerald btn-xs" data-confirm-order="${escapeHtml(o.orderId)}">
                Confirmar Pago
              </button>
            </div>
          </div>
        `
          )
          .join('')
      : '<div class="small-muted">No hay cobros pendientes en este momento.</div>';

    // Kanban Columna 2: Pagadas listas para entregar con PIN OTP
    const otpOrders = orders.filter((o) => o.status === 'OTP_ISSUED');
    document.getElementById('kanban-count-otp').textContent = String(otpOrders.length);
    const otpEl = document.getElementById('kanban-otp-list');
    otpEl.innerHTML = otpOrders.length
      ? otpOrders
          .map(
            (o) => `
          <div class="kanban-ticket ready-otp">
            <div class="kanban-ticket-top">
              <strong>${escapeHtml(o.concept)}</strong>
              <code class="mono" style="color:#38bdf8;font-weight:800;">PIN: ${escapeHtml(o.otpCode)}</code>
            </div>
            <div class="small-muted">Pagado en ${escapeHtml(o.bankName)} · Ref #${escapeHtml(o.numRef)}</div>
            <button
              type="button"
              class="btn btn-emerald btn-xs"
              data-deliver-meal="${escapeHtml(o.orderId)}"
              data-otp="${escapeHtml(o.otpCode)}"
            >
              🔓 Validar PIN ${escapeHtml(o.otpCode)} y Entregar
            </button>
          </div>
        `
          )
          .join('')
      : '<div class="small-muted">Ninguna orden esperando entrega por PIN.</div>';

    // Kanban Columna 3: Comidas Patrocinadas Disponibles y Entregadas
    const availableMeals = meals.availableTokens || [];
    const deliveredOrders = orders.filter((o) => o.status === 'DELIVERED');
    document.getElementById('kanban-count-done').textContent = String(
      availableMeals.length + deliveredOrders.length
    );

    const mealsListEl = document.getElementById('meals-list');
    const availableHtml = availableMeals
      .map(
        (t) => `
        <div class="kanban-ticket ready-otp">
          <div class="kanban-ticket-top">
            <strong>🍲 ${escapeHtml(t.token)}</strong>
            <span class="pill-codi">Disponible</span>
          </div>
          <div class="small-muted">Donador: ${escapeHtml(t.donor)} · CLABE ${escapeHtml(t.clabe.slice(-4))}</div>
          ${
            t.orderId && t.otpCode
              ? `<button type="button" class="btn btn-emerald btn-xs" data-deliver-meal="${escapeHtml(t.orderId)}" data-otp="${escapeHtml(t.otpCode)}">
                  Entregar con PIN (${escapeHtml(t.otpCode)})
                </button>`
              : ''
          }
        </div>
      `
      )
      .join('');

    const deliveredHtml = deliveredOrders
      .slice(0, 5)
      .map(
        (o) => `
        <div class="kanban-ticket">
          <div class="kanban-ticket-top">
            <strong>✅ ${escapeHtml(o.concept)}</strong>
            <span class="mono">#${escapeHtml(o.numRef)}</span>
          </div>
          <div class="small-muted">Entregado tras quemar PIN OTP de un solo uso</div>
        </div>
      `
      )
      .join('');

    mealsListEl.innerHTML =
      availableHtml + deliveredHtml ||
      '<div class="small-muted">Aún no hay entregas registradas. Selecciona un producto arriba para iniciar.</div>';
  }

  // =========================================================================
  // VISTA 2: SMART LOCKERS & TERMINAL FÍSICA DE PIN
  // =========================================================================
  function renderLockersView(lockers = {}, orders = []) {
    const grid = document.getElementById('lockers-grid');
    if (!grid) return;

    const lockerArray = Object.values(lockers);
    const activeCount = lockerArray.filter((l) => l.status !== 'LOCKED_IDLE').length;
    const navBadge = document.getElementById('nav-badge-lockers');
    if (navBadge) {
      navBadge.hidden = activeCount === 0;
      navBadge.textContent = String(activeCount);
    }

    grid.innerHTML = lockerArray
      .map((l) => {
        const isUnlocked = l.status === 'UNLOCKED_ACTIVE';
        const isWaitingOtp = l.status === 'PAID_WAITING_OTP';
        const isReserved = l.status === 'RESERVED_WAITING_PAYMENT';
        const stateCls = isUnlocked
          ? 'state-unlocked'
          : isWaitingOtp
            ? 'state-waiting-otp'
            : isReserved
              ? 'state-reserved'
              : '';

        const statusLabel = isUnlocked
          ? '🔓 Compuerta Abierta'
          : isWaitingOtp
            ? '🔑 Pagado · Ingresa PIN'
            : isReserved
              ? '⏳ Esperando Pago CoDi'
              : '🔒 Disponible';

        return `
          <article class="locker-door-card ${stateCls}">
            <div>
              <div class="locker-top-bar">
                <span class="locker-id-badge">${escapeHtml(l.id)}</span>
                <span class="locker-led">${statusLabel}</span>
              </div>
              <div class="locker-visual-center">
                <div class="locker-big-icon" aria-hidden="true">${escapeHtml(l.icon || '🔐')}</div>
                <div>
                  <h3 class="locker-title">${escapeHtml(l.name)}</h3>
                  <p class="locker-subtitle">${escapeHtml(l.subtitle || 'Control por PIN OTP')}</p>
                  <p class="small-muted">Aperturas verificadas: <strong>${l.totalUnlocks}</strong></p>
                </div>
              </div>
            </div>

            ${
              isWaitingOtp && l.otpHint
                ? `<div class="locker-otp-banner">
                    <span>PIN Emitido: <strong class="mono">${escapeHtml(l.otpHint)}</strong></span>
                    <button
                      type="button"
                      class="btn btn-emerald btn-xs"
                      data-load-kiosk-pin="${escapeHtml(l.otpHint)}"
                      data-kiosk-order="${escapeHtml(l.activeOrderId || '')}"
                      data-kiosk-name="${escapeHtml(l.name)}"
                    >
                      Usar en Teclado →
                    </button>
                  </div>`
                : ''
            }

            ${
              isUnlocked
                ? `<div class="locker-timer-display">
                    <div>
                      <span class="meta-kicker">Sesión Activa</span>
                      <span class="timer-countdown">⏱️ ${l.remainingSeconds}s</span>
                    </div>
                    <button type="button" class="btn btn-outline btn-xs" data-release-locker="${escapeHtml(l.id)}">
                      🔒 Cerrar Unidad
                    </button>
                  </div>`
                : `<div style="display:flex; gap:0.45rem;">
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      style="flex:1"
                      data-quick-locker="${escapeHtml(l.id)}"
                    >
                      ⚡ Reservar con CoDi ($0.01)
                    </button>
                    ${
                      isReserved && l.activeOrderId
                        ? `<button type="button" class="btn btn-emerald btn-sm" data-confirm-order="${escapeHtml(l.activeOrderId)}">
                            Confirmar Pago
                          </button>`
                        : ''
                    }
                  </div>`
            }
          </article>
        `;
      })
      .join('');

    // Si hay un casillero esperando OTP y el teclado aún no tiene orden asignada, vincularlo
    const waitingLocker = lockerArray.find((l) => l.status === 'PAID_WAITING_OTP' && l.activeOrderId);
    if (waitingLocker && !kioskOrderId) {
      kioskOrderId = waitingLocker.activeOrderId;
      const lbl = document.getElementById('kiosk-target-label');
      if (lbl) {
        lbl.textContent = `Unidad lista: ${waitingLocker.name} (PIN: ${waitingLocker.otpHint})`;
      }
    } else if (!waitingLocker) {
      const anyOtpOrder = orders.find((o) => o.status === 'OTP_ISSUED');
      if (anyOtpOrder) {
        kioskOrderId = anyOtpOrder.orderId;
      }
    }
  }

  function updateKioskDisplay() {
    const el = document.getElementById('kiosk-pin-display');
    if (!el) return;
    const padded = kioskPinBuffer.padEnd(6, '_').split('').join(' ');
    el.textContent = padded;
  }

  // =========================================================================
  // VISTA 3: VAQUITA SPLIT-PAY MULTI-CLABE
  // =========================================================================
  function renderSplitView(split, clabes = []) {
    if (!split) return;
    const pct = split.targetAmount > 0
      ? Math.min(100, Math.round((split.collectedAmount / split.targetAmount) * 100))
      : 0;

    const titleEl = document.getElementById('split-title-heading');
    if (titleEl) titleEl.textContent = split.title || 'Vaquita Split-Pay';

    document.getElementById('split-status-text').textContent =
      split.status === 'COMPLETED_RECONCILED'
        ? '✅ ¡Cuenta 100% Conciliada y Liquidada!'
        : 'Recaudando aportaciones individuales...';

    document.getElementById('split-amount-text').textContent =
      `$${Number(split.collectedAmount).toFixed(2)} / $${Number(split.targetAmount).toFixed(2)} MXN`;

    const pctBig = document.getElementById('split-pct-big');
    if (pctBig) pctBig.textContent = `${pct}%`;

    const progressFill = document.getElementById('split-progress-fill');
    if (progressFill) progressFill.style.width = `${pct}%`;

    const ringCircle = document.getElementById('split-ring-circle');
    if (ringCircle) {
      const circumference = 351.86;
      const offset = circumference - (pct / 100) * circumference;
      ringCircle.style.strokeDashoffset = String(offset);
    }

    const listEl = document.getElementById('split-participants');
    listEl.innerHTML = (split.participants || [])
      .map((p, idx) => {
        const paid = p.status === 'PAID';
        const requested = p.status === 'PAYMENT_REQUESTED';
        const clabeInfo = clabes.find((c) => c.id === p.clabeId) || clabes[0] || {};
        const initials = String(p.name || `P${idx + 1}`)
          .split(' ')
          .map((w) => w[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();

        return `
          <article class="participant-card ${paid ? 'paid' : ''}">
            <div>
              <div class="participant-header">
                <div class="participant-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
                <div>
                  <strong>${escapeHtml(p.name)}</strong>
                  <div class="small-muted">${escapeHtml(clabeInfo.bankName || 'CoDi')} · $${Number(p.amount || 0.01).toFixed(2)} MXN</div>
                </div>
              </div>
              <div class="small-muted" style="margin-top:0.55rem;">
                Estado: ${
                  paid
                    ? '✅ Conciliado por Webhook'
                    : requested
                      ? '📲 QR CoDi Generado · Esperando pago'
                      : '⏳ Pendiente de cobro'
                }
              </div>
            </div>
            <div style="display:flex; gap:0.4rem;">
              ${
                paid
                  ? `<span class="pill-codi">Liquidado</span>`
                  : `<button
                      type="button"
                      class="btn btn-primary btn-xs"
                      style="flex:1"
                      data-quick-split="${escapeHtml(p.slotId)}"
                      data-clabe-id="${escapeHtml(p.clabeId)}"
                      data-split-name="${escapeHtml(p.name)}"
                    >
                      📱 Generar Cobro CoDi
                    </button>
                    ${
                      requested && p.orderId
                        ? `<button type="button" class="btn btn-emerald btn-xs" data-confirm-order="${escapeHtml(p.orderId)}">
                            Confirmar
                          </button>`
                        : ''
                    }`
              }
            </div>
          </article>
        `;
      })
      .join('');

    const dedEl = document.getElementById('split-dedications');
    if (dedEl) {
      dedEl.innerHTML = (split.dedications || [])
        .map(
          (d) => `<span class="dedication-chip">💬 <strong>${escapeHtml(d.author)}:</strong> ${escapeHtml(d.message)}</span>`
        )
        .join('');
    }
  }

  // =========================================================================
  // VISTA 4: PEYSTUDIO LIVE (SECUENCIADOR 8-PASOS + LIENZO + NARRATIVA)
  // =========================================================================
  function renderStudioView(studio) {
    if (!studio) return;
    document.getElementById('studio-bpm').textContent = `${studio.bpm} BPM`;
    const bpmRange = document.getElementById('studio-bpm-range');
    if (bpmRange && document.activeElement !== bpmRange) {
      bpmRange.value = String(studio.bpm);
    }

    const tracksGrid = document.getElementById('synth-tracks-grid');
    tracksGrid.innerHTML = Object.entries(studio.activeTracks)
      .map(([key, t]) => {
        const steps = Array.isArray(t.steps) ? t.steps : [true, false, true, false, true, false, true, false];
        const padsHtml = steps
          .map(
            (isOn, idx) => `
            <button
              type="button"
              class="seq-pad ${isOn && t.active ? 'pad-on' : ''}"
              style="--track-color: ${escapeHtml(t.color)}"
              data-seq-track="${escapeHtml(key)}"
              data-step="${idx}"
              ${!t.active ? 'disabled title="Desbloquea esta pista con CoDi para programar sus pasos"' : `aria-label="Paso ${idx + 1} de ${escapeHtml(t.name)}"`}
            >
              ${idx + 1}
            </button>
          `
          )
          .join('');

        return `
          <div class="seq-row ${t.active ? 'track-on' : ''}">
            <div>
              <div style="display:flex;align-items:center;gap:0.45rem;">
                <span class="status-dot" style="background:${escapeHtml(t.color)}"></span>
                <strong>${escapeHtml(t.name)}</strong>
              </div>
              <div class="small-muted">
                ${t.active ? `Activa · ${t.paidCount} aportaciones` : '🔒 Pista bloqueada'}
              </div>
            </div>
            <div class="seq-steps">${padsHtml}</div>
            <div>
              <button type="button" class="btn ${t.active ? 'btn-glass' : 'btn-primary'} btn-xs" data-quick-synth="${escapeHtml(key)}">
                ${t.active ? '⚡ +Impulso ($0.01)' : '🔓 Desbloquear ($0.01)'}
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    const muralGrid = document.getElementById('mural-grid');
    const tiles = studio.muralTiles || [];
    muralGrid.innerHTML = tiles.length
      ? tiles
          .map(
            (tile) => `
          <div class="mural-tile" style="background:${escapeHtml(tile.color)}">
            <span>${escapeHtml(tile.word)}</span>
            <small>por ${escapeHtml(tile.author)}</small>
          </div>
        `
          )
          .join('')
      : '<div class="small-muted">El lienzo está listo. Cada orden en PeyStudio pinta una baldosa neón verificada por webhook.</div>';

    // Opciones de votación narrativa
    const branchesEl = document.getElementById('story-branches');
    if (branchesEl) {
      const baseOptions = studio.storyHistory?.[studio.storyHistory.length - 1]?.options || [];
      const votes = studio.storyVotes || {};
      branchesEl.innerHTML = baseOptions
        .map(
          (opt) => `
          <button type="button" class="branch-vote-btn" data-vote-story="${escapeHtml(opt.id)}" data-vote-label="${escapeHtml(opt.label)}">
            <span><strong>${escapeHtml(opt.style)}:</strong> ${escapeHtml(opt.label)}</span>
            <span class="pill-codi">${votes[opt.id] || 0} votos · Votar $0.01</span>
          </button>
        `
        )
        .join('');
    }

    const storyFeed = document.getElementById('story-feed');
    storyFeed.innerHTML = (studio.storyHistory || [])
      .map(
        (ch) => `
        <div class="story-card">
          <strong>${escapeHtml(ch.title)}</strong>
          <p>${escapeHtml(ch.narrative)}</p>
        </div>
      `
      )
      .join('');
  }

  // =========================================================================
  // VISTA 5: TARJETAS BANCARIAS CLABE + AUDITORÍA WEBHOOKS
  // =========================================================================
  function renderClabesView(clabes = [], logs = [], orders = []) {
    const cardsGrid = document.getElementById('clabes-cards-grid');
    if (cardsGrid) {
      cardsGrid.innerHTML = clabes
        .map((c) => {
          let themeCls = 'bank-default';
          if (c.bankPrefix === '012') themeCls = 'bank-bbva';
          else if (c.bankPrefix === '014') themeCls = 'bank-santander';
          else if (c.bankPrefix === '127') themeCls = 'bank-azteca';

          const paidCount = orders.filter(
            (o) => o.clabe === c.clabe && ['OTP_ISSUED', 'DELIVERED', 'PAID'].includes(o.status)
          ).length;

          return `
            <article class="fintech-bank-card ${themeCls}">
              <div class="fintech-card-top">
                <div class="fintech-chip" aria-hidden="true"></div>
                <span class="pill-codi">${escapeHtml(c.bankName)}</span>
              </div>
              <div class="fintech-clabe-digits">${escapeHtml(formatClabeReadable(c.clabe))}</div>
              <div class="fintech-card-bottom">
                <div>
                  <div style="font-size:0.92rem;font-weight:800;">${escapeHtml(c.holderName)}</div>
                  <div style="font-size:0.72rem;opacity:0.85;">${escapeHtml(c.role)} · ${paidCount} cobros</div>
                </div>
                <button type="button" class="btn btn-glass btn-xs" data-select-clabe="${escapeHtml(c.id)}">
                  Cobrar aquí
                </button>
              </div>
            </article>
          `;
        })
        .join('');
    }

    const tbody = document.getElementById('clabes-table-body');
    if (tbody) {
      tbody.innerHTML = clabes
        .map(
          (c) => `
          <tr>
            <td><strong>${escapeHtml(c.holderName)}</strong></td>
            <td class="mono">${escapeHtml(c.clabe)}</td>
            <td>${escapeHtml(c.bankName)}</td>
            <td>
              <button type="button" class="btn btn-outline btn-xs" data-select-clabe="${escapeHtml(c.id)}">
                Usar CLABE
              </button>
            </td>
          </tr>
        `
        )
        .join('');
    }

    const logsEl = document.getElementById('webhook-logs-list');
    if (!logsEl) return;
    if (!logs.length) {
      logsEl.innerHTML = '<div class="small-muted">Esperando eventos firmados en /api/webhooks/pey...</div>';
      return;
    }
    logsEl.innerHTML = logs
      .map((l) => {
        let cls = '';
        if (l.outcome.includes('DUPLICATE')) cls = 'dup';
        else if (l.outcome.includes('LATE')) cls = 'late';
        else if (l.outcome.includes('INVALID')) cls = 'reject';
        const time = new Date(l.timestamp).toLocaleTimeString('es-MX');
        return `
          <div class="log-item ${cls}">
            <div><strong>[${time}] ${escapeHtml(l.outcome)}</strong> · <code>${escapeHtml(l.eventType)}</code></div>
            <div>webhook-id: ${escapeHtml(l.webhookId)} ${l.numRef ? `· ref: ${escapeHtml(l.numRef)}` : ''}</div>
            <div class="small-muted">${escapeHtml(l.reason)}</div>
          </div>
        `;
      })
      .join('');
  }

  // =========================================================================
  // EVENTOS E INTERACCIONES DE USUARIO
  // =========================================================================
  function bindEvents() {
    // 1. Navegación por Pestañas
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab) switchTab(tab);
      });
    });

    // 2. Modal de Orden CoDi Personalizada
    const orderModal = document.getElementById('order-modal');
    const stationSelect = document.getElementById('order-station');
    const methodSelect = document.getElementById('order-method');

    const openOrderModal = (preset = {}) => {
      if (preset.station) stationSelect.value = preset.station;
      if (preset.clabeId) document.getElementById('order-clabe').value = preset.clabeId;
      if (preset.method) methodSelect.value = preset.method;
      if (preset.concept) document.getElementById('order-concept').value = preset.concept;
      if (preset.amount) document.getElementById('order-amount').value = String(preset.amount);

      document.getElementById('station-extra-synth').hidden = stationSelect.value !== 'synth';
      document.getElementById('station-extra-locker').hidden = stationSelect.value !== 'locker';
      document.getElementById('phone-group').hidden = methodSelect.value !== 'PUSH';

      orderModal.showModal();
    };

    document.getElementById('btn-open-custom-order').addEventListener('click', () => openOrderModal());
    document.getElementById('btn-empty-new-order').addEventListener('click', () => openOrderModal());
    document.getElementById('btn-close-order-modal').addEventListener('click', () => orderModal.close());

    stationSelect.addEventListener('change', () => {
      const val = stationSelect.value;
      document.getElementById('station-extra-synth').hidden = val !== 'synth';
      document.getElementById('station-extra-locker').hidden = val !== 'locker';
    });

    methodSelect.addEventListener('change', () => {
      const isPush = methodSelect.value === 'PUSH';
      document.getElementById('phone-group').hidden = !isPush;
    });

    document.getElementById('form-create-order').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const station = stationSelect.value;
        const clabeId = document.getElementById('order-clabe').value;
        const method = methodSelect.value;
        const phone = document.getElementById('order-phone').value;
        const amount = Number(document.getElementById('order-amount').value || 0.01);
        const concept = document.getElementById('order-concept').value;
        const payerAlias = document.getElementById('order-alias').value || 'Cliente CoDi';

        const metadata = {
          payerAlias,
          muralWord: concept,
          trackKey: document.getElementById('synth-track').value,
          storyOption: document.getElementById('story-option').value,
          lockerId: document.getElementById('locker-select').value,
          durationSeconds: Number(document.getElementById('locker-duration').value || 60),
          isSponsoredMeal: station === 'meals',
        };

        const res = await apiPost('/api/orders', {
          station,
          method,
          phone,
          amount,
          concept,
          clabeId,
          metadata,
        });
        selectedOrderId = res.order.orderId;
        orderModal.close();
        focusActiveOrderDock();
        showToast(`📱 Orden ${res.order.orderId} ($${res.order.amount.toFixed(2)} MXN) lista en la terminal CoDi.`);
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    });

    // 3. Validar OTP desde la Terminal Lateral
    document.getElementById('btn-verify-otp').addEventListener('click', async () => {
      if (!selectedOrderId) return;
      try {
        const otpCode = document.getElementById('input-verify-otp').value;
        await apiPost(`/api/orders/${encodeURIComponent(selectedOrderId)}/verify-otp`, { otpCode });
        synthAudio.playUnlockSound();
        showToast('🔓 Código PIN OTP verificado y quemado: Entrega completada.');
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    });

    // 4. Teclado Físico (Kiosk Keypad) en Smart Lockers
    document.querySelectorAll('[data-numpad]').forEach((keyBtn) => {
      keyBtn.addEventListener('click', async () => {
        const key = keyBtn.getAttribute('data-numpad');
        if (key === 'CLEAR') {
          kioskPinBuffer = '';
          updateKioskDisplay();
          return;
        }
        if (key === 'ENTER') {
          const targetId = kioskOrderId || selectedOrderId;
          if (!targetId || kioskPinBuffer.length !== 6) {
            showToast('⚠️ Ingresa los 6 dígitos del PIN OTP.');
            return;
          }
          try {
            await apiPost(`/api/orders/${encodeURIComponent(targetId)}/verify-otp`, {
              otpCode: kioskPinBuffer,
            });
            kioskPinBuffer = '';
            updateKioskDisplay();
            synthAudio.playUnlockSound();
            showToast('🔓 ¡Compuerta desbloqueada! Temporizador de sesión iniciado.');
          } catch (err) {
            showToast(`⚠️ ${err.message}`);
          }
          return;
        }
        if (kioskPinBuffer.length < 6 && /^\d$/.test(key)) {
          kioskPinBuffer += key;
          updateKioskDisplay();
        }
      });
    });

    // 5. Despachador de Webhooks Firmados (Terminal de Orden Activa)
    const runWebhookDispatch = async (scenario, label) => {
      if (!selectedOrderId && scenario !== 'INVALID_SIGNATURE') {
        showToast('Selecciona o genera primero una orden CoDi.');
        return;
      }
      try {
        const res = await apiPost('/api/chaos/simulate', {
          orderId: selectedOrderId,
          scenario,
        });
        if (scenario === 'SUCCESS') {
          synthAudio.playPaymentChime();
          const otp = await claimOtp(selectedOrderId);
          if (otp) {
            document.getElementById('input-verify-otp').value = otp;
            kioskPinBuffer = otp;
            kioskOrderId = selectedOrderId;
            updateKioskDisplay();
          }
        }
        showToast(`${label} (${res.chaosResult?.status || 'OK'}).`);
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    };

    document.getElementById('btn-sim-success').addEventListener('click', () =>
      runWebhookDispatch('SUCCESS', '✅ Liquidación CoDi confirmada por Webhook HMAC')
    );
    document.getElementById('btn-sim-duplicate').addEventListener('click', () =>
      runWebhookDispatch('DUPLICATE_REPLAY', '🛡️ Reintento duplicado bloqueado por idempotencia')
    );
    document.getElementById('btn-sim-late').addEventListener('click', () =>
      runWebhookDispatch('LATE_PAYMENT', '⏰ Pago tardío compensado con Voucher firmado')
    );
    document.getElementById('btn-sim-reject').addEventListener('click', () =>
      runWebhookDispatch('BANK_REJECT', '🔄 Failover automático ejecutado a otra CLABE')
    );
    document.getElementById('btn-sim-forged').addEventListener('click', () =>
      runWebhookDispatch('INVALID_SIGNATURE', '🛡️ Webhook con firma adulterada rechazado (401)')
    );

    // 6. Delegación de Clics para Todos los Módulos (Crea Orden Real sin Auto-Simular)
    document.body.addEventListener('click', async (e) => {
      // Seleccionar orden existente
      const selOrderBtn = e.target.closest('[data-select-order]');
      if (selOrderBtn) {
        selectedOrderId = selOrderBtn.getAttribute('data-select-order');
        if (currentState) renderActiveOrder(currentState.orders);
        focusActiveOrderDock();
        return;
      }

      // Confirmar pago directo de una orden en espera
      const confirmBtn = e.target.closest('[data-confirm-order]');
      if (confirmBtn) {
        selectedOrderId = confirmBtn.getAttribute('data-confirm-order');
        await runWebhookDispatch('SUCCESS', '✅ Pago CoDi confirmado por Webhook');
        return;
      }

      // POS: Crear orden para un producto del catálogo
      const posBtn = e.target.closest('[data-pos-order]');
      if (posBtn) {
        const itemId = posBtn.getAttribute('data-pos-order');
        const method = posBtn.getAttribute('data-pos-method') || 'QR';
        const item = (currentState?.posCatalog || []).find((i) => i.id === itemId);
        if (!item) return;

        if (method === 'PUSH') {
          openOrderModal({
            station: item.isSponsoredMeal ? 'meals' : 'pos',
            clabeId: item.clabeId,
            method: 'PUSH',
            concept: item.name.slice(0, 36),
            amount: item.amount,
          });
          return;
        }

        try {
          const res = await apiPost('/api/orders', {
            station: item.isSponsoredMeal ? 'meals' : 'pos',
            method: 'QR',
            amount: item.amount,
            concept: item.name.slice(0, 36),
            clabeId: item.clabeId,
            metadata: {
              itemName: item.name,
              isSponsoredMeal: item.isSponsoredMeal,
              payerAlias: 'Cliente Mostrador',
            },
          });
          selectedOrderId = res.order.orderId;
          focusActiveOrderDock();
          showToast(`📱 QR CoDi generado para "${item.name}". Escanea o confirma el pago en la terminal derecha.`);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
        return;
      }

      // Smart Lockers: Reservar casillero (Genera Orden QR real esperando pago)
      const lockerBtn = e.target.closest('[data-quick-locker]');
      if (lockerBtn) {
        const lockerId = lockerBtn.getAttribute('data-quick-locker');
        const lockerObj = currentState?.lockers?.[lockerId];
        try {
          const res = await apiPost('/api/orders', {
            station: 'locker',
            method: 'QR',
            concept: `RESERVA ${lockerId}`,
            clabeId: lockerObj?.clabeId || 'acc_santiago_bbva',
            metadata: {
              lockerId,
              durationSeconds: lockerObj?.defaultDurationSeconds || 60,
            },
          });
          selectedOrderId = res.order.orderId;
          focusActiveOrderDock();
          showToast(`📦 ${lockerId} reservado. Completa el pago CoDi en la terminal derecha para recibir tu PIN OTP.`);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
        return;
      }

      // Smart Lockers: Cargar PIN en el Teclado Físico
      const loadPinBtn = e.target.closest('[data-load-kiosk-pin]');
      if (loadPinBtn) {
        kioskPinBuffer = loadPinBtn.getAttribute('data-load-kiosk-pin') || '';
        kioskOrderId = loadPinBtn.getAttribute('data-kiosk-order') || selectedOrderId;
        const unitName = loadPinBtn.getAttribute('data-kiosk-name') || 'Unidad';
        const lbl = document.getElementById('kiosk-target-label');
        if (lbl) lbl.textContent = `PIN cargado para ${unitName}. Presiona "🔓 Abrir"`;
        updateKioskDisplay();
        return;
      }

      // Smart Lockers: Liberar/Cerrar unidad manualmente
      const releaseBtn = e.target.closest('[data-release-locker]');
      if (releaseBtn) {
        const lockerId = releaseBtn.getAttribute('data-release-locker');
        try {
          const activeOrderId = currentState?.lockers?.[lockerId]?.activeOrderId;
          await apiPost(`/api/lockers/${encodeURIComponent(lockerId)}/release`, {}, {
            'x-claim-token': orderClaims.get(activeOrderId) || '',
          });
          showToast(`🔒 ${lockerId} cerrado y disponible nuevamente.`);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
        return;
      }

      // Vaquita Split-Pay: Generar cobro CoDi para un participante
      const splitBtn = e.target.closest('[data-quick-split]');
      if (splitBtn) {
        const slotId = splitBtn.getAttribute('data-quick-split');
        const clabeId = splitBtn.getAttribute('data-clabe-id') || 'acc_adrian_santander';
        const participantName = splitBtn.getAttribute('data-split-name') || 'Participante';
        try {
          const res = await apiPost('/api/orders', {
            station: 'split',
            method: 'QR',
            concept: `VAQUITA ${participantName.slice(0, 22).toUpperCase()}`,
            clabeId,
            metadata: {
              slotId,
              payerAlias: participantName,
              dedication: 'Pago individual liquidado vía CoDi',
            },
          });
          selectedOrderId = res.order.orderId;
          focusActiveOrderDock();
          showToast(`🤝 QR CoDi listo para ${participantName}. Confirma el pago en la terminal derecha.`);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
        return;
      }

      // PeyStudio: Alternar un paso del secuenciador de 8 pasos
      const seqPad = e.target.closest('[data-seq-track]');
      if (seqPad && !seqPad.disabled) {
        const trackKey = seqPad.getAttribute('data-seq-track');
        const stepIndex = Number(seqPad.getAttribute('data-step'));
        try {
          await apiPost('/api/studio/sequencer', { trackKey, stepIndex });
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
        return;
      }

      // PeyStudio: Desbloquear o impulsar pista musical con CoDi
      const synthBtn = e.target.closest('[data-quick-synth]');
      if (synthBtn) {
        const trackKey = synthBtn.getAttribute('data-quick-synth');
        try {
          const res = await apiPost('/api/orders', {
            station: 'synth',
            method: 'QR',
            concept: `PISTA ${trackKey.toUpperCase()}`,
            clabeId: 'acc_ramon_bbva',
            metadata: {
              trackKey,
              muralWord: trackKey.toUpperCase(),
              payerAlias: 'Productor CoDi',
            },
          });
          selectedOrderId = res.order.orderId;
          focusActiveOrderDock();
          showToast(`🎹 Orden CoDi creada para la pista ${trackKey}. Confirma el pago en la terminal derecha.`);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
        return;
      }

      // PeyStudio: Votar decisión narrativa con CoDi
      const voteBtn = e.target.closest('[data-vote-story]');
      if (voteBtn) {
        const storyOption = voteBtn.getAttribute('data-vote-story');
        const label = voteBtn.getAttribute('data-vote-label') || 'Giro Red';
        try {
          const res = await apiPost('/api/orders', {
            station: 'synth',
            method: 'QR',
            concept: `VOTO ${label.slice(0, 22).toUpperCase()}`,
            clabeId: 'acc_ramon_bbva',
            metadata: {
              trackKey: 'cyber_arp',
              storyOption,
              muralWord: storyOption.replace('opt_', ' NODO ').toUpperCase(),
              payerAlias: 'Votante CoDi',
            },
          });
          selectedOrderId = res.order.orderId;
          focusActiveOrderDock();
          showToast('📖 Orden de voto CoDi generada. Confírmala en la terminal derecha.');
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
        return;
      }

      // POS / Comedor: Validar OTP y entregar pedido o comida
      const deliverMealBtn = e.target.closest('[data-deliver-meal]');
      if (deliverMealBtn) {
        const orderId = deliverMealBtn.getAttribute('data-deliver-meal');
        const otpCode = deliverMealBtn.getAttribute('data-otp');
        try {
          await apiPost(`/api/orders/${encodeURIComponent(orderId)}/verify-otp`, { otpCode });
          synthAudio.playUnlockSound();
          showToast('🌮 Entrega verificada con PIN OTP de un solo uso.');
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
        return;
      }

      // Cuentas CLABE: Seleccionar cuenta para cobro
      const selectClabeBtn = e.target.closest('[data-select-clabe]');
      if (selectClabeBtn) {
        const clabeId = selectClabeBtn.getAttribute('data-select-clabe');
        openOrderModal({ clabeId });
      }
    });

    // 7. Botón Rápido para Patrocinar Comida Solidaria (Crea orden CoDi real)
    document.getElementById('btn-quick-meal').addEventListener('click', async () => {
      try {
        const res = await apiPost('/api/orders', {
          station: 'meals',
          method: 'QR',
          concept: 'COMIDA SOLIDARIA ABIERTA',
          clabeId: 'acc_david_azteca',
          metadata: { isSponsoredMeal: true, payerAlias: 'Donador Solidario' },
        });
        selectedOrderId = res.order.orderId;
        focusActiveOrderDock();
        showToast('🍲 QR CoDi generado para patrocinar comida. Confirma el pago en la terminal derecha.');
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    });

    // 8. Botón Pintar Baldosa en Mural PeyStudio
    document.getElementById('btn-add-mural-tile').addEventListener('click', () => {
      openOrderModal({
        station: 'synth',
        clabeId: 'acc_ramon_bbva',
        concept: 'MURAL PEYOS',
      });
    });

    // 9. Control deslizante de BPM en PeyStudio
    const bpmSlider = document.getElementById('studio-bpm-range');
    if (bpmSlider) {
      bpmSlider.addEventListener('change', async () => {
        const bpm = Number(bpmSlider.value);
        await apiPost('/api/studio/sequencer', { bpm });
        if (synthAudio.enabled) {
          synthAudio.startLoop();
        }
      });
    }

    // 10. Configurar o Reiniciar Vaquita Split-Pay
    const splitBuilderForm = document.getElementById('form-custom-split');
    document.getElementById('btn-open-split-builder').addEventListener('click', () => {
      splitBuilderForm.hidden = !splitBuilderForm.hidden;
    });
    document.getElementById('btn-close-split-builder').addEventListener('click', () => {
      splitBuilderForm.hidden = true;
    });
    splitBuilderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('split-custom-title').value;
      const rawNames = document.getElementById('split-custom-names').value;
      const clabePool = ['acc_ramon_bbva', 'acc_adrian_santander', 'acc_david_azteca', 'acc_miriam_bbva'];
      const names = rawNames
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const participants = names.map((name, idx) => ({
        slotId: `split_${idx + 1}`,
        name,
        clabeId: clabePool[idx % clabePool.length],
        amount: 0.01,
      }));
      await apiPost('/api/split/create', { title, participants });
      splitBuilderForm.hidden = true;
      showToast('🤝 Nueva Vaquita Split-Pay configurada.');
    });

    document.getElementById('btn-reset-split').addEventListener('click', async () => {
      await apiPost('/api/split/reset');
      showToast('🔄 Cuenta dividida reiniciada.');
    });

    // 11. Validador en Vivo y Alta de Cuenta CLABE (Banxico 3-7-1)
    const clabeInput = document.getElementById('new-clabe-number');
    const feedbackBanner = document.getElementById('clabe-live-feedback');

    if (clabeInput && feedbackBanner) {
      clabeInput.addEventListener('input', async () => {
        const clean = clabeInput.value.replace(/\D/g, '');
        clabeInput.value = clean;
        if (clean.length < 17) {
          feedbackBanner.className = 'clabe-feedback-banner';
          feedbackBanner.textContent = `Llevas ${clean.length}/18 dígitos. Al llegar a 17 calcularemos el dígito verificador Banxico.`;
          return;
        }
        try {
          const check = await apiPost('/api/clabes/validate', { clabe: clean });
          if (clean.length === 17 && check.suggestedDigit !== undefined) {
            feedbackBanner.className = 'clabe-feedback-banner';
            feedbackBanner.innerHTML = `Institución: <strong>${escapeHtml(check.bankName || 'SPEI')}</strong> · Dígito verificador Banxico calculado: <strong>${check.suggestedDigit}</strong> <button type="button" class="btn btn-emerald btn-xs" id="btn-apply-check-digit" style="margin-left:0.5rem;">Completar ${check.suggestedDigit}</button>`;
            const applyBtn = document.getElementById('btn-apply-check-digit');
            if (applyBtn) {
              applyBtn.addEventListener('click', () => {
                clabeInput.value = `${clean}${check.suggestedDigit}`;
                clabeInput.dispatchEvent(new Event('input'));
              });
            }
          } else if (check.valid) {
            feedbackBanner.className = 'clabe-feedback-banner valid';
            feedbackBanner.textContent = `✅ CLABE válida (${check.bankName}) · Dígito verificador Banxico confirmado.`;
          } else {
            feedbackBanner.className = 'clabe-feedback-banner invalid';
            feedbackBanner.textContent = `❌ ${check.reason}`;
          }
        } catch (_err) {
          // Ignorar errores de red durante escritura rápida
        }
      });
    }

    document.getElementById('form-register-clabe').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const holderName = document.getElementById('new-clabe-holder').value;
        const role = document.getElementById('new-clabe-role').value;
        const clabe = document.getElementById('new-clabe-number').value;
        await apiPost('/api/clabes', { holderName, clabe, role });
        document.getElementById('new-clabe-holder').value = '';
        document.getElementById('new-clabe-role').value = '';
        document.getElementById('new-clabe-number').value = '';
        if (feedbackBanner) {
          feedbackBanner.className = 'clabe-feedback-banner valid';
          feedbackBanner.textContent = '✅ Cuenta registrada y lista para recibir pagos CoDi.';
        }
        showToast('🏦 Cuenta CLABE validada y dada de alta.');
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    });

    // 12. Toggle de Audio Synth
    const audioBtn = document.getElementById('btn-audio-toggle');
    audioBtn.addEventListener('click', () => {
      const on = synthAudio.toggle();
      audioBtn.setAttribute('aria-pressed', String(on));
      audioBtn.textContent = on ? '🔊 Audio: EN VIVO' : '🔇 Audio: Off';
      const visLabel = document.getElementById('visualizer-state-label');
      if (visLabel) {
        visLabel.textContent = on
          ? 'Sintetizador activo · Programando secuencia en tiempo real'
          : 'Haz clic en "🔊 Audio" arriba para escuchar la mezcla en vivo';
      }
      if (on) {
        synthAudio.playPaymentChime();
      }
    });

    // 13. Modal de Configuración de API Key Pey
    const configModal = document.getElementById('config-modal');
    document.getElementById('btn-open-config').addEventListener('click', () => configModal.showModal());
    document.getElementById('btn-close-config').addEventListener('click', () => configModal.close());
    document.getElementById('form-config-pey').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await apiPost('/api/config/pey', {
          apiKey: document.getElementById('cfg-api-key').value,
          webhookSecret: document.getElementById('cfg-webhook-secret').value,
          defaultBankAccountId: document.getElementById('cfg-bank-id').value,
        });
        configModal.close();
        showToast('🔑 Credenciales de api.pey.mx actualizadas en memoria.');
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    });
  }

  // =========================================================================
  // CONEXIÓN SSE EN TIEMPO REAL
  // =========================================================================
  function connectSse() {
    const evtSource = new EventSource('/api/events');
    const indicatorText = document.getElementById('sse-text');

    evtSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.snapshot) {
          renderAll(payload.snapshot);
        }
        if (indicatorText) {
          indicatorText.textContent = 'En línea';
        }
      } catch (_err) {
        // Ignorar frames vacíos
      }
    };

    evtSource.onerror = () => {
      if (indicatorText) {
        indicatorText.textContent = 'Reconectando...';
      }
    };
  }

  async function init() {
    bindEvents();
    synthAudio.startVisualizer();
    const res = await fetch('/api/state');
    const snapshot = await res.json();
    renderAll(snapshot);
    connectSse();
  }

  init();
})();
