const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const { createConfigStore, getConfig, setConfig, onConfigChange, flushSave } = require('./config-store');
const { createKeyboardHook } = require('./keyboard-hook');
const { getKeyDisplay } = require('./keymap');

// --- State ---
let statusBarWindow = null;
let configWindow = null;
let tray = null;
let keyboardHook = null;
let pressedKeys = new Map();   // vkCode -> { text, isModifier, order }
let keyOrderCounter = 0;

// --- Tray Icon Generation ---
function createTrayIconImage() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0); // BGRA, all transparent

  // Helper: set pixel (BGRA order on Windows)
  function setPx(x, y, r, g, b, a) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    buf[idx] = b; buf[idx + 1] = g; buf[idx + 2] = r; buf[idx + 3] = a;
  }

  // White = (255,255,255,255)
  const W = [255, 255, 255, 255];
  const T = [0, 0, 0, 0];   // transparent
  const B = [40, 40, 40, 255]; // dark gap

  // Keyboard body: rows 2-12, cols 2-13 (white fill)
  for (let y = 2; y <= 12; y++) {
    for (let x = 2; x <= 13; x++) {
      setPx(x, y, ...W);
    }
  }

  // Horizontal key gaps (3 rows of keys)
  const gapRows = [
    [4, 5],   // row 1
    [7, 8],   // row 2
    [10, 11], // row 3 (spacebar row)
  ];

  gapRows.forEach(([y1, y2]) => {
    for (let y = y1; y <= y2; y++) {
      for (let x = 3; x <= 12; x++) {
        // Create gaps between keys
        if (x === 4 || x === 6 || x === 8 || x === 10) {
          setPx(x, y, ...B);
        }
      }
    }
  });

  // Spacebar (row 10-11, cols 5-10): remove gaps in that area
  for (let y = 10; y <= 11; y++) {
    for (let x = 5; x <= 10; x++) {
      setPx(x, y, ...W);
    }
  }

  try {
    return nativeImage.createFromBitmap(buf, { width: size, height: size });
  } catch (e) {
    // Fallback: create a simple colored square
    console.error('createFromBitmap failed, using fallback icon:', e.message);
    const fallback = Buffer.alloc(size * size * 4, 0);
    for (let y = 4; y <= 11; y++) {
      for (let x = 4; x <= 11; x++) {
        const idx = (y * size + x) * 4;
        fallback[idx] = 255; fallback[idx + 1] = 255; fallback[idx + 2] = 255; fallback[idx + 3] = 255;
      }
    }
    return nativeImage.createFromBitmap(fallback, { width: size, height: size });
  }
}

// --- Window Management ---
function createStatusBarWindow() {
  const config = getConfig();

  // Restore saved position if it still fits inside the primary display; otherwise center
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const savedPos = config.windowPosition;
  const isOnScreen = savedPos
    && Number.isFinite(savedPos.x)
    && Number.isFinite(savedPos.y)
    && savedPos.x >= 0 && savedPos.x < screenWidth
    && savedPos.y >= 0 && savedPos.y < screenHeight;
  const initialX = isOnScreen
    ? Math.round(savedPos.x)
    : Math.floor((screenWidth - config.width) / 2);
  const initialY = isOnScreen ? Math.round(savedPos.y) : 50;

  statusBarWindow = new BrowserWindow({
    width: config.width,
    height: 60,
    x: initialX,
    y: initialY,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    type: 'tool',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  statusBarWindow.loadFile(path.join(__dirname, 'renderer', 'statusbar.html'));

  statusBarWindow.on('closed', () => {
    statusBarWindow = null;
  });

  // Persist position whenever the window is moved (debounced inside setConfig)
  statusBarWindow.on('move', () => {
    if (statusBarWindow && !statusBarWindow.isDestroyed()) {
      const [x, y] = statusBarWindow.getPosition();
      setConfig('windowPosition', { x: Math.round(x), y: Math.round(y) });
    }
  });
}

function createConfigWindow() {
  if (configWindow) {
    configWindow.show();
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 460,
    height: 560,
    title: 'KeyStatusBar 配置',
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  configWindow.loadFile(path.join(__dirname, 'renderer', 'config.html'));

  configWindow.on('closed', () => {
    configWindow = null;
  });
}

// --- System Tray ---
function createTray() {
  const icon = createTrayIconImage();
  tray = new Tray(icon);
  tray.setToolTip('KeyStatusBar');
  updateTrayMenu();
}

function updateTrayMenu() {
  const config = getConfig();
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示状态条',
      type: 'checkbox',
      checked: config.statusBarVisible,
      click: (menuItem) => {
        setConfig('statusBarVisible', menuItem.checked);
        if (menuItem.checked) {
          if (statusBarWindow) {
            statusBarWindow.show();
          } else {
            createStatusBarWindow();
          }
        } else {
          if (statusBarWindow) statusBarWindow.hide();
        }
      },
    },
    {
      label: '配置面板...',
      click: () => createConfigWindow(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

// --- IPC Handlers ---
ipcMain.handle('get-config', () => {
  return getConfig();
});

ipcMain.handle('set-config', (_event, key, value) => {
  setConfig(key, value);
  // Notify status bar window to refresh styles
  if (statusBarWindow && !statusBarWindow.isDestroyed()) {
    statusBarWindow.webContents.send('config-changed', getConfig());
  }
  updateTrayMenu();
  return true;
});

ipcMain.on('resize-window', (_event, { width, height }) => {
  if (statusBarWindow && !statusBarWindow.isDestroyed()) {
    statusBarWindow.setSize(Math.ceil(width), Math.ceil(height));
  }
});

// --- Key State Management ---
function getSortedKeys() {
  const keys = Array.from(pressedKeys.values());
  const modifiers = keys.filter(k => k.isModifier).sort((a, b) => a.order - b.order);
  const chars = keys.filter(k => !k.isModifier).sort((a, b) => a.order - b.order);
  return [...modifiers, ...chars];
}

function onKeyEvent(event) {
  const { vkCode, isKeyDown, charCode } = event;
  const display = getKeyDisplay(vkCode, charCode);

  if (isKeyDown) {
    if (!pressedKeys.has(vkCode)) {
      pressedKeys.set(vkCode, {
        text: display.text,
        isModifier: display.isModifier,
        order: keyOrderCounter++,
      });
    }
  } else {
    pressedKeys.delete(vkCode);
  }

  // Push updated key list to status bar
  if (statusBarWindow && !statusBarWindow.isDestroyed()) {
    statusBarWindow.webContents.send('keys-update', getSortedKeys());
  }
}

// --- App Lifecycle ---
app.whenReady().then(() => {
  // Initialize config store
  createConfigStore();

  // Create system tray
  createTray();

  // Create status bar if visible
  const config = getConfig();
  if (config.statusBarVisible) {
    createStatusBarWindow();
  }

  // Start global keyboard hook
  keyboardHook = createKeyboardHook(onKeyEvent, {
    onCapsChange(capsOn) {
      if (statusBarWindow && !statusBarWindow.isDestroyed()) {
        statusBarWindow.webContents.send('caps-update', capsOn);
      }
    }
  });
  keyboardHook.start();

  // Listen for config changes
  onConfigChange((newConfig) => {
    if (statusBarWindow && !statusBarWindow.isDestroyed()) {
      statusBarWindow.webContents.send('config-changed', newConfig);
    }
    updateTrayMenu();
  });
});

// Prevent app from quitting when all windows are closed (tray app)
app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('will-quit', () => {
  if (keyboardHook) {
    keyboardHook.stop();
  }
  // Persist any debounced config changes before exit
  flushSave();
});

// Windows: prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus the existing status bar or config window
    if (configWindow) {
      configWindow.show();
      configWindow.focus();
    } else if (statusBarWindow) {
      statusBarWindow.show();
    }
  });
}
