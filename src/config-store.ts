// config-store.ts
//
// 应用配置的唯一持久化层：JSON 文件存于 Electron userData 目录。
// DEFAULT_CONFIG 是配置 schema 的运行时来源——新增字段必须同时改
// types.d.ts 的 Config 接口（编译期契约），二者漂移不会被任何工具发现。
//
// 写盘是 3 秒 debounce：高频拖动滑动条不刷盘。代价是进程退出前必须
// 调 flushSave()（main.ts 的 will-quit 已接），否则用户最后 3 秒的改动丢失。
// setConfig 对未知 key 静默拒绝（仅 console.error）——调用方拿到的是
// 无声失败，排查"配置不生效"先怀疑 key 拼写。
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
