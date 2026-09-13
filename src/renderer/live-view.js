/**
 * Live View — Tela de transmissão ao vivo
 * Exibe preview do stream, stats em tempo real, timer e controles
 */

const LiveView = (() => {
  let timerInterval = null;
  let startTime = null;
  let onStopCallback = null;

  // ── SVG Icons ──
  const ICONS = {
    stop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
    signal: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/></svg>',
    settings: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
  };

  /**
   * Initialize the live view with stream data
   * @param {Object} opts
   * @param {MediaStream} opts.stream - The local media stream for preview
   * @param {string} opts.channelName - Discord channel name
   * @param {string} opts.guildName - Discord guild/server name
   * @param {string} opts.sourceName - Name of the captured source
   * @param {Function} opts.onStop - Callback when user clicks stop
   * @param {string} opts.audioAppName - Name of the audio app being captured (optional)
   */
  function init(opts) {
    const { stream, channelName, guildName, sourceName, onStop, audioAppName } = opts;
    onStopCallback = onStop || null;
    startTime = Date.now();

    const container = document.getElementById("screen-live");
    if (!container) return;

    const audioSourceHtml = audioAppName 
      ? `<div class="live-audio-source">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
          <span>Áudio: ${escapeHtml(audioAppName)}</span>
        </div>`
      : '';

    container.innerHTML = `
      <div class="live-container">
        <div class="live-header">
          <div class="live-header-left">
            <div class="live-badge">
              <div class="live-dot"></div>
              AO VIVO
            </div>
            <div>
              <div class="live-channel-info">${escapeHtml(channelName || sourceName || "Transmissão")}</div>
              ${guildName ? `<div class="live-channel-sub">${escapeHtml(guildName)}</div>` : ""}
              ${audioSourceHtml}
            </div>
          </div>
          <div class="live-timer" id="liveTimer">00:00:00</div>
        </div>

        <div class="live-quality-info" id="liveQualityInfo">
          <div class="quality-info-content">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <span id="qualityInfoText">Dica: Se o vídeo estiver travado ou com baixa qualidade, ajuste as configurações ou verifique sua conexão de rede.</span>
            <button class="quality-info-close" id="btnCloseQualityInfo">×</button>
          </div>
        </div>

        <div class="live-preview">
          <video id="livePreviewVideo" autoplay muted playsinline></video>
          <div class="live-preview-label">${escapeHtml(sourceName || "Captura de tela")}</div>
          <div class="live-network-status" id="liveNetworkStatus">
            <span class="network-status-indicator" id="networkStatusIndicator"></span>
            <span class="network-status-text" id="networkStatusText">Verificando...</span>
          </div>
        </div>

        <div class="live-stats" id="liveStats">
          <div class="live-stat">
            <span class="live-stat-label">Bitrate</span>
            <span class="live-stat-value" id="statBitrate">—</span>
          </div>
          <div class="live-stat">
            <span class="live-stat-label">Meta</span>
            <span class="live-stat-value" id="statTargetBitrate">—</span>
          </div>
          <div class="live-stat">
            <span class="live-stat-label">Resolução</span>
            <span class="live-stat-value" id="statResolution">—</span>
          </div>
          <div class="live-stat">
            <span class="live-stat-label">FPS</span>
            <span class="live-stat-value" id="statFps">—</span>
          </div>
          <div class="live-stat">
            <span class="live-stat-label">Latência</span>
            <span class="live-stat-value" id="statLatency">—</span>
          </div>
          <div class="live-stat">
            <span class="live-stat-label">Qualidade</span>
            <span class="live-stat-value live-stat-quality" id="statQuality">
              <span class="quality-indicator good"></span>
              <span class="quality-text">Boa</span>
            </span>
          </div>
        </div>

        <div class="live-footer">
          <button class="btn-secondary" id="btnLiveSettings">
            ${ICONS.settings}
            Configurações
          </button>
          <button class="btn-danger" id="btnStopStream">
            ${ICONS.stop}
            Parar Transmissão
          </button>
        </div>
      </div>
    `;

    // Set up video preview
    const video = document.getElementById("livePreviewVideo");
    if (video && stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }

    // Start timer
    startTimer();

    // Bind stop button
    const stopBtn = document.getElementById("btnStopStream");
    if (stopBtn) {
      stopBtn.addEventListener("click", () => {
        if (onStopCallback) onStopCallback();
      });
    }

    // Bind settings button
    const settingsBtn = document.getElementById("btnLiveSettings");
    if (settingsBtn) {
      settingsBtn.addEventListener("click", () => {
        if (typeof SettingsPanel !== 'undefined' && SettingsPanel.show) {
          SettingsPanel.show();
        }
      });
    }

    // Bind close quality info button
    const closeQualityInfoBtn = document.getElementById("btnCloseQualityInfo");
    if (closeQualityInfoBtn) {
      closeQualityInfoBtn.addEventListener("click", () => {
        const qualityInfo = document.getElementById("liveQualityInfo");
        if (qualityInfo) {
          qualityInfo.style.display = "none";
        }
      });
    }
  }

  /**
   * Start the elapsed time timer
   */
  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
      const el = document.getElementById("liveTimer");
      if (!el || !startTime) return;

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const hours = Math.floor(elapsed / 3600);
      const minutes = Math.floor((elapsed % 3600) / 60);
      const seconds = elapsed % 60;

      el.textContent =
        String(hours).padStart(2, "0") + ":" +
        String(minutes).padStart(2, "0") + ":" +
        String(seconds).padStart(2, "0");
    }, 1000);
  }

  /**
   * Update stats display
   * @param {Object} stats
   * @param {number} stats.bitrate - Current bitrate in bps
   * @param {number} stats.width - Video width
   * @param {number} stats.height - Video height
   * @param {number} stats.fps - Frames per second
   * @param {number} stats.latency - Round-trip time in ms
   * @param {string} stats.quality - "good" | "fair" | "poor"
   */
  function updateStats(stats) {
    if (!stats) return;

    const formatBitrate = (value) => {
      if (value === undefined || value === null || Number.isNaN(value)) return "—";
      const kbps = value / 1000;
      if (kbps >= 1000) return (kbps / 1000).toFixed(1) + " Mbps";
      return Math.round(kbps) + " kbps";
    };

    const bitrateEl = document.getElementById("statBitrate");
    if (bitrateEl && stats.bitrate !== undefined) {
      bitrateEl.textContent = formatBitrate(stats.bitrate);
    }

    const targetBitrateEl = document.getElementById("statTargetBitrate");
    if (targetBitrateEl && stats.targetBitrate !== undefined) {
      targetBitrateEl.textContent = formatBitrate(stats.targetBitrate);
    }

    const resEl = document.getElementById("statResolution");
    if (resEl && stats.width && stats.height) {
      resEl.textContent = stats.width + "×" + stats.height;
    }

    const fpsEl = document.getElementById("statFps");
    if (fpsEl && stats.fps !== undefined) {
      fpsEl.textContent = Math.round(stats.fps);
    }

    const latencyEl = document.getElementById("statLatency");
    if (latencyEl && stats.latency !== undefined) {
      latencyEl.textContent = Math.round(stats.latency) + " ms";
    }

    const qualityEl = document.getElementById("statQuality");
    if (qualityEl && stats.quality) {
      const qualityClass = stats.quality === "good" ? "good" : stats.quality === "fair" ? "fair" : "poor";
      const qualityText = stats.quality === "good" ? "Boa" : stats.quality === "fair" ? "Média" : "Baixa";
      qualityEl.innerHTML = `<span class="quality-indicator ${qualityClass}"></span><span class="quality-text">${qualityText}</span>`;
    }

    // Atualizar indicador de status de rede
    updateNetworkStatus(stats);
  }

  /**
   * Update network status indicator
   * @param {Object} stats
   */
  function updateNetworkStatus(stats) {
    const indicator = document.getElementById("networkStatusIndicator");
    const text = document.getElementById("networkStatusText");
    
    if (!indicator || !text) return;

    let status = "good";
    let statusText = "Conexão estável";

    if (stats.latency > 200 || stats.bitrate < 1000000) {
      status = "poor";
      statusText = "Conexão instável";
    } else if (stats.latency > 100 || stats.bitrate < 3000000) {
      status = "fair";
      statusText = "Conexão moderada";
    }

    indicator.className = `network-status-indicator ${status}`;
    text.textContent = statusText;
  }

  /**
   * Cleanup live view
   */
  function destroy() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    startTime = null;
    onStopCallback = null;

    // Stop video preview
    const video = document.getElementById("livePreviewVideo");
    if (video) {
      video.srcObject = null;
    }

    // Clear container
    const container = document.getElementById("screen-live");
    if (container) {
      container.innerHTML = "";
    }
  }

  /**
   * Get elapsed time in seconds
   */
  function getElapsedSeconds() {
    if (!startTime) return 0;
    return Math.floor((Date.now() - startTime) / 1000);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  return {
    init,
    updateStats,
    destroy,
    getElapsedSeconds,
  };
})();
