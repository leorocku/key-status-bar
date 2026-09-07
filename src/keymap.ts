// keymap.ts
//
// 纯函数模块：vkCode → 状态条显示的文本与修饰键判定（getKeyDisplay 六级优先链：
// 控制键名 → 小键盘运算符 → 小键盘数字 → 硬编码字符表 → charCode 兜底 → Key+hex）。
// 无 electron / Win32 依赖，可独立单测（tests/keymap.test.js）。
//
// isModifier 决定排序（修饰键在前）而非语义分类——未知键回退也标 true 以排在
// 前排，宁可错排不可漏显。
// Virtual Key Code constants (subset of WinUser.h)
const VK_BACK = 0x08, VK_TAB = 0x09, VK_RETURN = 0x0D;
const VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12;
const VK_PAUSE = 0x13, VK_CAPITAL = 0x14, VK_ESCAPE = 0x1B;
const VK_SPACE = 0x20;
const VK_PRIOR = 0x21, VK_NEXT = 0x22, VK_END = 0x23, VK_HOME = 0x24;
const VK_LEFT = 0x25, VK_UP = 0x26, VK_RIGHT = 0x27, VK_DOWN = 0x28;
const VK_SNAPSHOT = 0x2C, VK_INSERT = 0x2D, VK_DELETE = 0x2E;
const VK_LWIN = 0x5B, VK_RWIN = 0x5C, VK_APPS = 0x5D;
const VK_NUMPAD0 = 0x60, VK_NUMPAD9 = 0x69;
const VK_MULTIPLY = 0x6A, VK_ADD = 0x6B, VK_SEPARATOR = 0x6C;
const VK_SUBTRACT = 0x6D, VK_DECIMAL = 0x6E, VK_DIVIDE = 0x6F;
const VK_F1 = 0x70;
const VK_NUMLOCK = 0x90, VK_SCROLL = 0x91;
const VK_LSHIFT = 0xA0, VK_RSHIFT = 0xA1;
const VK_LCONTROL = 0xA2, VK_RCONTROL = 0xA3;
const VK_LMENU = 0xA4, VK_RMENU = 0xA5;

// Control keys: keys without a visible printable character → English name
const CONTROL_KEY_NAMES: Record<number, string> = {
  [VK_BACK]: 'Backspace', [VK_TAB]: 'Tab', [VK_RETURN]: 'Enter',
  [VK_SHIFT]: 'Shift',    [VK_CONTROL]: 'Ctrl', [VK_MENU]: 'Alt',
  [VK_PAUSE]: 'Pause',    [VK_CAPITAL]: 'CapsLock', [VK_ESCAPE]: 'Esc',
  [VK_SPACE]: 'Space',
  [VK_PRIOR]: 'PgUp',     [VK_NEXT]: 'PgDn',
  [VK_END]: 'End',        [VK_HOME]: 'Home',
  [VK_LEFT]: 'Left',      [VK_UP]: 'Up',
  [VK_RIGHT]: 'Right',    [VK_DOWN]: 'Down',
  [VK_SNAPSHOT]: 'PrtSc', [VK_INSERT]: 'Ins', [VK_DELETE]: 'Del',
  [VK_LWIN]: 'Win',       [VK_RWIN]: 'Win', [VK_APPS]: 'Menu',
  [VK_NUMLOCK]: 'NumLk',  [VK_SCROLL]: 'ScrLk',
  [VK_LSHIFT]: 'Shift',   [VK_RSHIFT]: 'Shift',
  [VK_LCONTROL]: 'Ctrl',  [VK_RCONTROL]: 'Ctrl',
  [VK_LMENU]: 'Alt',      [VK_RMENU]: 'Alt',
};

// Numpad operators - produce characters, treated as non-modifier
const NUMPAD_OPERATOR_NAMES: Record<number, string> = {
  [VK_MULTIPLY]: '*', [VK_ADD]: '+', [VK_SEPARATOR]: ',',
  [VK_SUBTRACT]: '-', [VK_DECIMAL]: '.', [VK_DIVIDE]: '/',
};

// Populate F1-F24
for (let i = 0; i < 24; i++) {
  CONTROL_KEY_NAMES[VK_F1 + i] = 'F' + (i + 1);
}

// US QWERTY hardcoded unshifted character map (for Chinese keyboard layout)
// This avoids MapVirtualKeyW returning shifted chars when Shift is held.
const CHAR_KEY_MAP: Record<number, string> = {
  // Letters A-Z (0x41-0x5A) → lowercase
  0x41: 'a', 0x42: 'b', 0x43: 'c', 0x44: 'd', 0x45: 'e',
  0x46: 'f', 0x47: 'g', 0x48: 'h', 0x49: 'i', 0x4A: 'j',
  0x4B: 'k', 0x4C: 'l', 0x4D: 'm', 0x4E: 'n', 0x4F: 'o',
  0x50: 'p', 0x51: 'q', 0x52: 'r', 0x53: 's', 0x54: 't',
  0x55: 'u', 0x56: 'v', 0x57: 'w', 0x58: 'x', 0x59: 'y', 0x5A: 'z',
  // Numbers 0-9 (0x30-0x39)
  0x30: '0', 0x31: '1', 0x32: '2', 0x33: '3', 0x34: '4',
  0x35: '5', 0x36: '6', 0x37: '7', 0x38: '8', 0x39: '9',
  // US QWERTY OEM keys (unshifted characters)
  0xBA: ';',   // VK_OEM_1
  0xBB: '=',   // VK_OEM_PLUS
  0xBC: ',',   // VK_OEM_COMMA
  0xBD: '-',   // VK_OEM_MINUS
  0xBE: '.',   // VK_OEM_PERIOD
  0xBF: '/',   // VK_OEM_2
  0xC0: '`',   // VK_OEM_3
  0xDB: '[',   // VK_OEM_4
  0xDC: '\\',  // VK_OEM_5
  0xDD: ']',   // VK_OEM_6
  0xDE: '\'',  // VK_OEM_7
};

/**
 * Map a virtual key code to its display representation.
 * @param vkCode - Windows virtual key code
 * @param charCode - Result from MapVirtualKeyW(vkCode, MAPVK_VK_TO_CHAR)
 */
export function getKeyDisplay(vkCode: number, charCode: number): KeyDisplay {
  // 1. Check control keys (no printable character → English name)
  if (CONTROL_KEY_NAMES[vkCode] !== undefined) {
    return { text: CONTROL_KEY_NAMES[vkCode], isModifier: true };
  }

  // 2. Check numpad operators
  if (NUMPAD_OPERATOR_NAMES[vkCode] !== undefined) {
    return { text: NUMPAD_OPERATOR_NAMES[vkCode], isModifier: false };
  }

  // 3. Numpad numbers 0-9
  if (vkCode >= VK_NUMPAD0 && vkCode <= VK_NUMPAD9) {
    return { text: String(vkCode - VK_NUMPAD0), isModifier: false };
  }

  // 4. Hardcoded US QWERTY character map (always unshifted)
  if (CHAR_KEY_MAP[vkCode] !== undefined) {
    return { text: CHAR_KEY_MAP[vkCode], isModifier: false };
  }

  // 5. Fallback: use charCode for any unmapped key
  if (charCode > 0 && charCode < 0xFFFF) {
    const ch = String.fromCharCode(charCode);
    if (ch.trim() !== '' || ch === ' ') {
      return { text: ch, isModifier: false };
    }
  }

  // 6. Unknown key
  return { text: 'Key' + vkCode.toString(16).toUpperCase(), isModifier: true };
}
