import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } from 'electron';
import path from 'path';
import { createConfigStore, getConfig, setConfig, onConfigChange, flushSave } from './config-store';
import { createKeyboardHook, injectKeyUp, isKeyHeld, getRepeatDelay } from './keyboard-hook';
import type { KeyboardHook } from './keyboard-hook';
import { createAutoCorrect } from './auto-correct';
import type { AutoCorrect } from './auto-correct';
import { getKeyDisplay } from './keymap';

// --- State ---
let statusBarWindow: BrowserWindow | null = null;
let configWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let keyboardHook: KeyboardHook | null = null;
let pressedKeys = new Map<number, PressedKey>();   // vkCode -> { text, isModifier, order }
let keyOrderCounter = 0;
let autoCorrect: AutoCorrect | null = null;
let repeatDelayMs = 1000; // 重复延迟，启动时读一次；读不到用默认值

// --- Tray Icon Generation ---
function createTrayIconImage(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0); // BGRA, all transparent

  // Helper: set pixel (BGRA order on Windows)
  function setPx(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    buf[idx] = b; buf[idx + 1] = g; buf[idx + 2] = r; buf[idx + 3] = a;
  }

  // White = (255,255,255,255)
  const W: [number, number, number, number] = [255, 255, 255, 255];
  const B: [number, number, number, number] = [40, 40, 40, 255]; // dark gap

  // Keyboard body: rows 2-12, cols 2-13 (white fill)
  for (let y = 2; y <= 12; y++) {
    for (let x = 2; x <= 13; x++) {
      setPx(x, y, ...W);
    }
  }

  // Horizontal key gaps (3 rows of keys)
  const gapRows: [number, number][] = [
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
function createStatusBarWindow(): void {
  const config = getConfig();

  // Restore saved position if it still fits inside the primary display; otherwise center
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const savedPos = config.windowPosition;
  let initialX: number;
  let initialY: number;
  if (
    savedPos
    && Number.isFinite(savedPos.x)
    && Number.isFinite(savedPos.y)
    && savedPos.x >= 0 && savedPos.x < screenWidth
    && savedPos.y >= 0 && savedPos.y < screenHeight
  ) {
    initialX = Math.round(savedPos.x);
    initialY = Math.round(savedPos.y);
  } else {
    initialX = Math.floor((screenWidth - config.width) / 2);
    initialY = 50;
  }

  statusBarWindow = new BrowserWindow({
    width: config.width,
    height: 60,
    x: initialX,
    y: initialY,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // frame:false already prevents edge-drag resizing; leaving resizable on
    // keeps setBounds able to shrink the window when content shrinks.
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

function createConfigWindow(): void {
  if (configWindow) {
    configWindow.show();
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 460,
    height: 660,
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
function createTray(): void {
  const icon = createTrayIconImage();
  tray = new Tray(icon);
  tray.setToolTip('KeyStatusBar');
  updateTrayMenu();
}

function updateTrayMenu(): void {
  if (!tray) return;
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
    {
      label: '自动纠错',
      type: 'checkbox',
      checked: config.autoCorrectEnabled,
      click: (menuItem) => {
        setConfig('autoCorrectEnabled', menuItem.checked);
      },
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

ipcMain.handle('set-config', (_event, key: ConfigKey, value: ConfigValue) => {
  setConfig(key, value);
  // Notify status bar window to refresh styles
  if (statusBarWindow && !statusBarWindow.isDestroyed()) {
    statusBarWindow.webContents.send('config-changed', getConfig());
  }
  updateTrayMenu();
  return true;
});

ipcMain.on('resize-window', (_event, { width, height }: { width: number; height: number }) => {
  if (statusBarWindow && !statusBarWindow.isDestroyed()) {
    // setBounds (keeping the top-left corner) shrinks reliably on transparent
    // frameless windows; setSize can leave the old larger hit area behind.
    const [x, y] = statusBarWindow.getPosition();
    statusBarWindow.setBounds({
      x,
      y,
      width: Math.max(1, Math.ceil(width)),
      height: Math.max(1, Math.ceil(height)),
    });
  }
});

// --- Key State Management ---
function getSortedKeys(): PressedKey[] {
  const keys = Array.from(pressedKeys.values());
  const modifiers = keys.filter(k => k.isModifier).sort((a, b) => a.order - b.order);
  const chars = keys.filter(k => !k.isModifier).sort((a, b) => a.order - b.order);
  return [...modifiers, ...chars];
}

function forceReleaseKey(vkCode: number): void {
  if (!injectKeyUp(vkCode)) return;
  // 通知状态条做释放闪烁；注入的 key-up 稍后经钩子回流清除按键块
  if (statusBarWindow && !statusBarWindow.isDestroyed()) {
    const entry = pressedKeys.get(vkCode);
    statusBarWindow.webContents.send('force-release', {
      vkCode,
      text: entry ? entry.text : getKeyDisplay(vkCode, 0).text,
    });
  }
}

function onKeyEvent(event: KeyEventInfo): void {
  const { vkCode, isKeyDown, charCode, isInjected } = event;
  const display = getKeyDisplay(vkCode, charCode);

  if (isKeyDown) {
    if (!pressedKeys.has(vkCode)) {
      pressedKeys.set(vkCode, {
        text: display.text,
        isModifier: display.isModifier,
        order: keyOrderCounter++,
      });
    }
    // 注入事件只同步显示，不参与计时（ADR-0001）；
    // autoCorrect 守卫恒真（钩子在初始化后才启动），仅为类型收窄
    if (!isInjected && autoCorrect) autoCorrect.keyDown(vkCode);
  } else {
    pressedKeys.delete(vkCode);
    if (autoCorrect) autoCorrect.keyUp(vkCode);
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

  // 启动清理（Q4-B）：先于建窗与装钩——释放确实被按住的键，存量卡键当场解除。
  // 此时钩子未装，注入的 up 不会回流进自己的事件处理。
  for (let vk = 0; vk < 256; vk++) {
    if (isKeyHeld(vk)) injectKeyUp(vk);
  }

  // Create status bar if visible
  const config = getConfig();
  if (config.statusBarVisible) {
    createStatusBarWindow();
  }

  // 自动纠错：重复延迟启动时读一次（Q6），乘数每次计时启动时读配置
  repeatDelayMs = getRepeatDelay() || 1000;
  autoCorrect = createAutoCorrect({
    getDelay: () => getConfig().autoCorrectMultiplier * repeatDelayMs,
    onForceRelease: forceReleaseKey,
    enabled: config.autoCorrectEnabled,
  });

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
    autoCorrect!.setEnabled(newConfig.autoCorrectEnabled);
  });
});

// Prevent app from quitting when all windows are closed (tray app)
// Electron 31 类型标该事件为无参，但运行时会传带 preventDefault 的 event 对象
app.on('window-all-closed', ((event: { preventDefault(): void }) => {
  event.preventDefault();
}) as () => void);

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
