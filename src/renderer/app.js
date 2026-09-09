/**
 * Shiro Screen Share — App Orchestrator
 * Gerencia todo o fluxo: deep links, captura de tela, conexão LiveKit, e telas.
 *
 * Este arquivo é empacotado pelo esbuild (importa livekit-client).
 * O bundle final é `app.bundle.js`.
 * 
 * SISTEMA DE CAPTURA DE ÁUDIO:
 * - Captura nativa simples usando getUserMedia com chromeMediaSource
 */

const {
  Room,
  RoomEvent,
  Track,
  LocalVideoTrack,
  LocalAudioTrack,
  VideoPresets,
  ConnectionState,
} = require("livekit-client");

// Estado global da aplicação

const AppState = {
  // Config (carregada do main process)
  config: {
    backendUrl: "https://shiro-webapp-backend.vercel.app/",
    livekitUrl: "wss://livekit.shirobot.xyz",
  },

  // Sessão atual
  currentScreen: "idle",
  room: null,
  localVideoTrack: null,
  localAudioTrack: null,
  mediaStream: null,
  statsInterval: null,
  keyframeInterval: null,
  previousBytesSent: 0,
  previousStatsTime: 0,
  activeVideoSender: null,
  activeSettings: null,


  // Dados da conexão
  roomName: null,
  userId: null,
  userName: null,
  channelName: null,
  guildName: null,
  backendUrl: null, // Override via deep link ou manual
};

// Inicialização

document.addEventListener("DOMContentLoaded", async () => {
  console.log("[Shiro] App inicializando...");

  // Carregar config do main process
  await loadConfig();

  // Exibir versão no titlebar
  loadAppVersion();

  // Inicializar módulos
  SettingsPanel.init();

  // Bind de eventos da UI
  bindUIEvents();

  // Ouvir deep links
  bindDeepLink();

  window.addEventListener("shiro-settings-changed", (event) => {
    const nextSettings = event.detail?.settings || SettingsPanel.getSettings();
    AppState.activeSettings = nextSettings;

    if (AppState.currentScreen === "live") {
      applyLiveStreamSettings(nextSettings);
    }
  });

  console.log("[Shiro] App pronto. Esperando conexão...");
});

/**
 * Carregar configuração do main process (via preload)
 */
async function loadConfig() {
  try {
    const config = await window.electronAPI.getConfig();
    if (config) {
      if (config.backendUrl) AppState.config.backendUrl = config.backendUrl;
      if (config.livekitUrl) AppState.config.livekitUrl = config.livekitUrl;
    }
    console.log("[Shiro] Config carregada:", AppState.config);
  } catch (err) {
    console.warn("[Shiro] Não foi possível carregar config do main process, usando defaults");
  }
}

/**
 * Exibir versão do app no titlebar
 */
async function loadAppVersion() {
  try {
    const version = await window.electronAPI.getAppVersion();
    const el = document.getElementById("appVersion");
    if (el && version) {
      el.textContent = `v${version}`;
    }
  } catch {
    // Silent
  }
}

// Gerenciamento de Telas

/**
 * Trocar tela ativa
 * @param {"idle"|"source"|"connecting"|"live"|"error"} screenName
 */
function showScreen(screenName) {
  const screens = document.querySelectorAll(".screen");
  screens.forEach((s) => s.classList.remove("active"));

  const target = document.getElementById(`screen-${screenName}`);
  if (target) {
    target.classList.add("active");
  }

  AppState.currentScreen = screenName;
  console.log(`[Shiro] Tela → ${screenName}`);
}

// Deep Link Handler

function bindDeepLink() {
  window.electronAPI.onDeepLink((params) => {
    console.log("[Shiro] Deep link recebido:", params);

    if (!params) return;

    // Extrair parâmetros
    AppState.roomName = params.roomName || params.room || null;
    AppState.userId = params.userId || params.identity || null;
    AppState.channelName = params.channelName || params.channel || null;
    AppState.guildName = params.guildName || params.guild || null;

    // Usar nome customizado do campo de input, ou o que veio no deep link
    const customName = document.getElementById("inputUserName")?.value?.trim();
    AppState.userName = customName || params.userName || params.name || null;

    // Override de backend URL (se fornecido no deep link)
    if (params.backendUrl) {
      AppState.backendUrl = params.backendUrl;
    }

    if (!AppState.roomName || !AppState.userId) {
      console.error("[Shiro] Deep link inválido — faltam roomName/userId");
      showError("Deep link inválido. Verifique os parâmetros da URL.");
      return;
    }

    // Ir para source picker
    goToSourcePicker();
  });
}

// UI Event Bindings

function bindUIEvents() {
  // ── Titlebar ──
  const btnMinimize = document.getElementById("btnMinimize");
  const btnClose = document.getElementById("btnClose");
  if (btnMinimize) btnMinimize.addEventListener("click", () => window.electronAPI.minimize());
  if (btnClose) btnClose.addEventListener("click", () => window.electronAPI.close());



  // ── Start Stream ──
  const btnStartStream = document.getElementById("btnStartStream");
  if (btnStartStream) {
    btnStartStream.addEventListener("click", handleStartStream);
  }

  // ── Settings ──
  const btnSettings = document.getElementById("btnSettings");
  if (btnSettings) {
    btnSettings.addEventListener("click", () => SettingsPanel.show());
  }

  // ── Error Retry ──
  const btnRetry = document.getElementById("btnRetry");
  if (btnRetry) {
    btnRetry.addEventListener("click", handleRetry);
  }
}

/**
 * Ir para a tela de source picker
 */
function goToSourcePicker() {
  showScreen("source");
  SourcePicker.init();
  SourcePicker.setRoomInfo(AppState.channelName, AppState.guildName);
}

/**
 * Handler de retry no erro
 */
function handleRetry() {
  cleanupStream();

  if (AppState.roomName && AppState.userId) {
    goToSourcePicker();
  } else {
    showScreen("idle");
  }
}

// Stream Flow — Principal

/**
 * Iniciar transmissão — chamado quando o usuário clica "Iniciar Transmissão"
 */
async function handleStartStream() {
  const source = SourcePicker.getSelectedSource();
  if (!source) return;

  const audioEnabled = SourcePicker.getAudioEnabled();
  const settings = SettingsPanel.getSettings();
  const resolution = SettingsPanel.getResolutionConstraint();

  console.log("[Shiro] Iniciando transmissão...", {
    source: source.name,
    audio: audioEnabled,
    settings,
    resolution,
  });

  showScreen("connecting");

  try {
    // 1. Buscar token do backend
    const backendUrl = AppState.backendUrl || AppState.config.backendUrl;
    console.log("[Shiro] Buscando token em", backendUrl);

    const captureIdentity = AppState.userId.endsWith("-capture")
      ? AppState.userId
      : `${AppState.userId}-capture`;

    const token = await fetchToken(backendUrl, {
      roomName: AppState.roomName,
      identity: captureIdentity,
      name: `${AppState.userName || AppState.userId} (Tela)`,
    });

    console.log("[Shiro] Token obtido ✓");

    // 2. Capturar tela
    console.log("[Shiro] Capturando tela:", source.id);
    
    const stream = await captureScreen(source.id, resolution, audioEnabled);
    AppState.mediaStream = stream;
    console.log("[Shiro] Tela capturada ✓");

    // 3. Conectar ao LiveKit
    console.log("[Shiro] Conectando ao LiveKit:", AppState.config.livekitUrl);
    await connectToLiveKit(token, stream, settings, resolution);
    console.log("[Shiro] Conectado ao LiveKit ✓");

    // 4. Limpar source picker
    SourcePicker.destroy();

    // 5. Mostrar tela live
    showScreen("live");
    LiveView.init({
      stream: stream,
      channelName: AppState.channelName,
      guildName: AppState.guildName,
      sourceName: source.name,
      onStop: handleStopStream,
    });

    // 6. Iniciar monitoramento de stats
    startStatsMonitor();

    console.log("[Shiro] 🟣 Transmissão ao vivo!");
  } catch (err) {
    console.error("[Shiro] Erro ao iniciar transmissão:", err);
    cleanupStream();
    showError(getErrorMessage(err));
  }
}

/**
 * Parar transmissão
 */
async function handleStopStream() {
  console.log("[Shiro] Parando transmissão...");

  cleanupStream();
  LiveView.destroy();
  showScreen("idle");

  console.log("[Shiro] Transmissão encerrada.");
}

// Token Fetch

/**
 * Buscar token JWT do backend
 * @param {string} backendUrl - URL base do backend
 * @param {Object} data - { roomName, identity, name }
 * @returns {Promise<string>} Token JWT
 */
async function fetchToken(backendUrl, data) {
  const url = `${backendUrl.replace(/\/+$/, "")}/api/get-token`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Falha ao obter token (HTTP ${response.status}): ${errorBody || response.statusText}`
    );
  }

  const result = await response.json();

  if (!result.token) {
    throw new Error("Resposta do backend não contém token");
  }

  return result.token;
}

// Screen Capture

/**
 * Capturar tela usando Electron's desktopCapturer constraint
 * @param {string} sourceId - ID da fonte (screen:0:0 ou window:12345)
 * @param {Object} resolution - { width, height, frameRate }
 * @param {boolean} audioEnabled - Se deve capturar áudio do sistema
 * @returns {Promise<MediaStream>}
 */
async function validateCapturedFrame(stream, { minNonBlackRatio = 0.04, minBrightness = 18 } = {}) {
  const videoTrack = stream?.getVideoTracks?.()[0];
  if (!videoTrack) return;

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.style.display = "none";
  document.body.appendChild(video);

  try {
    await video.play().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 700));

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height).data;

    let brightPixels = 0;
    let totalPixels = 0;

    for (let i = 0; i < imageData.length; i += 4) {
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];
      const luminance = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
      totalPixels += 1;
      if (luminance > minBrightness) {
        brightPixels += 1;
      }
    }

    const nonBlackRatio = totalPixels > 0 ? brightPixels / totalPixels : 0;
    console.log("[Shiro] Validação da captura: razão de pixels visíveis =", nonBlackRatio.toFixed(4));

    if (nonBlackRatio < minNonBlackRatio) {
      throw new Error("A captura está vindo preta ou quase sem imagem. Tente outra janela/tela e deixe a fonte visível antes de iniciar a transmissão.");
    }
  } finally {
    video.pause();
    video.srcObject = null;
    video.remove();
  }
}

async function captureScreen(sourceId, resolution, audioEnabled) {
  console.log("[Shiro] Capturando tela - Fonte:", sourceId, "Áudio:", audioEnabled);
  
  // Configurar constraints para captura nativa simples
  const constraints = {
    audio: audioEnabled ? {
      mandatory: {
        chromeMediaSource: "desktop",
      },
    } : false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        minWidth: resolution.width,
        maxWidth: resolution.width,
        minHeight: resolution.height,
        maxHeight: resolution.height,
        minFrameRate: resolution.frameRate,
        maxFrameRate: resolution.frameRate,
      },
    },
  };

  try {
    console.log("[Shiro] Iniciando captura getUserMedia");
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && "contentHint" in videoTrack) {
      videoTrack.contentHint = "motion";
    }
    
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      console.log("[Shiro] ✅ Áudio capturado:", audioTrack.id);
      audioTrack.enabled = true;
    } else if (audioEnabled) {
      console.warn("[Shiro] ⚠️ Áudio solicitado mas não capturado");
    }
    
    console.log("[Shiro] ✅ Captura completa com sucesso");

    try {
      await validateCapturedFrame(stream);
      return stream;
    } catch (validationErr) {
      stream.getTracks().forEach((track) => track.stop());
      throw validationErr;
    }
    
  } catch (nativeErr) {
    console.error("[Shiro] ❌ Captura falhou:", nativeErr);
    
    // Se áudio falhar, tentar sem áudio
    if (audioEnabled) {
      console.log("[Shiro] Tentando captura sem áudio (fallback)");
      constraints.audio = false;
      
      try {
        const videoOnlyStream = await navigator.mediaDevices.getUserMedia(constraints);
        const videoTrack = videoOnlyStream.getVideoTracks()[0];
        if (videoTrack && "contentHint" in videoTrack) {
          videoTrack.contentHint = "motion";
        }
        console.log("[Shiro] ✅ Captura de vídeo funcionando (sem áudio)");
        return videoOnlyStream;
      } catch (videoErr) {
        console.error("[Shiro] ❌ Captura de vídeo também falhou:", videoErr);
        throw new Error("Não foi possível capturar nem vídeo nem áudio");
      }
    } else {
      throw nativeErr;
    }
  }
}

// LiveKit Connection

/**
 * Conectar ao LiveKit e publicar tracks
 * @param {string} token - JWT token
 * @param {MediaStream} stream - MediaStream capturado
 * @param {Object} settings - Settings do painel (codec, bitrate, etc.)
 * @param {Object} resolution - { width, height, frameRate }
 */
async function applyLiveStreamSettings(settings = AppState.activeSettings || SettingsPanel.getSettings()) {
  if (!AppState.room || AppState.currentScreen !== "live") return;

  const publications = AppState.room.localParticipant.videoTrackPublications;
  const pub = publications && publications.size > 0 ? publications.values().next().value : null;
  const sender = pub?.track?.sender;

  if (!sender || typeof sender.getParameters !== "function") return;

  const targetBitrateKbps = Math.min(Math.max(parseInt(settings.bitrate || "6000", 10) || 6000, 500), 9000);
  const targetFps = Math.min(Math.max(parseInt(settings.fps || "60", 10) || 60, 15), 60);
  const targetBitrateBps = targetBitrateKbps * 1000;

  try {
    const params = sender.getParameters();
    if (!params || !params.encodings) return;

    params.encodings.forEach((enc) => {
      enc.maxBitrate = targetBitrateBps;
      enc.minBitrate = Math.max(500000, Math.floor(targetBitrateBps * 0.5));
      enc.maxFramerate = targetFps;
      enc.scaleResolutionDownBy = 1.0;
      enc.priority = "high";
      enc.networkPriority = "high";
    });

    params.degradationPreference = "maintain-resolution";
    await sender.setParameters(params);
    AppState.activeVideoSender = sender;
    AppState.activeSettings = settings;

    console.log("[Shiro] Configuração aplicada em tempo real:", {
      bitrateKbps: targetBitrateKbps,
      fps: targetFps,
    });
  } catch (err) {
    console.warn("[Shiro] Não foi possível atualizar a configuração ao vivo:", err);
  }
}

async function connectToLiveKit(token, stream, settings, resolution) {
  // Criar room — sem adaptiveStream/dynacast para manter a qualidade exata configurada
  const room = new Room({
    adaptiveStream: false,
    dynacast: false,
    videoCaptureDefaults: {
      resolution: {
        width: resolution.width,
        height: resolution.height,
        frameRate: resolution.frameRate,
      },
    },
  });

  AppState.room = room;

  // Event listeners
  room.on(RoomEvent.Disconnected, (reason) => {
    console.log("[Shiro] Desconectado do LiveKit:", reason);
    if (AppState.currentScreen === "live") {
      cleanupStream();
      LiveView.destroy();
      showError("Conexão com o servidor foi perdida.");
    }
  });

  room.on(RoomEvent.Reconnecting, () => {
    console.log("[Shiro] Reconectando ao LiveKit...");
  });

  room.on(RoomEvent.Reconnected, () => {
    console.log("[Shiro] Reconectado ao LiveKit ✓");
  });

  room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
    if (participant.isLocal) {
      console.log("[Shiro] Qualidade da conexão:", quality);
    }
  });

  // Conectar
  await room.connect(AppState.config.livekitUrl, token);

  // Publicar video track
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    const localVideo = new LocalVideoTrack(videoTrack);
    AppState.localVideoTrack = localVideo;

    const targetBitrateBps = parseInt(settings.bitrate, 10) * 1000;
    const targetFps = parseInt(settings.fps, 10);

    const encodingConfig = {
      maxBitrate: targetBitrateBps,
      maxFramerate: targetFps,
    };

    const publishOptions = {
      source: Track.Source.ScreenShare,
      simulcast: false,
      backupCodec: false,
      videoCodec: settings.codec || "h264",
      videoEncoding: encodingConfig,
      screenShareEncoding: encodingConfig,
      degradationPreference: "maintain-resolution",
    };

    const pub = await room.localParticipant.publishTrack(localVideo, publishOptions);
    AppState.activeVideoSender = pub?.track?.sender || null;
    AppState.activeSettings = settings;
    console.log("[Shiro] Video track publicada (H.264 / NVENC / High Res) ✓");
    
    const minBitrateBps = Math.max(2000000, Math.floor(targetBitrateBps * 0.5));

    if (pub && pub.track && pub.track.sender && typeof pub.track.sender.getParameters === "function") {
      try {
        const params = pub.track.sender.getParameters();
        if (params) {
          params.degradationPreference = "maintain-resolution";
          if (params.encodings && params.encodings.length > 0) {
            params.encodings.forEach((enc) => {
              enc.maxBitrate = targetBitrateBps;
              enc.minBitrate = minBitrateBps;
              enc.maxFramerate = targetFps;
              enc.scaleResolutionDownBy = 1.0;
              enc.networkPriority = "high";
              enc.priority = "high";
            });
          }
          await pub.track.sender.setParameters(params);
        }
      } catch (err) { console.warn("[Shiro] DegradationPreference:", err); }

      // Disparo periódico de keyframe (IDR frame) a cada 2.5s para descongestionar travamentos
      if (AppState.keyframeInterval) clearInterval(AppState.keyframeInterval);
      AppState.keyframeInterval = setInterval(() => {
        if (pub.track.sender && typeof pub.track.sender.generateKeyFrame === "function") {
          pub.track.sender.generateKeyFrame().catch(() => {});
        }
      }, 2500);
    }
  }

  // Publicar audio track (se disponível)
  const audioTrack = stream.getAudioTracks()[0];
  if (audioTrack) {
    console.log("[Shiro] Audio track encontrado no stream:", audioTrack.id, "enabled:", audioTrack.enabled);
    
    // Garantir que o track está ativado
    audioTrack.enabled = true;
    
    const localAudio = new LocalAudioTrack(audioTrack);
    AppState.localAudioTrack = localAudio;

    await room.localParticipant.publishTrack(localAudio, {
      source: Track.Source.ScreenShareAudio,
    });
    console.log("[Shiro] Audio track publicada ✓");
  } else if (AppState.processAudioStream) {
    console.log("[Shiro] Usando áudio do processo WASAPI");
    
    // Criar track a partir do stream do processo
    const processAudioTrack = AppState.processAudioStream.getAudioTracks()[0];
    if (processAudioTrack) {
      const localAudio = new LocalAudioTrack(processAudioTrack);
      AppState.localAudioTrack = localAudio;

      await room.localParticipant.publishTrack(localAudio, {
        source: Track.Source.ScreenShareAudio,
      });
      console.log("[Shiro] Audio track do processo publicada ✓");
    }
  } else {
    console.warn("[Shiro] Nenhum audio track encontrado na stream");
  }
}

// Stats Monitor

/**
 * Iniciar polling de stats
 */
function startStatsMonitor() {
  stopStatsMonitor();

  AppState.previousBytesSent = 0;
  AppState.previousStatsTime = Date.now();

  AppState.statsInterval = setInterval(async () => {
    if (!AppState.room || AppState.currentScreen !== "live") {
      stopStatsMonitor();
      return;
    }

    try {
      const stats = await getStreamStats();
      if (stats) {
        LiveView.updateStats(stats);
      }
    } catch (err) {
      // Silent — stats são best-effort
    }
  }, 2000);
}

/**
 * Parar polling de stats
 */
function stopStatsMonitor() {
  if (AppState.statsInterval) {
    clearInterval(AppState.statsInterval);
    AppState.statsInterval = null;
  }
}

/**
 * Coletar stats do stream WebRTC
 * @returns {Promise<Object|null>}
 */
async function getStreamStats() {
  if (!AppState.room || !AppState.room.localParticipant) return null;

  const publications = AppState.room.localParticipant.videoTrackPublications;
  if (!publications || publications.size === 0) return null;

  const settings = SettingsPanel.getSettings();
  const targetBitrate = Number.parseInt(settings.bitrate || "6000", 10) * 1000;
  const targetFps = Number.parseInt(settings.fps || "60", 10);

  // Pegar a primeira publicação de vídeo
  const pub = publications.values().next().value;
  if (!pub || !pub.track) return null;

  const track = pub.track;
  const sender = track.sender;
  if (!sender) return null;

  try {
    const report = await sender.getStats();
    let currentBytesSent = 0;
    let frameWidth = 0;
    let frameHeight = 0;
    let framesPerSecond = 0;
    let roundTripTime = 0;

    report.forEach((stat) => {
      if (stat.type === "outbound-rtp" && stat.kind === "video") {
        currentBytesSent = stat.bytesSent || 0;
        frameWidth = stat.frameWidth || 0;
        frameHeight = stat.frameHeight || 0;
        framesPerSecond = stat.framesPerSecond || 0;
      }
      if (stat.type === "candidate-pair" && stat.state === "succeeded") {
        roundTripTime = stat.currentRoundTripTime
          ? stat.currentRoundTripTime * 1000
          : 0;
      }
    });

    // Calcular bitrate
    const now = Date.now();
    const timeDelta = (now - AppState.previousStatsTime) / 1000;
    const bytesDelta = currentBytesSent - AppState.previousBytesSent;
    const bitrate = timeDelta > 0 ? (bytesDelta * 8) / timeDelta : 0;

    AppState.previousBytesSent = currentBytesSent;
    AppState.previousStatsTime = now;

    // Determinar qualidade
    let quality = "good";
    if (roundTripTime > 200 || bitrate < 500000) {
      quality = "poor";
    } else if (roundTripTime > 100 || bitrate < 1500000) {
      quality = "fair";
    }

    return {
      bitrate,
      width: frameWidth,
      height: frameHeight,
      fps: framesPerSecond,
      latency: roundTripTime,
      quality,
      targetBitrate,
      targetFps,
    };
  } catch {
    return null;
  }
}

// Cleanup

/**
 * Limpar tudo — tracks, room, intervals
 */
function cleanupStream() {
  console.log("[Shiro] Limpando recursos...");

  stopStatsMonitor();

  if (AppState.keyframeInterval) {
    clearInterval(AppState.keyframeInterval);
    AppState.keyframeInterval = null;
  }

  // Unpublish e fechar tracks do LiveKit
  if (AppState.room && AppState.room.localParticipant) {
    try {
      if (AppState.localVideoTrack) {
        AppState.room.localParticipant.unpublishTrack(AppState.localVideoTrack);
      }
      if (AppState.localAudioTrack) {
        AppState.room.localParticipant.unpublishTrack(AppState.localAudioTrack);
      }
    } catch (err) {
      console.warn("[Shiro] Erro ao unpublish tracks:", err);
    }
  }

  // Desconectar room
  if (AppState.room) {
    try {
      AppState.room.disconnect(true);
    } catch (err) {
      console.warn("[Shiro] Erro ao desconectar room:", err);
    }
    AppState.room = null;
  }

  // Parar MediaStream
  if (AppState.mediaStream) {
    AppState.mediaStream.getTracks().forEach((track) => {
      track.stop();
    });
    AppState.mediaStream = null;
  }

  // Limpar referências
  AppState.localVideoTrack = null;
  AppState.localAudioTrack = null;
  AppState.previousBytesSent = 0;
  AppState.previousStatsTime = 0;
}

// Error Handling

/**
 * Mostrar tela de erro
 * @param {string} message
 */
function showError(message) {
  const errorEl = document.getElementById("errorMessage");
  if (errorEl) {
    errorEl.textContent = message;
  }
  showScreen("error");
}

/**
 * Converter erro em mensagem amigável
 * @param {Error} err
 * @returns {string}
 */
function getErrorMessage(err) {
  const msg = err.message || String(err);

  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ECONNREFUSED")) {
    return "Não foi possível conectar ao servidor backend. Verifique se ele está rodando.";
  }
  if (msg.includes("403") || msg.includes("401")) {
    return "Acesso negado pelo servidor. Verifique suas credenciais.";
  }
  if (msg.includes("404")) {
    return "Endpoint não encontrado no servidor. Verifique a URL do backend.";
  }
  if (msg.includes("Permission denied") || msg.includes("NotAllowedError")) {
    return "Permissão para capturar a tela foi negada.";
  }
  if (msg.includes("Could not start video source") || msg.includes("NotReadableError")) {
    return "Não foi possível acessar a fonte de vídeo selecionada. Ela pode ter sido fechada.";
  }
  if (msg.includes("token")) {
    return "Erro ao obter o token de autenticação. Verifique o backend.";
  }
  if (msg.includes("WebSocket") || msg.includes("connection")) {
    return "Falha na conexão WebSocket com o servidor LiveKit.";
  }

  return `Erro: ${msg}`;
}

// Utils

/**
 * Animar shake em um elemento (feedback de validação)
 */
function shakeElement(el) {
  if (!el) return;
  el.style.animation = "none";
  el.offsetHeight; // Trigger reflow
  el.style.animation = "error-shake 0.5s ease";
  el.focus();
  setTimeout(() => {
    el.style.animation = "";
  }, 500);
}
