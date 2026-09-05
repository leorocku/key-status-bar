import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import EventEmitter from 'events';

export const DEFAULT_CONFIG: Config = {
  fontSize: 24,
  fontColor: { r: 255, g: 255, b: 255 },
  blockSpacing: 4,
  blockBgColor: { r: 60, g: 60, b: 60 },
  statusBarBgColor: { r: 30, g: 30, b: 30 },
  statusBarBgAlpha: 0.8,
  padding: 8,
  borderColor: { r: 100, g: 100, b: 100 },
  borderWidth: 1,
  width: 400,
  statusBarVisible: true,
  windowPosition: null,
  autoCorrectEnabled: true,
  autoCorrectMultiplier: 0.5,
  releaseFlashDuration: 2
};

let config: Config = { ...DEFAULT_CONFIG };
let configPath = '';
const emitter = new EventEmitter();
const SAVE_DEBOUNCE_MS = 3000;
let saveTimer: NodeJS.Timeout | undefined;

export function createConfigStore(): void {
  configPath = path.join(app.getPath('userData'), 'config.json');
  try {
    const data = fs.readFileSync(configPath, 'utf-8');
    const saved = JSON.parse(data);
    config = { ...DEFAULT_CONFIG, ...saved };
  } catch (e) {
    // First run or corrupt file — persist defaults
    saveConfig();
  }
}

function saveConfig(): void {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save config:', String(e));
  }
}

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveConfig();
    saveTimer = undefined;
  }, SAVE_DEBOUNCE_MS);
}

export function flushSave(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  // createConfigStore() 尚未执行（如第二实例提前退出）时 configPath 为空，跳过
  if (configPath) saveConfig();
}

export function getConfig(): Config {
  return { ...config };
}

export function setConfig<K extends ConfigKey>(key: K, value: Config[K]): void {
  if (!(key in DEFAULT_CONFIG)) {
    console.error('Unknown config key:', key);
    return;
  }
  config[key] = value;
  scheduleSave();
  emitter.emit('change', getConfig());
}

export function onConfigChange(callback: (config: Config) => void): void {
  emitter.on('change', callback);
}
