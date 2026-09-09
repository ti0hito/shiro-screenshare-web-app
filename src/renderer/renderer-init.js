(async () => {
  try {
    if (!window.electronAPI || !window.electronAPI.getResourcesPath) return;
    const resPath = await window.electronAPI.getResourcesPath();
    if (!resPath) return;
    const normalized = resPath.replace(/\\\\/g, '/');
    const iconUrl = `file:///${normalized}/icon.ico`;

    function applyIcon(img) {
      try {
        if (img && img.src !== iconUrl) img.src = iconUrl;
      } catch (e) {}
    }

    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('.titlebar-icon, .idle-logo').forEach(applyIcon);

      // Watch for future DOM changes (some app code may replace elements)
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'childList') {
            m.addedNodes.forEach(node => {
              if (node.nodeType === 1) {
                if (node.matches && (node.matches('.titlebar-icon') || node.matches('.idle-logo'))) applyIcon(node);
                node.querySelectorAll && node.querySelectorAll('.titlebar-icon, .idle-logo').forEach(applyIcon);
              }
            });
          } else if (m.type === 'attributes' && (m.target.classList && (m.target.classList.contains('titlebar-icon') || m.target.classList.contains('idle-logo')))) {
            applyIcon(m.target);
          }
        }
      });

      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'class'] });
    });
  } catch (e) {
    // ignore
  }
})();
