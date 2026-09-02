// config-store.js 依赖 electron 的 app.getPath；注入 require.cache 假模块后按真实磁盘往返测试
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_NAME = 'config.json';
const STORE_PATH = require.resolve('../config-store');

// 把 electron 解析成假模块：app.getPath('userData') → 指定目录
function mockElectron(userDataDir) {
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => userDataDir } },
  };
}

// 每个用例独立 require 一份全新的模块实例（模块级单例状态不互相污染）
function freshStore() {
  delete require.cache[STORE_PATH];
  return require('../config-store');
}

function newTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'keystatusbar-test-'));
}

test('首次运行：创建默认配置文件', () => {
  const dir = newTmpDir();
  mockElectron(dir);
  const store = freshStore();
  store.createConfigStore();
  assert.ok(fs.existsSync(path.join(dir, CONFIG_NAME)));
  assert.deepEqual(store.getConfig(), store.DEFAULT_CONFIG);
});

test('getConfig 返回副本，外部修改不影响内部状态', () => {
  const dir = newTmpDir();
  mockElectron(dir);
  const store = freshStore();
  store.createConfigStore();
  const copy = store.getConfig();
  copy.fontSize = 999;
  assert.equal(store.getConfig().fontSize, store.DEFAULT_CONFIG.fontSize);
});

test('setConfig 立即生效并广播 change 事件', () => {
  const dir = newTmpDir();
  mockElectron(dir);
  const store = freshStore();
  store.createConfigStore();

  let emitted = null;
  store.onConfigChange((cfg) => { emitted = cfg; });
  store.setConfig('fontSize', 32);

  assert.equal(store.getConfig().fontSize, 32);
  assert.equal(emitted.fontSize, 32);
  store.flushSave();
});

test('未知 config key 被拒绝：不修改、不广播', () => {
  const dir = newTmpDir();
  mockElectron(dir);
  const store = freshStore();
  store.createConfigStore();

  let emitCount = 0;
  store.onConfigChange(() => { emitCount++; });
  store.setConfig('notAKey', 42);

  assert.equal(store.getConfig().notAKey, undefined);
  assert.equal(emitCount, 0);
});

test('flushSave 落盘后可完整读回（含对象值）', () => {
  const dir = newTmpDir();
  mockElectron(dir);
  const store = freshStore();
  store.createConfigStore();
  store.setConfig('fontSize', 40);
  store.setConfig('windowPosition', { x: 123, y: 456 });
  store.setConfig('statusBarVisible', false);
  store.flushSave();

  // 全新实例重新加载同一目录
  const store2 = freshStore();
  store2.createConfigStore();
  assert.equal(store2.getConfig().fontSize, 40);
  assert.deepEqual(store2.getConfig().windowPosition, { x: 123, y: 456 });
  assert.equal(store2.getConfig().statusBarVisible, false);
});

test('部分保存文件与默认值合并（旧版本配置升级场景）', () => {
  const dir = newTmpDir();
  mockElectron(dir);
  fs.writeFileSync(path.join(dir, CONFIG_NAME), JSON.stringify({ fontSize: 18 }));

  const store = freshStore();
  store.createConfigStore();
  const cfg = store.getConfig();
  assert.equal(cfg.fontSize, 18);
  // 缺失字段回落默认值
  assert.equal(cfg.padding, store.DEFAULT_CONFIG.padding);
  assert.equal(cfg.statusBarVisible, store.DEFAULT_CONFIG.statusBarVisible);
});

test('损坏的配置文件回落为默认值并重写文件', () => {
  const dir = newTmpDir();
  mockElectron(dir);
  const file = path.join(dir, CONFIG_NAME);
  fs.writeFileSync(file, '{corrupt json!!!');

  const store = freshStore();
  store.createConfigStore();
  assert.deepEqual(store.getConfig(), store.DEFAULT_CONFIG);
  // 回落路径会立即写回合法默认文件
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), store.DEFAULT_CONFIG);
});
