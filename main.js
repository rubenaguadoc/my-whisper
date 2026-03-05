const {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  screen,
  globalShortcut,
  Menu,
  Tray,
  nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { spawn } = require('child_process');

// Flags seguros que no afectan al renderizado (las ventanas transparentes
// necesitan aceleración de hardware, no se puede deshabilitar)
app.commandLine.appendSwitch('no-first-run');
app.commandLine.appendSwitch('disable-default-apps');

// Eliminar la barra de menú nativa en todas las ventanas
Menu.setApplicationMenu(null);

// Ruta de configuración en el directorio de datos del usuario (no en el proyecto)
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

let overlayWin = null;
let resultWin = null;
let settingsWin = null;
let tray = null;
let isQuitting = false;
let autoPaste = false; // se carga de config en whenReady

// ── Icono del tray: PNG real construido con zlib + CRC32 ─────────────────
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(d.length);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, d])));
  return Buffer.concat([lenBuf, t, d, crcBuf]);
}

function makeTrayIcon() {
  const size = 32;
  const cx = size / 2,
    cy = size / 2,
    rad = size / 2 - 2;

  // Scanlines: byte de filtro (0) + pixeles RGBA por fila
  const raw = Buffer.alloc(size * (1 + size * 4), 0);
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filtro None
    for (let x = 0; x < size; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= rad) {
        const i = y * (1 + size * 4) + 1 + x * 4;
        raw[i] = 239; // R
        raw[i + 1] = 68; // G  → #ef4444
        raw[i + 2] = 68; // B
        raw[i + 3] = 255; // A
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8;
  ihdr[9] = 6; // 8-bit RGBA

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

function createTray() {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('MyWhisper — Ctrl+F1 para grabar');
  tray.on('click', () => toggleOverlayAndRecord());
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Grabar / Parar  (Ctrl+F1)',
      click: () => toggleOverlayAndRecord(),
    },
    { type: 'separator' },
    {
      label: 'Pegar automáticamente',
      type: 'checkbox',
      checked: autoPaste,
      click: (item) => {
        autoPaste = item.checked;
        const config = readConfig();
        config.autoPaste = autoPaste;
        writeConfig(config);
      },
    },
    { type: 'separator' },
    { label: 'Configuración', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function toggleOverlayAndRecord() {
  if (!overlayWin) {
    // Primera vez: crear overlay; se autoinicia la grabación en ready-to-show
    createOverlay();
  } else if (!overlayWin.isVisible()) {
    // Existe pero oculto: mostrar y arrancar
    overlayWin.show();
    overlayWin.webContents.send('trigger-recording');
  } else {
    // Visible y grabando: parar (transcribir y ocultar)
    overlayWin.webContents.send('trigger-recording');
  }
}

function createOverlay() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const W = 280,
    H = 44;

  overlayWin = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round((width - W) / 2),
    y: 16,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Ocultar en lugar de destruir (preservar estado y evitar recargas)
  overlayWin.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      overlayWin.hide();
    }
  });

  // Registrar Escape solo mientras el overlay está visible (grabando)
  overlayWin.on('show', () => {
    globalShortcut.register('Escape', () => {
      overlayWin.webContents.send('trigger-escape');
    });
  });
  overlayWin.on('hide', () => {
    globalShortcut.unregister('Escape');
  });

  // Primera carga: mostrar y arrancar grabación automáticamente
  overlayWin.once('ready-to-show', () => {
    overlayWin.show();
    setTimeout(() => overlayWin.webContents.send('trigger-recording'), 300);
  });

  overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
}

function createResultWindow(text) {
  if (resultWin) {
    resultWin.close();
    resultWin = null;
  }

  resultWin = new BrowserWindow({
    width: 540,
    height: 400,
    title: 'Transcripción',
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  resultWin.loadFile(path.join(__dirname, 'renderer', 'result.html'));
  resultWin.webContents.on('did-finish-load', () => {
    resultWin.webContents.send('transcription-text', text);
  });
  resultWin.on('closed', () => {
    resultWin = null;
  });
}

function createSettingsWindow() {
  if (settingsWin) {
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 440,
    height: 290,
    title: 'Configuración — MyWhisper',
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

app.whenReady().then(() => {
  createTray();

  // Cargar preferencias
  const config = readConfig();
  autoPaste = !!config.autoPaste;
  if (!config.apiKey) setTimeout(createSettingsWindow, 400);

  // Ctrl+F1 → mostrar overlay y toggle grabación
  globalShortcut.register('Ctrl+F1', toggleOverlayAndRecord);
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// La app vive en el tray: no salir cuando se cierran las ventanas
app.on('window-all-closed', () => {
  /* no-op */
});

// ── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-api-key', () => {
  return readConfig().apiKey || '';
});

ipcMain.handle('save-api-key', (_, apiKey) => {
  const trimmed = String(apiKey).trim();
  const config = readConfig();
  config.apiKey = trimmed;
  writeConfig(config);
  return true;
});

ipcMain.handle('transcribe', async (_, audioBuffer) => {
  const config = readConfig();
  if (!config.apiKey) {
    throw new Error(
      'API key no configurada. Clic derecho en el icono del tray → Configuración.',
    );
  }

  // Convertir el Uint8Array recibido por IPC a Blob para el FormData nativo
  const buffer = Buffer.from(audioBuffer);
  const blob = new Blob([buffer], { type: 'audio/webm' });

  const formData = new FormData();
  formData.append('file', blob, 'audio.webm');
  formData.append('model', 'gpt-4o-transcribe');
  formData.append('language', 'es');

  const response = await fetch(
    'https://api.openai.com/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: {
        // No añadir Content-Type manualmente — fetch lo pone con el boundary
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Error de OpenAI (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data.text || '';
});

ipcMain.on('show-result', (_, text) => {
  if (autoPaste) {
    // 1) Copiar al portapapeles
    clipboard.writeText(String(text));
    // 2) Ocultar overlay para que la ventana anterior recupere el foco
    if (overlayWin) overlayWin.hide();
    // 3) Esperar a que el SO transfiera el foco y simular Ctrl+V
    setTimeout(() => {
      spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")',
        ],
        { windowsHide: true },
      );
    }, 250);
  } else {
    if (overlayWin) overlayWin.hide();
    createResultWindow(text);
  }
});

ipcMain.on('hide-overlay', () => {
  if (overlayWin) overlayWin.hide();
});

ipcMain.on('open-settings', () => {
  createSettingsWindow();
});

ipcMain.on('copy-to-clipboard', (_, text) => {
  clipboard.writeText(String(text));
});

ipcMain.on('quit-app', () => {
  app.quit();
});
