// auto-correct.js 纯逻辑测试：带时间轴的假时钟驱动，
// 验证一次性计时、续期门闩、续期同步语义、启停
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutoCorrect, MODIFIER_VKS } = require('../build/auto-correct');

// 带虚拟时间的假计时器：计时器记录到期时刻，advance + fireDue 驱动
function fakeClock() {
  const timers = new Map();
  let nextId = 1;
  let now = 0;
  return {
    advance(ms) { now += ms; },
    setTimeout(cb, delay) {
      const id = nextId++;
      timers.set(id, { cb, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    fireDue() { // 触发所有已到期的计时器
      const due = [...timers.entries()].filter(([, t]) => t.at <= now);
      for (const [id] of due) timers.delete(id);
      for (const [, t] of due) t.cb();
    },
    pending: () => timers.size,
  };
}

const DELAY = 500;

function setup({ delay = DELAY, enabled = true } = {}) {
  const clock = fakeClock();
  const released = [];
  const corrector = createAutoCorrect({
    getDelay: () => delay,
    onForceRelease: (vk) => released.push(vk),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    enabled,
  });
  return { clock, released, corrector };
}

const VK_C = 0x43, VK_CTRL = 0x11, VK_SHIFT = 0x10, VK_CAPS = 0x14;

test('全新按下启动计时，超时后强制释放', () => {
  const { clock, released, corrector } = setup();
  corrector.keyDown(VK_C);
  clock.advance(DELAY);
  clock.fireDue();
  assert.deepEqual(released, [VK_C]);
});

test('一次性计时：重复按下不刷新（释放丢失型卡键终会被释放）', () => {
  const { clock, released, corrector } = setup();
  corrector.keyDown(VK_C);
  // 模拟 win32k 对卡住键持续合成的重复 down
  for (let i = 0; i < 5; i++) corrector.keyDown(VK_C);
  clock.advance(DELAY);
  clock.fireDue();
  assert.deepEqual(released, [VK_C], '重复 down 不应延长计时');
});

test('释放信号到达取消计时', () => {
  const { clock, released, corrector } = setup();
  corrector.keyDown(VK_C);
  corrector.keyUp(VK_C);
  clock.advance(DELAY * 2);
  clock.fireDue();
  assert.deepEqual(released, []);
  assert.equal(clock.pending(), 0);
});

test('修饰键连击续期：新修饰键把原到期时刻推迟（同步所有修饰键计时）', () => {
  const { clock, released, corrector } = setup();
  corrector.keyDown(VK_CTRL);           // t=0，Ctrl 原到期 500
  clock.advance(300);                   // t=300
  corrector.keyDown(VK_SHIFT);          // 全新按下 Shift → Ctrl/Shift 都改为 300+500=800 到期
  clock.advance(200);                   // t=500：Ctrl 的原到期时刻
  clock.fireDue();
  assert.deepEqual(released, [], '续期应把 Ctrl 的原到期推迟，此刻不释放');
  clock.advance(300);                   // t=800：同步后的新到期时刻
  clock.fireDue();
  assert.deepEqual(released.sort((a, b) => a - b), [VK_CTRL, VK_SHIFT].sort((a, b) => a - b));
});

test('续期门闩：自动重复的修饰键按下不触发续期（防止无限续命）', () => {
  const { clock, released, corrector } = setup();
  corrector.keyDown(VK_CTRL);
  // Ctrl 卡住：计时已在跑，后续重复 down 不断到达
  for (let i = 0; i < 5; i++) corrector.keyDown(VK_CTRL);
  clock.advance(DELAY);
  clock.fireDue();
  assert.deepEqual(released, [VK_CTRL], '重复 down 不得自我续命');
});

test('续期不影响触发键：卡住的触发键按原计时到期', () => {
  const { clock, released, corrector } = setup();
  corrector.keyDown(VK_C);              // C 卡住，到期 500
  clock.advance(100);
  corrector.keyDown(VK_SHIFT);          // 全新按下修饰键：续期只作用于修饰键
  corrector.keyDown(VK_CTRL);
  clock.advance(400);                   // t=500
  clock.fireDue();
  assert.deepEqual(released, [VK_C], '触发键必须按自己的计时到期');
});

test('计时到期后同键再按下可重新计时', () => {
  const { clock, released, corrector } = setup();
  corrector.keyDown(VK_C);
  clock.advance(DELAY);
  clock.fireDue();
  corrector.keyDown(VK_C);              // 强制释放后用户补按
  clock.advance(DELAY);
  clock.fireDue();
  assert.equal(released.length, 2);
});

test('关闭后不计时；运行中关闭立即清空全部计时', () => {
  const { clock, released, corrector } = setup();
  corrector.setEnabled(false);
  corrector.keyDown(VK_C);
  clock.advance(DELAY);
  clock.fireDue();
  assert.deepEqual(released, []);

  corrector.setEnabled(true);
  corrector.keyDown(VK_C);
  corrector.setEnabled(false);          // 运行中关闭
  clock.advance(DELAY);
  clock.fireDue();
  assert.deepEqual(released, []);
  assert.equal(clock.pending(), 0);
});

test('修饰键判定覆盖左右变体与 Win，不含切换键', () => {
  for (const vk of [0x10, 0xA0, 0xA1, 0x11, 0xA2, 0xA3, 0x12, 0xA4, 0xA5, 0x5B, 0x5C]) {
    assert.ok(MODIFIER_VKS.has(vk), 'vk 0x' + vk.toString(16) + ' 应为修饰键');
  }
  assert.ok(!MODIFIER_VKS.has(VK_CAPS), 'CapsLock 不是修饰键');
  assert.ok(!MODIFIER_VKS.has(VK_C));
});

test('getDelay 每次启动计时时读取（乘数/系统速度变更即时生效）', () => {
  const clock = fakeClock();
  const delays = [];
  let delay = 500;
  const corrector = createAutoCorrect({
    getDelay: () => { delays.push(delay); return delay; },
    onForceRelease: () => {},
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  corrector.keyDown(VK_C);
  corrector.keyUp(VK_C);
  delay = 250;
  corrector.keyDown(VK_C);
  assert.deepEqual(delays, [500, 250]);
});
