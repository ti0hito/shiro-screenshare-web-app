/**
 * Settings Panel — Quality, codec, hardware acceleration, presets
 * Persists all values to localStorage
 */

const SettingsPanel = (() => {
  const STORAGE_KEY = "shiro-settings";

  const PRESETS = {
    gamer: {
      name: "Gamer",
      emoji: "🚀",
      desc: "1080p 60FPS",
      res: "1080",
      fps: "60",
      bit: "6000",
    },
    gamer720: {
      name: "Gamer Leve",
      emoji: "⚡",
      desc: "720p 60FPS",
      res: "720",
      fps: "60",
      bit: "4000",
    },
    balanced: {
      name: "Equilibrado",
      emoji: "🎬",
      desc: "1080p 30FPS",
      res: "1080",
      fps: "30",
      bit: "4000",
    },
    max: {
      name: "Alta Qualidade",
      emoji: "💎",
      desc: "1440p 60FPS",
      res: "1440",
      fps: "60",
      bit: "9000",
    },
    economy: {
      name: "Economia",
      emoji: "🍃",
      desc: "480p 30FPS",
      res: "480",
      fps: "30",
      bit: "1500",
    },
  };

  let settings = {
    preset: "gamer",
    resolution: "1080",
    customWidth: "1920",
    customHeight: "1080",
    fps: "60",
    bitrate: "6000",
    codec: "h264",
    hwAccel: true,
    simulcast: false,
    isolateAudio: false,
  };

  function sanitizeNumber(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    const clamped = Math.min(Math.max(parsed, min), max);
    return String(clamped);
  }

  function clampSafeSettings() {
    settings.fps = sanitizeNumber(settings.fps, "60", 15, 60);
    settings.bitrate = sanitizeNumber(settings.bitrate, "6000", 500, 9000);
    settings.customWidth = sanitizeNumber(settings.customWidth, "1920", 480, 3840);
    settings.customHeight = sanitizeNumber(settings.customHeight, "1080", 360, 2160);
  }

  function getQualitySummary() {
    clampSafeSettings();
    const width = settings.resolution === "custom"
      ? sanitizeNumber(settings.customWidth, 1920, 480, 3840)
      : getResolutionConstraint().width;
    const height = settings.resolution === "custom"
      ? sanitizeNumber(settings.customHeight, 1080, 360, 2160)
      : getResolutionConstraint().height;
    const fps = sanitizeNumber(settings.fps, 60, 15, 60);
    const bitrate = sanitizeNumber(settings.bitrate, 6000, 500, 9000);

    return `${width}×${height} • ${fps} FPS • ${Number.parseInt(bitrate, 10) / 1000} Mbps`;
  }

  /**
   * Initialize settings panel — load from storage, render UI
   */
  function init() {
    loadFromStorage();
    renderPanel();
    bindOverlayEvents();
  }

  /**
   * Load settings from localStorage
   */
  function loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        settings = { ...settings, ...parsed };
      }
    } catch {
      // Use defaults
    }

    clampSafeSettings();
  }

  /**
   * Save settings to localStorage
   */
  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Silent fail
    }

    window.dispatchEvent(
      new CustomEvent("shiro-settings-changed", {
        detail: { settings: { ...settings } },
      })
    );
  }

  /**
   * Render the settings panel HTML
   */
  function renderPanel() {
    const panel = document.getElementById("settingsPanel");
    if (!panel) return;

    panel.innerHTML = `
      <div class="settings-title">
        <span>Configurações</span>
        <button class="settings-close" id="btnCloseSettings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Perfis Rápidos</div>
        <div class="preset-grid">
          ${Object.entries(PRESETS)
            .map(
              ([key, p]) => `
            <button class="preset-btn${settings.preset === key ? " active" : ""}" data-preset="${key}">
              <span class="preset-emoji">${p.emoji}</span>
              <span class="preset-info">
                <span class="preset-name">${p.name}</span>
                <span class="preset-desc">${p.desc}</span>
              </span>
            </button>
          `
            )
            .join("")}
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Qualidade de Vídeo</div>

        <div class="settings-option settings-option-stack">
          <div class="settings-option-head">
            <label>Resolução</label>
            <select id="settingRes">
              <option value="480" ${settings.resolution === "480" ? "selected" : ""}>480p (SD)</option>
              <option value="720" ${settings.resolution === "720" ? "selected" : ""}>720p (HD)</option>
              <option value="1080" ${settings.resolution === "1080" ? "selected" : ""}>1080p (Full HD)</option>
              <option value="1440" ${settings.resolution === "1440" ? "selected" : ""}>1440p (2K)</option>
              <option value="custom" ${settings.resolution === "custom" ? "selected" : ""}>Personalizada</option>
            </select>
          </div>
          <div class="settings-inline-fields ${settings.resolution === "custom" ? "active" : ""}">
            <div class="settings-inline-field">
              <span>Largura</span>
              <input id="settingCustomWidth" type="number" min="480" max="3840" step="10" value="${settings.customWidth || "1920"}" />
            </div>
            <div class="settings-inline-field">
              <span>Altura</span>
              <input id="settingCustomHeight" type="number" min="360" max="2160" step="10" value="${settings.customHeight || "1080"}" />
            </div>
          </div>
        </div>

        <div class="settings-option settings-option-stack">
          <div class="settings-option-head">
            <label>Taxa de Quadros</label>
            <input id="settingFps" type="number" min="15" max="60" step="5" value="${settings.fps || "60"}" />
          </div>
          <div class="settings-help-text">Limite fixo: 60 FPS máximo.</div>
        </div>

        <div class="settings-option settings-option-stack">
          <div class="settings-option-head">
            <label>Bitrate</label>
            <div class="settings-bitrate-input">
              <input id="settingBitrate" type="number" min="500" max="9000" step="250" value="${settings.bitrate || "6000"}" />
              <span>kbps</span>
            </div>
          </div>
          <div class="settings-help-text">Limite fixo: 9000 kbps máximo. Resumo ativo: ${getQualitySummary()}</div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Avançado</div>

        <div class="settings-option">
          <label>Codec de Vídeo</label>
          <select id="settingCodec">
            <option value="vp8" ${settings.codec === "vp8" ? "selected" : ""}>VP8 (Compatível)</option>
            <option value="vp9" ${settings.codec === "vp9" ? "selected" : ""}>VP9 (Melhor qualidade)</option>
            <option value="h264" ${settings.codec === "h264" ? "selected" : ""}>H.264 (HW Acelerado)</option>
          </select>
        </div>

        <div class="settings-option">
          <label>Aceleração de Hardware</label>
          <div class="toggle-switch">
            <input type="checkbox" id="settingHwAccel" ${settings.hwAccel ? "checked" : ""} />
            <label for="settingHwAccel" class="toggle-slider"></label>
          </div>
        </div>

        <div class="settings-option">
          <label>Isolar Áudio da Janela (Experimental)</label>
          <div class="toggle-switch">
            <input type="checkbox" id="settingIsolateAudio" ${settings.isolateAudio ? "checked" : ""} />
            <label for="settingIsolateAudio" class="toggle-slider"></label>
          </div>
        </div>

        <div class="settings-option">
          <label>Simulcast</label>
          <div class="toggle-switch">
            <input type="checkbox" id="settingSimulcast" ${settings.simulcast ? "checked" : ""} />
            <label for="settingSimulcast" class="toggle-slider"></label>
          </div>
        </div>
      </div>
    `;

    bindPanelEvents();
  }

  /**
   * Bind events inside the settings panel
   */
  function bindPanelEvents() {
    // Close button
    const closeBtn = document.getElementById("btnCloseSettings");
    if (closeBtn) {
      closeBtn.addEventListener("click", hide);
    }

    // Preset buttons
    document.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const presetKey = btn.dataset.preset;
        applyPreset(presetKey);
      });
    });

    // Select changes
    const resEl = document.getElementById("settingRes");
    const fpsEl = document.getElementById("settingFps");
    const bitEl = document.getElementById("settingBitrate");
    const customWidthEl = document.getElementById("settingCustomWidth");
    const customHeightEl = document.getElementById("settingCustomHeight");
    const codecEl = document.getElementById("settingCodec");
    const hwEl = document.getElementById("settingHwAccel");
    const simEl = document.getElementById("settingSimulcast");
    const isoEl = document.getElementById("settingIsolateAudio");

    if (resEl) resEl.addEventListener("change", (e) => {
      settings.resolution = e.target.value;
      if (settings.resolution !== "custom") {
        settings.customWidth = String(getResolutionConstraint().width);
        settings.customHeight = String(getResolutionConstraint().height);
      }
      saveToStorage();
      renderPanel();
    });
    if (fpsEl) fpsEl.addEventListener("input", (e) => {
      settings.fps = sanitizeNumber(e.target.value, "60", 15, 60);
      saveToStorage();
      renderPanel();
    });
    if (bitEl) bitEl.addEventListener("input", (e) => {
      settings.bitrate = sanitizeNumber(e.target.value, "6000", 500, 9000);
      saveToStorage();
      renderPanel();
    });
    if (customWidthEl) customWidthEl.addEventListener("input", (e) => {
      settings.resolution = "custom";
      settings.customWidth = sanitizeNumber(e.target.value, "1920", 480, 3840);
      saveToStorage();
      renderPanel();
    });
    if (customHeightEl) customHeightEl.addEventListener("input", (e) => {
      settings.resolution = "custom";
      settings.customHeight = sanitizeNumber(e.target.value, "1080", 360, 2160);
      saveToStorage();
      renderPanel();
    });
    if (codecEl) codecEl.addEventListener("change", (e) => { settings.codec = e.target.value; saveToStorage(); });
    if (hwEl) hwEl.addEventListener("change", (e) => { settings.hwAccel = e.target.checked; saveToStorage(); });
    if (simEl) simEl.addEventListener("change", (e) => { settings.simulcast = e.target.checked; saveToStorage(); });
    if (isoEl) isoEl.addEventListener("change", (e) => { settings.isolateAudio = e.target.checked; saveToStorage(); });
  }

  /**
   * Bind overlay click-outside-to-close
   */
  function bindOverlayEvents() {
    const overlay = document.getElementById("settingsOverlay");
    if (overlay) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) hide();
      });
    }
  }

  /**
   * Apply a preset
   */
  function applyPreset(presetKey) {
    const p = PRESETS[presetKey];
    if (!p) return;

    settings.preset = presetKey;
    settings.resolution = p.res;
    settings.fps = p.fps;
    settings.bitrate = p.bit;
    saveToStorage();
    renderPanel();
  }

  /**
   * Show the settings panel
   */
  function show() {
    const overlay = document.getElementById("settingsOverlay");
    if (overlay) overlay.classList.add("active");
  }

  /**
   * Hide the settings panel
   */
  function hide() {
    const overlay = document.getElementById("settingsOverlay");
    if (overlay) overlay.classList.remove("active");
  }

  /**
   * Get current settings
   */
  function getSettings() {
    return { ...settings };
  }

  /**
   * Get resolution constraint
   */
  function getResolutionConstraint() {
    clampSafeSettings();
    const frameRate = parseInt(settings.fps, 10);
    if (settings.resolution === "custom") {
      const width = sanitizeNumber(settings.customWidth, 1920, 480, 3840);
      const height = sanitizeNumber(settings.customHeight, 1080, 360, 2160);
      return { width: Number.parseInt(width, 10), height: Number.parseInt(height, 10), frameRate };
    }

    switch (settings.resolution) {
      case "480": return { width: 854, height: 480, frameRate };
      case "720": return { width: 1280, height: 720, frameRate };
      case "1080": return { width: 1920, height: 1080, frameRate };
      case "1440": return { width: 2560, height: 1440, frameRate };
      default: return { width: 1920, height: 1080, frameRate };
    }
  }

  return {
    init,
    show,
    hide,
    getSettings,
    getResolutionConstraint,
  };
})();
