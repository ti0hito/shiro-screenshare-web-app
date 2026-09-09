/**
 * Source Picker — Lists screens and windows with thumbnails
 * Uses Electron's desktopCapturer via preload bridge
 */

const SourcePicker = (() => {
  let currentTab = "screen";
  let sources = [];
  let selectedSourceId = null;
  let refreshInterval = null;
  let searchQuery = "";

  // ── SVG Icons ──
  const ICONS = {
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    monitor: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    window: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/></svg>',
  };

  /**
   * Initialize the source picker — bind events, load sources
   */
  function init() {
    // Tab switching
    const tabs = document.querySelectorAll(".source-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const tabType = tab.dataset.tab;
        if (tabType === currentTab) return;
        currentTab = tabType;
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        selectedSourceId = null;
        updateStartButton();
        renderGrid();
      });
    });

    // Search
    const searchInput = document.getElementById("sourceSearch");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderGrid();
      });
    }

    // Load initial sources
    loadSources();

    // Refresh every 2.5 seconds for live thumbnails
    refreshInterval = setInterval(() => {
      loadSources(true);
    }, 2500);
  }

  /**
   * Load sources from Electron's desktopCapturer
   */
  async function loadSources(silent = false) {
    try {
      const newSources = await window.electronAPI.getSources([
        "screen",
        "window",
      ]);
      sources = newSources || [];
      renderGrid();
    } catch (err) {
      console.error("Failed to load sources:", err);
      if (!silent) {
        renderError("Não foi possível listar as fontes de captura.");
      }
    }
  }

  /**
   * Filter sources by current tab and search query
   */
  function getFilteredSources() {
    let filtered;
    if (currentTab === "screen") {
      filtered = sources.filter((s) => s.id.startsWith("screen:"));
    } else {
      filtered = sources.filter((s) => s.id.startsWith("window:"));
    }

    if (searchQuery) {
      filtered = filtered.filter((s) =>
        s.name.toLowerCase().includes(searchQuery)
      );
    }

    return filtered;
  }

  /**
   * Render the source grid
   */
  function renderGrid() {
    const grid = document.getElementById("sourceGrid");
    if (!grid) return;

    const filtered = getFilteredSources();

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="source-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
          <span>${
            searchQuery
              ? "Nenhum resultado para a busca"
              : currentTab === "screen"
              ? "Nenhuma tela encontrada"
              : "Nenhuma janela aberta"
          }</span>
        </div>
      `;
      return;
    }

    // Build HTML, reusing existing elements when possible to reduce flicker
    const existingItems = grid.querySelectorAll(".source-item");
    const existingIds = new Set();
    existingItems.forEach((el) => existingIds.add(el.dataset.id));

    const newIds = new Set(filtered.map((s) => s.id));

    // Remove items no longer present
    existingItems.forEach((el) => {
      if (!newIds.has(el.dataset.id)) {
        el.remove();
      }
    });

    // Add or update items
    filtered.forEach((source, index) => {
      let item = grid.querySelector(`.source-item[data-id="${source.id}"]`);

      if (item) {
        // Update thumbnail
        const img = item.querySelector(".source-item-thumb img");
        if (img && img.src !== source.thumbnail) {
          img.src = source.thumbnail;
        }
        // Update selection state
        if (source.id === selectedSourceId) {
          item.classList.add("selected");
        } else {
          item.classList.remove("selected");
        }
      } else {
        // Create new item
        item = document.createElement("div");
        item.className = `source-item${source.id === selectedSourceId ? " selected" : ""}`;
        item.dataset.id = source.id;
        item.style.animationDelay = `${index * 0.04}s`;

        const appIconHtml = source.appIcon
          ? `<img src="${source.appIcon}" class="source-item-app-icon" alt="" />`
          : `<div class="source-item-app-icon-fallback">${
              source.id.startsWith("screen:") ? ICONS.monitor : ICONS.window
            }</div>`;

        item.innerHTML = `
          <div class="source-item-thumb">
            <img src="${source.thumbnail}" alt="${escapeHtml(source.name)}" />
            <div class="source-item-check">${ICONS.check}</div>
          </div>
          <div class="source-item-info">
            ${appIconHtml}
            <span class="source-item-name" title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</span>
          </div>
        `;

        item.addEventListener("click", () => {
          selectSource(source.id);
        });

        grid.appendChild(item);
      }
    });

    // Remove loading state if present
    const loading = grid.querySelector(".source-loading");
    if (loading) loading.remove();
    const empty = grid.querySelector(".source-empty");
    if (empty && filtered.length > 0) empty.remove();
  }

  /**
   * Select a source
   */
  function selectSource(id) {
    if (selectedSourceId === id) {
      selectedSourceId = null;
    } else {
      selectedSourceId = id;
    }

    // Update grid UI
    const items = document.querySelectorAll(".source-item");
    items.forEach((item) => {
      if (item.dataset.id === selectedSourceId) {
        item.classList.add("selected");
      } else {
        item.classList.remove("selected");
      }
    });

    updateStartButton();
  }

  /**
   * Update start button state
   */
  function updateStartButton() {
    const btn = document.getElementById("btnStartStream");
    if (btn) {
      btn.disabled = !selectedSourceId;
    }
  }

  /**
   * Get the currently selected source
   */
  function getSelectedSource() {
    if (!selectedSourceId) return null;
    return sources.find((s) => s.id === selectedSourceId) || null;
  }

  /**
   * Get audio toggle state
   */
  function getAudioEnabled() {
    const toggle = document.getElementById("audioToggle");
    return toggle ? toggle.checked : true;
  }

  /**
   * Cleanup
   */
  function destroy() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
    selectedSourceId = null;
    sources = [];
    searchQuery = "";
  }

  /**
   * Set room info display
   */
  function setRoomInfo(channelName, guildName) {
    const el = document.getElementById("sourceRoomInfo");
    if (el) {
      if (channelName) {
        el.textContent = `Transmitir para #${channelName}${guildName ? ` (${guildName})` : ""}`;
      } else {
        el.textContent = "";
      }
    }
  }

  function renderError(msg) {
    const grid = document.getElementById("sourceGrid");
    if (grid) {
      grid.innerHTML = `<div class="source-empty"><span>${msg}</span></div>`;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    init,
    destroy,
    getSelectedSource,
    getAudioEnabled,
    setRoomInfo,
    loadSources,
  };
})();
