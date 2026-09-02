const capsIndicator = document.getElementById('caps-indicator');
const keyBlocks = document.getElementById('key-blocks');
const container = document.getElementById('statusbar-container');

let currentKeys = [];

function clampByte(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(255, Math.round(number)));
}

function toRgb(color) {
  return 'rgb(' + clampByte(color.r) + ', ' + clampByte(color.g) + ', ' + clampByte(color.b) + ')';
}

function toRgba(color, alpha) {
  const a = Math.max(0, Math.min(1, Number(alpha)));
  return 'rgba(' + clampByte(color.r) + ', ' + clampByte(color.g) + ', ' + clampByte(color.b) + ', ' + a + ')';
}

function syncWindowSize() {
  const rect = container.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    window.electronAPI.resizeWindow(rect.width, rect.height);
  }
}

function applyConfig(config) {
  const root = document.documentElement;

  root.style.setProperty('--sb-width', config.width + 'px');
  root.style.setProperty('--sb-font-size', config.fontSize + 'pt');
  root.style.setProperty('--sb-font-color', toRgb(config.fontColor));
  root.style.setProperty('--sb-spacing', config.blockSpacing + 'px');
  root.style.setProperty('--sb-block-bg', toRgb(config.blockBgColor));
  root.style.setProperty('--sb-padding', config.padding + 'px');
  root.style.setProperty('--sb-border-color', toRgb(config.borderColor));
  root.style.setProperty('--sb-border-width', config.borderWidth + 'px');
  root.style.setProperty('--sb-bg', toRgba(config.statusBarBgColor, config.statusBarBgAlpha));
}

function renderKeys(keys) {
  currentKeys = keys;
  keyBlocks.innerHTML = '';

  keyBlocks.style.display = keys.length > 0 ? 'flex' : 'none';

  keys.forEach((key) => {
    const span = document.createElement('span');
    span.className = 'key-block';
    span.textContent = key.text;
    keyBlocks.appendChild(span);
  });
}

function updateCaps(capsOn) {
  capsIndicator.textContent = capsOn ? 'CAPS ON' : 'CAPS OFF';
  capsIndicator.classList.toggle('caps-on', capsOn);
  capsIndicator.classList.toggle('caps-off', !capsOn);
}

async function init() {
  const config = await window.electronAPI.getConfig();
  applyConfig(config);
  renderKeys(currentKeys);

  // Keep the window sized to the visible container. ResizeObserver fires after
  // layout settles, so measurements are always current, avoiding stale sizes
  // that the old requestAnimationFrame approach could hit when content shrank.
  const resizeObserver = new ResizeObserver(syncWindowSize);
  resizeObserver.observe(container);

  window.electronAPI.onKeysUpdate((keys) => {
    renderKeys(keys);
  });

  window.electronAPI.onCapsUpdate((capsOn) => {
    updateCaps(capsOn);
  });

  window.electronAPI.onConfigChange((newConfig) => {
    applyConfig(newConfig);
  });
}

init();
