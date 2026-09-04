const COLOR_FIELDS = {
  fontColor: {
    picker: 'fontColorPicker',
    r: 'fontColorR',
    g: 'fontColorG',
    b: 'fontColorB',
    swatch: 'fontColor-swatch'
  },
  blockBgColor: {
    picker: 'blockBgColorPicker',
    r: 'blockBgColorR',
    g: 'blockBgColorG',
    b: 'blockBgColorB',
    swatch: 'blockBgColor-swatch'
  },
  statusBarBgColor: {
    picker: 'statusBarBgColorPicker',
    r: 'statusBarBgColorR',
    g: 'statusBarBgColorG',
    b: 'statusBarBgColorB',
    swatch: 'statusBarBgColor-swatch'
  },
  borderColor: {
    picker: 'borderColorPicker',
    r: 'borderColorR',
    g: 'borderColorG',
    b: 'borderColorB',
    swatch: 'borderColor-swatch'
  }
};

let currentConfig = null;

function byId(id) {
  return document.getElementById(id);
}

function clampByte(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(255, Math.round(number)));
}

function componentToHex(value) {
  return clampByte(value).toString(16).padStart(2, '0');
}

function rgbToHex(color) {
  return '#' + componentToHex(color.r) + componentToHex(color.g) + componentToHex(color.b);
}

function hexToRgb(hex) {
  const value = String(hex).replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function rgbCss(color) {
  return 'rgb(' + clampByte(color.r) + ', ' + clampByte(color.g) + ', ' + clampByte(color.b) + ')';
}

function readColor(key) {
  const fields = COLOR_FIELDS[key];
  return {
    r: clampByte(byId(fields.r).value),
    g: clampByte(byId(fields.g).value),
    b: clampByte(byId(fields.b).value)
  };
}

function writeColor(key, color) {
  const fields = COLOR_FIELDS[key];
  const clean = {
    r: clampByte(color.r),
    g: clampByte(color.g),
    b: clampByte(color.b)
  };

  byId(fields.r).value = clean.r;
  byId(fields.g).value = clean.g;
  byId(fields.b).value = clean.b;
  byId(fields.picker).value = rgbToHex(clean);
  byId(fields.swatch).style.backgroundColor = rgbCss(clean);
}

function updateValueDisplay(id, value, suffix) {
  const el = byId(id + '-val');
  if (el) el.textContent = value + suffix;
}

async function applyChange(key, value) {
  if (currentConfig) currentConfig[key] = value;
  await window.electronAPI.setConfig(key, value);
}

const debounceTimers = {};
function debounce(key, value, delay) {
  if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
  debounceTimers[key] = setTimeout(() => applyChange(key, value), delay);
}

function populateForm(config) {
  currentConfig = { ...config };

  byId('fontSize').value = config.fontSize;
  updateValueDisplay('fontSize', config.fontSize, 'pt');

  byId('blockSpacing').value = config.blockSpacing;
  byId('padding').value = config.padding;
  byId('borderWidth').value = config.borderWidth;
  byId('width').value = config.width;

  const alphaPercent = Math.round(config.statusBarBgAlpha * 100);
  byId('statusBarBgAlpha').value = alphaPercent;
  updateValueDisplay('statusBarBgAlpha', alphaPercent, '%');

  const multiplierPercent = Math.round(config.autoCorrectMultiplier * 100);
  byId('autoCorrectMultiplier').value = multiplierPercent;
  updateValueDisplay('autoCorrectMultiplier', multiplierPercent, '%');

  byId('releaseFlashDuration').value = config.releaseFlashDuration;
  updateValueDisplay('releaseFlashDuration', config.releaseFlashDuration, '秒');

  Object.keys(COLOR_FIELDS).forEach((key) => writeColor(key, config[key]));
}

function attachNumberListeners() {
  byId('fontSize').addEventListener('input', () => {
    const value = clampByte(byId('fontSize').value);
    updateValueDisplay('fontSize', value, 'pt');
    debounce('fontSize', value, 120);
  });

  byId('statusBarBgAlpha').addEventListener('input', () => {
    const value = Math.max(0, Math.min(100, Number(byId('statusBarBgAlpha').value)));
    updateValueDisplay('statusBarBgAlpha', value, '%');
    debounce('statusBarBgAlpha', value / 100, 120);
  });

  byId('autoCorrectMultiplier').addEventListener('input', () => {
    const value = Math.max(10, Math.min(100, Number(byId('autoCorrectMultiplier').value)));
    updateValueDisplay('autoCorrectMultiplier', value, '%');
    debounce('autoCorrectMultiplier', value / 100, 120);
  });

  byId('releaseFlashDuration').addEventListener('input', () => {
    const value = Math.max(1, Math.min(5, Math.round(Number(byId('releaseFlashDuration').value))));
    updateValueDisplay('releaseFlashDuration', value, '秒');
    debounce('releaseFlashDuration', value, 120);
  });

  ['blockSpacing', 'padding', 'borderWidth'].forEach((key) => {
    byId(key).addEventListener('change', () => {
      const value = Math.max(0, Math.round(Number(byId(key).value) || 0));
      byId(key).value = value;
      applyChange(key, value);
    });
  });

  byId('width').addEventListener('change', () => {
    const value = Math.max(50, Math.min(2000, Math.round(Number(byId('width').value) || 50)));
    byId('width').value = value;
    applyChange('width', value);
  });
}

function attachColorListeners() {
  Object.keys(COLOR_FIELDS).forEach((key) => {
    const fields = COLOR_FIELDS[key];
    const picker = byId(fields.picker);
    const rgbInputs = [byId(fields.r), byId(fields.g), byId(fields.b)];

    picker.addEventListener('input', () => {
      const color = hexToRgb(picker.value);
      writeColor(key, color);
      debounce(key, color, 80);
    });

    rgbInputs.forEach((input) => {
      input.addEventListener('input', () => {
        const color = readColor(key);
        writeColor(key, color);
        debounce(key, color, 120);
      });

      input.addEventListener('change', () => {
        const color = readColor(key);
        writeColor(key, color);
        applyChange(key, color);
      });
    });
  });
}

async function init() {
  const config = await window.electronAPI.getConfig();
  populateForm(config);
  attachNumberListeners();
  attachColorListeners();
}

init();
