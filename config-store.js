const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const EventEmitter = require('events');

const DEFAULT_CONFIG = {
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
  windowPosition: null
};

let config = { ...DEFAULT_CONFIG };
let configPath = '';
const emitter = new EventEmitter();
const SAVE_DEBOUNCE_MS = 3000;
let saveTimer = null;

function createConfigStore() {
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

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save config:', e.message);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveConfig();
    saveTimer = null;
  }, SAVE_DEBOUNCE_MS);
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveConfig();
}

function getConfig() {
  return { ...config };
}

function setConfig(key, value) {
  if (!(key in DEFAULT_CONFIG)) {
    console.error('Unknown config key:', key);
    return;
  }
  config[key] = value;
  scheduleSave();
  emitter.emit('change', getConfig());
}

function onConfigChange(callback) {
  emitter.on('change', callback);
}

module.exports = { createConfigStore, getConfig, setConfig, onConfigChange, flushSave, DEFAULT_CONFIG };
