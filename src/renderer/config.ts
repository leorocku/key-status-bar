// 配置面板 renderer（经典脚本，无模块系统）：经 preload 的 window.electronAPI 与主进程通信。
// 类型契约见 src/types.d.ts（Config / RGBColor / ElectronAPI）。
// IIFE 包裹：经典脚本共享全局作用域，避免与 statusbar.js 的同名声明冲突。
(() => {
  type ColorFieldKey = 'fontColor' | 'blockBgColor' | 'statusBarBgColor' | 'borderColor';

  interface ColorFieldRefs {
    picker: string;
    r: string;
    g: string;
    b: string;
    swatch: string;
  }

  const COLOR_FIELDS: Record<ColorFieldKey, ColorFieldRefs> = {
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

  let currentConfig: Config | null = null;

  function byId(id: string): HTMLElement {
    return document.getElementById(id)!;
  }

  function inputById(id: string): HTMLInputElement {
    return document.getElementById(id) as HTMLInputElement;
  }

  function clampByte(value: number | string): number {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(255, Math.round(number)));
  }

  function componentToHex(value: number): string {
    return clampByte(value).toString(16).padStart(2, '0');
  }

  function rgbToHex(color: RGBColor): string {
    return '#' + componentToHex(color.r) + componentToHex(color.g) + componentToHex(color.b);
  }

  function hexToRgb(hex: string): RGBColor {
    const value = String(hex).replace('#', '');
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16)
    };
  }

  function rgbCss(color: RGBColor): string {
    return 'rgb(' + clampByte(color.r) + ', ' + clampByte(color.g) + ', ' + clampByte(color.b) + ')';
  }

  function readColor(key: ColorFieldKey): RGBColor {
    const fields = COLOR_FIELDS[key];
    return {
      r: clampByte(inputById(fields.r).value),
      g: clampByte(inputById(fields.g).value),
      b: clampByte(inputById(fields.b).value)
    };
  }

  function writeColor(key: ColorFieldKey, color: RGBColor): void {
    const fields = COLOR_FIELDS[key];
    const clean: RGBColor = {
      r: clampByte(color.r),
      g: clampByte(color.g),
      b: clampByte(color.b)
    };

    inputById(fields.r).value = String(clean.r);
    inputById(fields.g).value = String(clean.g);
    inputById(fields.b).value = String(clean.b);
    inputById(fields.picker).value = rgbToHex(clean);
    byId(fields.swatch).style.backgroundColor = rgbCss(clean);
  }

  function updateValueDisplay(id: string, value: number, suffix: string): void {
    const el = byId(id + '-val');
    if (el) el.textContent = value + suffix;
  }

  async function applyChange(key: ConfigKey, value: ConfigValue): Promise<void> {
    if (currentConfig) Object.assign(currentConfig, { [key]: value });
    await window.electronAPI.setConfig(key, value);
  }

  const debounceTimers: Record<string, number> = {};
  function debounce(key: ConfigKey, value: ConfigValue, delay: number): void {
    clearTimeout(debounceTimers[key]);
    debounceTimers[key] = window.setTimeout(() => applyChange(key, value), delay);
  }

  function populateForm(config: Config): void {
    currentConfig = { ...config };

    inputById('fontSize').value = String(config.fontSize);
    updateValueDisplay('fontSize', config.fontSize, 'pt');

    inputById('blockSpacing').value = String(config.blockSpacing);
    inputById('padding').value = String(config.padding);
    inputById('borderWidth').value = String(config.borderWidth);
    inputById('width').value = String(config.width);

    const alphaPercent = Math.round(config.statusBarBgAlpha * 100);
    inputById('statusBarBgAlpha').value = String(alphaPercent);
    updateValueDisplay('statusBarBgAlpha', alphaPercent, '%');

    (Object.keys(COLOR_FIELDS) as ColorFieldKey[]).forEach((key) => writeColor(key, config[key]));
  }

  function attachNumberListeners(): void {
    inputById('fontSize').addEventListener('input', () => {
      const value = clampByte(inputById('fontSize').value);
      updateValueDisplay('fontSize', value, 'pt');
      debounce('fontSize', value, 120);
    });

    inputById('statusBarBgAlpha').addEventListener('input', () => {
      const value = Math.max(0, Math.min(100, Number(inputById('statusBarBgAlpha').value)));
      updateValueDisplay('statusBarBgAlpha', value, '%');
      debounce('statusBarBgAlpha', value / 100, 120);
    });

    (['blockSpacing', 'padding', 'borderWidth'] as ConfigKey[]).forEach((key) => {
      inputById(key).addEventListener('change', () => {
        const value = Math.max(0, Math.round(Number(inputById(key).value) || 0));
        inputById(key).value = String(value);
        applyChange(key, value);
      });
    });

    inputById('width').addEventListener('change', () => {
      const value = Math.max(50, Math.min(2000, Math.round(Number(inputById('width').value) || 50)));
      inputById('width').value = String(value);
      applyChange('width', value);
    });
  }

  function attachColorListeners(): void {
    (Object.keys(COLOR_FIELDS) as ColorFieldKey[]).forEach((key) => {
      const fields = COLOR_FIELDS[key];
      const picker = inputById(fields.picker);
      const rgbInputs = [inputById(fields.r), inputById(fields.g), inputById(fields.b)];

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

  async function init(): Promise<void> {
    const config = await window.electronAPI.getConfig();
    populateForm(config);
    attachNumberListeners();
    attachColorListeners();
  }

  init();
})();
