// keymap.js 是纯函数模块：测试六级优先链与各层的 isModifier 契约
const test = require('node:test');
const assert = require('node:assert/strict');
const { getKeyDisplay } = require('../keymap');

// 第 1 层：控制键 → 英文名，isModifier: true（控制键优先于 charCode 兜底）
test('控制键显示英文名且为修饰键', () => {
  const cases = [
    [0x08, 'Backspace'], [0x09, 'Tab'], [0x0D, 'Enter'],
    [0x10, 'Shift'], [0x11, 'Ctrl'], [0x12, 'Alt'],
    [0x14, 'CapsLock'], [0x1B, 'Esc'], [0x20, 'Space'],
    [0x21, 'PgUp'], [0x22, 'PgDn'], [0x23, 'End'], [0x24, 'Home'],
    [0x25, 'Left'], [0x26, 'Up'], [0x27, 'Right'], [0x28, 'Down'],
    [0x2C, 'PrtSc'], [0x2D, 'Ins'], [0x2E, 'Del'],
    [0x5B, 'Win'], [0x5C, 'Win'], [0x5D, 'Menu'],
    [0x90, 'NumLk'], [0x91, 'ScrLk'],
  ];
  for (const [vk, text] of cases) {
    // 传入误导性 charCode，验证控制键优先于 charCode 兜底
    assert.deepEqual(getKeyDisplay(vk, 0x41), { text, isModifier: true });
  }
});

test('左右修饰键合并显示同一名字', () => {
  assert.equal(getKeyDisplay(0xA0, 0).text, 'Shift');
  assert.equal(getKeyDisplay(0xA1, 0).text, 'Shift');
  assert.equal(getKeyDisplay(0xA2, 0).text, 'Ctrl');
  assert.equal(getKeyDisplay(0xA3, 0).text, 'Ctrl');
  assert.equal(getKeyDisplay(0xA4, 0).text, 'Alt');
  assert.equal(getKeyDisplay(0xA5, 0).text, 'Alt');
});

test('F1-F24 全部映射', () => {
  for (let i = 0; i < 24; i++) {
    assert.deepEqual(getKeyDisplay(0x70 + i, 0), { text: 'F' + (i + 1), isModifier: true });
  }
});

// 第 2 层：小键盘运算符是可打印字符，非修饰键
test('小键盘运算符显示符号且非修饰键', () => {
  const cases = [[0x6A, '*'], [0x6B, '+'], [0x6C, ','], [0x6D, '-'], [0x6E, '.'], [0x6F, '/']];
  for (const [vk, text] of cases) {
    assert.deepEqual(getKeyDisplay(vk, 0), { text, isModifier: false });
  }
});

// 第 3 层：小键盘数字 0-9
test('小键盘数字映射为 0-9', () => {
  for (let i = 0; i <= 9; i++) {
    assert.deepEqual(getKeyDisplay(0x60 + i, 0), { text: String(i), isModifier: false });
  }
});

// 第 4 层：硬编码 US QWERTY 表——关键不变量：字母永远显示小写未移位字符，
// 即使 charCode 暗示大写（中文输入法布局兼容策略，勿改成 MapVirtualKeyW 结果）
test('字母键始终显示小写（忽略 charCode）', () => {
  assert.deepEqual(getKeyDisplay(0x41, 0), { text: 'a', isModifier: false });
  assert.deepEqual(getKeyDisplay(0x5A, 0), { text: 'z', isModifier: false });
  // charCode 传入大写 'A' 也不影响结果
  assert.deepEqual(getKeyDisplay(0x41, 'A'.charCodeAt(0)), { text: 'a', isModifier: false });
});

test('数字行与 OEM 符号键按未移位字符显示', () => {
  assert.deepEqual(getKeyDisplay(0x30, 0), { text: '0', isModifier: false });
  assert.deepEqual(getKeyDisplay(0x39, 0), { text: '9', isModifier: false });
  const oem = [
    [0xBA, ';'], [0xBB, '='], [0xBC, ','], [0xBD, '-'], [0xBE, '.'],
    [0xBF, '/'], [0xC0, '`'], [0xDB, '['], [0xDC, '\\'], [0xDD, ']'], [0xDE, "'"],
  ];
  for (const [vk, text] of oem) {
    assert.deepEqual(getKeyDisplay(vk, 0), { text, isModifier: false });
  }
});

// 第 5 层：charCode 兜底（可打印字符 + 空格）
test('未映射键用 charCode 兜底显示字符', () => {
  assert.deepEqual(getKeyDisplay(0xFF, 0x41), { text: 'A', isModifier: false });
  assert.deepEqual(getKeyDisplay(0xFF, 0x20), { text: ' ', isModifier: false });
});
test('charCode 为 0 或纯空白时不用兜底', () => {
  assert.equal(getKeyDisplay(0xFF, 0).text, 'KeyFF');
  // 兜底过滤条件是 trim() 为空且非空格 → 制表符落到第 6 层
  assert.equal(getKeyDisplay(0xFF, 0x09).text, 'KeyFF');
});

// 第 6 层：未知键 → 'Key' + 大写十六进制，按修饰键处理（排在前面）
test('完全未知键显示 Key+hex 且为修饰键', () => {
  assert.deepEqual(getKeyDisplay(0xE2, 0), { text: 'KeyE2', isModifier: true });
  assert.deepEqual(getKeyDisplay(0x07, 0), { text: 'Key7', isModifier: true });
});
