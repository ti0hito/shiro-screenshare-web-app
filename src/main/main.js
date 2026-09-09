const path = require("path");
let app = null;
let BrowserWindow, ipcMain, desktopCapturer, protocol, shell, Tray, Menu;
let autoUpdater = null;
let tray = null;

function resolveEnvPath() {
  const appPath = app && app.getAppPath ? app.getAppPath() : __dirname;
  const candidates = [
    path.join(__dirname, "..", "..", ".env"),
    path.join(process.resourcesPath || "", ".env"),
    path.join(appPath, ".env"),
  ];

  for (const candidate of candidates) {
    try {
      if (candidate && require("fs").existsSync(candidate)) {
        return candidate;
      }
    } catch (e) {
      // ignore
    }
  }

  return path.join(__dirname, "..", "..", ".env");
}

// ── Load .env ──
require("dotenv").config({ path: resolveEnvPath() });

try {
  const electron = require("electron");
  app = electron.app;
  BrowserWindow = electron.BrowserWindow;
  ipcMain = electron.ipcMain;
  desktopCapturer = electron.desktopCapturer;
  protocol = electron.protocol;
  shell = electron.shell;
  Tray = electron.Tray;
  Menu = electron.Menu;
  // Expose nativeImage for icon handling
  nativeImage = electron.nativeImage;
} catch (e) {
  console.error("Failed to load Electron:", e.message);
  process.exit(1);
}

try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (e) {
  console.warn("electron-updater unavailable:", e.message);
}

// Expose a simple IPC to give renderer the resources path
try {
  if (ipcMain && app) {
    ipcMain.handle('get-resources-path', () => {
      return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');
    });
  }
} catch (e) {
  // non-fatal
}

/**
 * SISTEMA DE CAPTURA DE ÁUDIO MULTI-CAMADA
 * ========================================
 * Este sistema implementa múltiplas estratégias de captura de áudio
 * para garantir máxima estabilidade e compatibilidade:
 * 
 * 1. PROCESS_LOOPBACK: Captura por processo específico via WASAPI
 *    - Mais preciso para capturar áudio de um app específico
 *    - Requer que o processo tenha áudio ativo
 * 
 * 2. SYSTEM_LOOPBACK: Captura de sistema completo via WASAPI
 *    - Captura todo o áudio do sistema
 *    - Mais estável que captura por processo
 * 
 * 3. NATIVE_BROWSER: Captura nativa do navegador
 *    - Sempre disponível como fallback
 *    - Usa getUserMedia com chromeMediaSource
 * 
 * O sistema testa automaticamente cada método e usa o que funcionar,
 * com fallback automático para o próximo método.
 */

// ── Single Instance Lock ──
let gotLock = true;
if (app && app.requestSingleInstanceLock) {
  try {
    gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
      app.quit();
    }
  } catch (e) {
    console.log("Single instance lock not available:", e.message);
  }
}

// ── Deep Link Protocol ──
if (app && app.setAsDefaultProtocolClient) {
  try {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient("shiro", process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient("shiro");
    }
  } catch (e) {
    console.log("Protocol registration not available:", e.message);
  }
}

let mainWindow = null;
let pendingDeepLink = null;
let appShouldQuit = false;

function restoreWindowFromTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (!app || !Tray || !Menu || process.platform !== "win32") {
    return;
  }

  if (tray) {
    return;
  }

  const trayIconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(__dirname, "..", "..", "icon.ico");

  tray = new Tray(trayIconPath);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Abrir",
      click: () => restoreWindowFromTray(),
    },
    {
      label: "Fechar para bandeja",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.hide();
        }
      },
    },
    {
      label: "Sair",
      click: () => {
        appShouldQuit = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.close();
        } else {
          app.quit();
        }
      },
    },
  ]);

  tray.setToolTip("Shiro Screen Share");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => restoreWindowFromTray());
}

// Ensure Windows uses the correct AppUserModelID so taskbar groups and icons are correct
try {
  if (process.platform === "win32" && app && app.setAppUserModelId) {
    app.setAppUserModelId("com.shiro.screenshare");
  }
  // Set a friendly app name (used by Windows shell)
  if (app && app.name !== "Shiro Screen Share") {
    app.name = "Shiro Screen Share";
  }
} catch (e) {
  // non-fatal
}

// ── Deep Link Protocol ──
if (app && app.setAsDefaultProtocolClient) {
  try {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient("shiro", process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient("shiro");
    }
  } catch (e) {
    console.log("Protocol registration not available:", e.message);
  }
}

// ── Parse Deep Link URL ──
function parseDeepLink(url) {
  try {
    // shiro://capture?roomName=...&userId=...&userName=...
    const parsed = new URL(url);
    if (parsed.protocol !== "shiro:") return null;

    const params = {};
    for (const [key, value] of parsed.searchParams) {
      params[key] = decodeURIComponent(value);
    }
    params._action = parsed.hostname || parsed.pathname?.replace(/^\/+/, "");
    return params;
  } catch {
    return null;
  }
}

// ── Handle deep link from argv (cold start) ──
function handleArgv(argv) {
  const deepLinkArg = argv.find((arg) => arg.startsWith("shiro://"));
  if (deepLinkArg) {
    const params = parseDeepLink(deepLinkArg);
    if (params) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("deep-link", params);
        mainWindow.show();
        mainWindow.focus();
      } else {
        pendingDeepLink = params;
      }
    }
  }
}

// ── Second Instance (already running, new deep link) ──
if (app && app.on) {
  try {
    app.on("second-instance", (_event, argv) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
      handleArgv(argv);
    });
  } catch (e) {
    console.log("Second instance handler not available:", e.message);
  }
}

// ── Windows: open-url event ──
if (app && app.on) {
  try {
    app.on("open-url", (_event, url) => {
      const params = parseDeepLink(url);
      if (params) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("deep-link", params);
          mainWindow.show();
          mainWindow.focus();
        } else {
          pendingDeepLink = params;
        }
      }
    });
  } catch (e) {
    console.log("Open-url handler not available:", e.message);
  }
}

// ── Create Window ──
function createWindow() {
  console.log("[Shiro] Creating main window...");

  const appIconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(__dirname, "..", "..", "icon.ico");
  
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    frame: false,
    transparent: false,
    backgroundColor: "#09090b",
    titleBarStyle: "hidden",
    titleBarOverlay: false,
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
    show: false,
  });

  console.log("[Shiro] Loading HTML file...");
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  createTray();

  mainWindow.once("ready-to-show", () => {
    console.log("[Shiro] Window ready to show");
    mainWindow.show();

    // Send pending deep link if app was cold-started via protocol
    if (pendingDeepLink) {
      mainWindow.webContents.send("deep-link", pendingDeepLink);
      pendingDeepLink = null;
    }
  });

  mainWindow.on("minimize", (event) => {
    if (process.platform === "win32" && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("close", (event) => {
    if (process.platform === "win32" && tray && !appShouldQuit) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
  });

  mainWindow.on("closed", () => {
    console.log("[Shiro] Window closed");
    mainWindow = null;
    if (appShouldQuit && app && app.quit) {
      app.quit();
    }
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  
  console.log("[Shiro] Window created successfully");
}

function configureAutoUpdater() {
  if (!autoUpdater || !app || !app.isPackaged) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[Updater] Verificando atualizações...");
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[Updater] Atualização disponível:", info && info.version ? info.version : "unknown");
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log("[Updater] Nenhuma atualização disponível.", info);
  });

  autoUpdater.on("download-progress", (progressObj) => {
    const percent = progressObj && typeof progressObj.percent === "number" ? progressObj.percent.toFixed(1) : "0";
    console.log("[Updater] Download em progresso:", `${percent}%`);
  });

  autoUpdater.on("error", (error) => {
    console.error("[Updater] Erro ao atualizar:", error && error.message ? error.message : error);
  });

  autoUpdater.on("update-downloaded", () => {
    console.log("[Updater] Atualização concluída. A instalação será feita ao reiniciar.");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-downloaded");
    }
  });
}

async function checkForUpdates() {
  if (!autoUpdater || !app || !app.isPackaged) {
    return { enabled: false, reason: "not-packaged" };
  }

  try {
    const result = await autoUpdater.checkForUpdatesAndNotify();
    return { enabled: true, result };
  } catch (error) {
    console.error("[Updater] Falha no checkForUpdatesAndNotify:", error);
    return { enabled: true, error: error && error.message ? error.message : String(error) };
  }
}

// ── IPC Handlers ──

if (ipcMain && ipcMain.handle) {
  try {
    ipcMain.handle("check-for-updates", async () => {
      return checkForUpdates();
    });

    ipcMain.handle("install-update", async () => {
      if (!autoUpdater || !app || !app.isPackaged) {
        return { installed: false, reason: "not-packaged" };
      }

      try {
        autoUpdater.quitAndInstall(false, true);
        return { installed: true };
      } catch (error) {
        return { installed: false, error: error && error.message ? error.message : String(error) };
      }
    });
  } catch (e) {
    console.log("IPC update handlers not available:", e.message);
  }
}

// Get desktop sources (screens + windows)
if (ipcMain && ipcMain.handle && desktopCapturer) {
  try {
    ipcMain.handle("get-sources", async (_event, types) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: types || ["screen", "window"],
          thumbnailSize: { width: 320, height: 180 },
          fetchWindowIcons: true,
        });

        return sources.map((source) => ({
          id: source.id,
          name: source.name,
          displayId: source.display_id,
          thumbnail: source.thumbnail.toDataURL(),
          appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
        }));
      } catch (err) {
        console.error("Failed to get sources:", err);
        return [];
      }
    });
  } catch (e) {
    console.log("IPC get-sources handler not available:", e.message);
  }
}



// Window controls
if (ipcMain && ipcMain.on) {
  try {
    ipcMain.on("window-minimize", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      if (process.platform === "win32" && tray) {
        mainWindow.hide();
        return;
      }

      mainWindow.minimize();
    });

    ipcMain.on("window-close", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      if (process.platform === "win32" && tray) {
        appShouldQuit = false;
        mainWindow.hide();
        return;
      }

      mainWindow.close();
    });
  } catch (e) {
    console.log("IPC window controls not available:", e.message);
  }
}

// ── Multi-Layer Audio Capture System ──
// Implementa múltiplas camadas de captura para máxima estabilidade
const loopback = require("loopback-capture");
const koffi = require("koffi");
const user32 = koffi.load("user32.dll");
const GetWindowThreadProcessId = user32.func("uint32 __stdcall GetWindowThreadProcessId(uintptr_t hWnd, _Out_ uint32 *lpdwProcessId)");
const { execSync } = require('child_process');

let activeLoopbackCapture = null;
let audioCaptureMethod = null;
let audioFallbackUsed = false;

const AUDIO_METHODS = {
  NATIVE_BROWSER: 'native-browser',
  SYSTEM_LOOPBACK: 'system-loopback',
  PROCESS_LOOPBACK: 'process-loopback',
  VIRTUAL_DEVICE: 'virtual-device'
};

function getPidFromHwnd(hwndInt) {
  if (!hwndInt) return 0;
  try {
    const pidBox = [0];
    GetWindowThreadProcessId(hwndInt, pidBox);
    return pidBox[0] || 0;
  } catch (err) {
    console.error("getPidFromHwnd error:", err);
    return 0;
  }
}

async function testAudioSystem() {
  console.log("[Audio] 🔍 Testando sistema de áudio multi-camada...");
  
  const results = {
    nativeBrowser: true,
    systemLoopback: false,
    virtualDevices: [],
    recommendedMethod: AUDIO_METHODS.NATIVE_BROWSER
  };
  
  try {
    const testCapture = new loopback.LoopbackCapture();
    let receivedData = false;
    
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try { testCapture.stop(); } catch (e) {}
        resolve(false);
      }, 2000);
      
      try {
        testCapture.startSystemAudio((chunk) => {
          if (chunk && chunk.length > 0) {
            receivedData = true;
            clearTimeout(timeout);
            try { testCapture.stop(); } catch (e) {}
            resolve(true);
          }
        });
      } catch (e) {
        clearTimeout(timeout);
        resolve(false);
      }
    });
    
    results.systemLoopback = receivedData;
    console.log("[Audio]", receivedData ? "✓" : "✗", "WASAPI Loopback:", receivedData ? "funcionando" : "não disponível");
  } catch (e) {
    console.log("[Audio] ✗ WASAPI Loopback: erro de teste", e.message);
    results.systemLoopback = false;
  }
  
  if (results.systemLoopback) {
    results.recommendedMethod = AUDIO_METHODS.SYSTEM_LOOPBACK;
    console.log("[Audio] 🎯 Método recomendado: System Loopback (WASAPI)");
  } else {
    results.recommendedMethod = AUDIO_METHODS.NATIVE_BROWSER;
    console.log("[Audio] 🎯 Método recomendado: Native Browser (fallback)");
  }
  
  console.log("[Audio] 🔍 Teste concluído:", results);
  return results;
}

if (ipcMain && ipcMain.handle) {
  try {
    ipcMain.handle("start-process-audio", async (event, sourceId, mode = "system", targetPid = null) => {
      try {
        if (activeLoopbackCapture) {
          try { activeLoopbackCapture.stop(); } catch (e) {}
          activeLoopbackCapture = null;
        }

        audioCaptureMethod = null;
        audioFallbackUsed = false;
        
        console.log("[Audio] 🚀 Iniciando captura multi-camada - Modo:", mode, "PID:", targetPid);

        const audioTest = await testAudioSystem();
        
        const captureStrategies = [];
        
        if (mode === "app" && targetPid) {
          const processName = getProcessNameFromPid(targetPid);
          console.log(`[Audio] 🎯 Alvo: Processo ${targetPid} (${processName})`);
          
          if (audioTest.systemLoopback) {
            captureStrategies.push({
              name: AUDIO_METHODS.PROCESS_LOOPBACK,
              priority: 1,
              execute: () => tryProcessLoopback(targetPid, processName)
            });
          }
        }
        
        if (audioTest.systemLoopback) {
          captureStrategies.push({
            name: AUDIO_METHODS.SYSTEM_LOOPBACK,
            priority: 2,
            execute: () => trySystemLoopback()
          });
        }
        
        captureStrategies.push({
          name: AUDIO_METHODS.NATIVE_BROWSER,
          priority: 3,
          execute: () => tryNativeCapture()
        });
        
        for (const strategy of captureStrategies) {
          console.log(`[Audio] 🔄 Tentando estratégia: ${strategy.name} (prioridade ${strategy.priority})`);
          
          try {
            const result = await strategy.execute();
            
            if (result.success) {
              console.log(`[Audio] ✅ Estratégia ${strategy.name} funcionou!`);
              audioCaptureMethod = strategy.name;
              
              if (strategy.name === AUDIO_METHODS.NATIVE_BROWSER) {
                audioFallbackUsed = true;
                mainWindow.webContents.send("audio-fallback-used", { 
                  reason: "all-advanced-methods-failed",
                  method: AUDIO_METHODS.NATIVE_BROWSER
                });
              }
              
              return result;
            }
          } catch (e) {
            console.log(`[Audio] ❌ Estratégia ${strategy.name} falhou:`, e.message);
          }
        }
        
        console.log("[Audio] ⚠️ Todas as estratégias avançadas falharam, usando captura nativa");
        audioFallbackUsed = true;
        mainWindow.webContents.send("audio-use-native", { reason: "all-methods-failed" });
        
        return { success: false, needsNative: true };
        
      } catch (err) {
        console.error("[Audio] ❌ Erro geral no sistema multi-camada:", err);
        try {
          mainWindow.webContents.send("audio-use-native", { reason: "general-error", error: err.message });
        } catch (e) {}
        return { success: false, needsNative: true };
      }
    });
  } catch (e) {
    console.log("IPC start-process-audio handler not available:", e.message);
  }
}

async function tryProcessLoopback(targetPid, processName) {
  return new Promise((resolve, reject) => {
    try {
      const capture = new loopback.LoopbackCapture();
      let chunkCount = 0;
      let receivedData = false;
      let resolveCalled = false;
      
      const timeout = setTimeout(() => {
        if (!resolveCalled) {
          resolveCalled = true;
          try { capture.stop(); } catch (e) {}
          console.log(`[Audio] ⏱️ Process loopback timeout`);
          reject(new Error("Process audio timeout"));
        }
      }, 3000);
      
      try {
        capture.start(targetPid, false, (chunk) => {
          chunkCount++;
          if (!receivedData && chunk && chunk.length > 0) {
            receivedData = true;
            console.log(`[Audio] ✅ Process loopback: dados recebidos! Chunks: ${chunkCount}`);
          }
          
          if (mainWindow && !mainWindow.isDestroyed() && chunk && chunk.length) {
            const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
            mainWindow.webContents.send("process-audio-data", ab);
          }
        });
        
        activeLoopbackCapture = capture;
        
        setTimeout(() => {
          if (!resolveCalled) {
            if (receivedData) {
              resolveCalled = true;
              clearTimeout(timeout);
              resolve({
                success: true,
                pid: targetPid,
                mode: "app",
                method: AUDIO_METHODS.PROCESS_LOOPBACK,
                processName: processName,
                sampleRate: 48000,
                channels: 2
              });
            } else {
              resolveCalled = true;
              clearTimeout(timeout);
              try { capture.stop(); } catch (e) {}
              reject(new Error("No audio data received from process"));
            }
          }
        }, 1500);
        
      } catch (e) {
        if (!resolveCalled) {
          resolveCalled = true;
          clearTimeout(timeout);
          reject(e);
        }
      }
    } catch (e) {
      reject(e);
    }
  });
}

async function trySystemLoopback() {
  return new Promise((resolve, reject) => {
    try {
      const capture = new loopback.LoopbackCapture();
      let chunkCount = 0;
      let receivedData = false;
      let resolveCalled = false;
      
      const timeout = setTimeout(() => {
        if (!resolveCalled) {
          resolveCalled = true;
          try { capture.stop(); } catch (e) {}
          console.log("[Audio] ⏱️ System loopback timeout");
          reject(new Error("System audio timeout"));
        }
      }, 3000);
      
      try {
        capture.startSystemAudio((chunk) => {
          chunkCount++;
          if (!receivedData && chunk && chunk.length > 0) {
            receivedData = true;
            console.log(`[Audio] ✅ System loopback: dados recebidos! Chunks: ${chunkCount}`);
          }
          
          if (mainWindow && !mainWindow.isDestroyed() && chunk && chunk.length) {
            const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
            mainWindow.webContents.send("process-audio-data", ab);
          }
        });
        
        activeLoopbackCapture = capture;
        
        setTimeout(() => {
          if (!resolveCalled) {
            if (receivedData) {
              resolveCalled = true;
              clearTimeout(timeout);
              resolve({
                success: true,
                pid: null,
                mode: "system",
                method: AUDIO_METHODS.SYSTEM_LOOPBACK,
                sampleRate: 48000,
                channels: 2
              });
            } else {
              resolveCalled = true;
              clearTimeout(timeout);
              try { capture.stop(); } catch (e) {}
              reject(new Error("No audio data received from system"));
            }
          }
        }, 1500);
        
      } catch (e) {
        if (!resolveCalled) {
          resolveCalled = true;
          clearTimeout(timeout);
          reject(e);
        }
      }
    } catch (e) {
      reject(e);
    }
  });
}

async function tryNativeCapture() {
  console.log("[Audio] 📱 Indicando uso de captura nativa do navegador");
  return {
    success: false,
    needsNative: true,
    method: AUDIO_METHODS.NATIVE_BROWSER
  };
}

function getProcessNameFromPid(pid) {
  try {
    const result = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' });
    const parts = result.split(',');
    if (parts.length > 0) {
      const processName = parts[0].replace(/"/g, '').trim();
      return processName;
    }
  } catch (e) {
    console.log("[Audio] Erro ao obter nome do processo:", e.message);
  }
  return "";
}

if (ipcMain && ipcMain.handle) {
  try {
    ipcMain.handle("stop-process-audio", () => {
      if (activeLoopbackCapture) {
        try { activeLoopbackCapture.stop(); } catch (e) {}
        activeLoopbackCapture = null;
        console.log("Stopped WASAPI process loopback capture");
      }
      
      audioCaptureMethod = null;
      return true;
    });
  } catch (e) {
    console.log("IPC stop-process-audio handler not available:", e.message);
  }
}

// Get app version
if (ipcMain && ipcMain.handle && app) {
  try {
    ipcMain.handle("get-app-version", () => {
      return app.getVersion();
    });
  } catch (e) {
    console.log("IPC get-app-version handler not available:", e.message);
  }
}

// Get config (BACKEND_URL, LIVEKIT_URL)
if (ipcMain && ipcMain.handle) {
  try {
    ipcMain.handle("get-config", () => {
      return {
        backendUrl: process.env.BACKEND_URL || "https://shiro-webapp-backend.vercel.app/",
        livekitUrl: process.env.LIVEKIT_URL || "wss://livekit.shirobot.xyz",
      };
    });
  } catch (e) {
    console.log("IPC get-config handler not available:", e.message);
  }
}

// ── App Lifecycle ──
if (app && app.whenReady) {
  try {
    app.whenReady().then(() => {
      configureAutoUpdater();
      createWindow();

      setTimeout(() => {
        if (app && app.isPackaged) {
          checkForUpdates();
        }
      }, 5000);

      // Handle deep link from initial argv (cold start on Windows)
      handleArgv(process.argv);
    });
  } catch (e) {
    console.log("App lifecycle error:", e.message);
  }
}

if (app && app.on) {
  try {
    app.on("window-all-closed", () => {
      app.quit();
    });
  } catch (e) {
    console.log("Window-all-closed handler not available:", e.message);
  }
}

if (app && app.on && BrowserWindow) {
  try {
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (e) {
    console.log("Activate handler not available:", e.message);
  }
}
