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
  };

  /**
   * Initialize the live view with stream data
   * @param {Object} opts
   * @param {MediaStream} opts.stream - The local media stream for preview
   * @param {string} opts.channelName - Discord channel name
   * @param {string} opts.guildName - Discord guild/server name
   * @param {string} opts.sourceName - Name of the captured source
   * @param {Function} opts.onStop - Callback when user clicks stop
   */
  function init(opts) {
    const { stream, channelName, guildName, sourceName, onStop } = opts;
    onStopCallback = onStop || null;
    startTime = Date.now();

    const container = document.getElementById("screen-live");
    if (!container) return;

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
            </div>
          </div>
          <div class="live-timer" id="liveTimer">00:00:00</div>
        </div>

        <div class="live-preview">
          <video id="livePreviewVideo" autoplay muted playsinline></video>
          <div class="live-preview-label">${escapeHtml(sourceName || "Captura de tela")}</div>
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
