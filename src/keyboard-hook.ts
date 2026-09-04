import koffi from 'koffi';

// Windows message constants
const WH_KEYBOARD_LL = 13;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_SYSKEYDOWN = 0x0104;
const WM_SYSKEYUP = 0x0105;
const MAPVK_VK_TO_CHAR = 2;
const PM_REMOVE = 1;
const VK_CAPITAL = 0x14;
const LLKHF_INJECTED = 0x10;
const KEYEVENTF_KEYUP = 0x0002;
const INPUT_KEYBOARD = 1;
const SPI_GETKEYBOARDDELAY = 22;
// 注册表 KeyboardDelay 档位 0/1/2/3 → 毫秒
const KEYBOARD_DELAY_MS = [250, 500, 750, 1000];

// --- 模块级 Win32 绑定：注入与查询（不依赖钩子实例）---
const user32 = koffi.load('user32.dll');

const KEYINPUT = koffi.struct('KEYINPUT', {
  wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
});
const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'int32', dy: 'int32', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
});
const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', { uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16' });
const INPUTUNION = koffi.union('INPUTUNION', { mi: MOUSEINPUT, ki: KEYINPUT, hi: HARDWAREINPUT });
const INPUT = koffi.struct('INPUT', { type: 'uint32', u: INPUTUNION });

const SendInput = user32.func('SendInput', 'uint32', ['uint32', koffi.pointer(INPUT), 'int32']);
const GetAsyncKeyState = user32.func('GetAsyncKeyState', 'int16', ['int32']);
const SystemParametersInfoW = user32.func('SystemParametersInfoW', 'bool', ['uint32', 'uint32', 'void *', 'uint32']);

/** 注入一个 key-up 事件（自动纠错的强制释放）。返回是否注入成功。 */
export function injectKeyUp(vkCode: number): boolean {
  const input = {
    type: INPUT_KEYBOARD,
    u: { ki: { wVk: vkCode, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } },
  };
  try {
    return SendInput(1, input, koffi.sizeof(INPUT)) === 1;
  } catch (e) {
    console.error('SendInput failed:', e.message);
    return false;
  }
}

/** 查询某虚拟键当前是否处于按下状态（供启动清理）。 */
export function isKeyHeld(vkCode: number): boolean {
  return (GetAsyncKeyState(vkCode) & 0x8000) !== 0;
}

/** 读系统重复延迟（毫秒）。失败返回 null，由调用方决定默认值。 */
export function getRepeatDelay(): number | null {
  try {
    const buf = Buffer.alloc(4);
    if (!SystemParametersInfoW(SPI_GETKEYBOARDDELAY, 0, buf, 0)) return null;
    return KEYBOARD_DELAY_MS[buf.readUInt32LE(0)] || null;
  } catch (e) {
    console.error('SPI_GETKEYBOARDDELAY failed:', e.message);
    return null;
  }
}

export interface KeyboardHook {
  start(): void;
  stop(): void;
}

interface KeyboardHookOptions {
  /** Called with boolean when Caps Lock toggles */
  onCapsChange?: (capsOn: boolean) => void;
}

/**
 * Create a low-level keyboard hook using koffi + Win32 API.
 * Uses SetWindowsHookExW(WH_KEYBOARD_LL) to capture all keystrokes
 * and PeekMessageW in a polling loop to pump the message queue.
 */
export function createKeyboardHook(
  cb: (event: KeyEventInfo) => void,
  opts?: KeyboardHookOptions
): KeyboardHook {
  // user32 与 INPUT 结构体在模块级已绑定

  // KBDLLHOOKSTRUCT: the keyboard event data structure
  const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
    vkCode: 'uint32',
    scanCode: 'uint32',
    flags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr_t'
  });

  // HOOKPROC type: LRESULT CALLBACK (int nCode, WPARAM wParam, LPARAM lParam)
  const HOOKPROC = koffi.proto('HOOKPROC', 'intptr_t', ['int32', 'uintptr_t', 'intptr_t']);

  // Win32 API functions
  const SetWindowsHookExW = user32.func(
    'SetWindowsHookExW', 'void *',
    ['int32', koffi.pointer(HOOKPROC), 'void *', 'uint32']
  );
  const CallNextHookEx = user32.func(
    'CallNextHookEx', 'intptr_t',
    ['void *', 'int32', 'uintptr_t', 'intptr_t']
  );
  const UnhookWindowsHookEx = user32.func(
    'UnhookWindowsHookEx', 'bool', ['void *']
  );
  const PeekMessageW = user32.func(
    'PeekMessageW', 'bool',
    ['void *', 'void *', 'uint32', 'uint32', 'uint32']
  );
  const TranslateMessage = user32.func(
    'TranslateMessage', 'bool', ['void *']
  );
  const DispatchMessageW = user32.func(
    'DispatchMessageW', 'intptr_t', ['void *']
  );
  const MapVirtualKeyW = user32.func(
    'MapVirtualKeyW', 'uint32', ['uint32', 'uint32']
  );
  const GetKeyState = user32.func(
    'GetKeyState', 'int16', ['int32']
  );

  let hookHandle: unknown = null;
  let pumpInterval: NodeJS.Timeout | undefined;
  let lastCapsState: boolean | null = null;

  return {
    start() {
      // Read initial Caps Lock state
      lastCapsState = (GetKeyState(VK_CAPITAL) & 1) !== 0;
      if (opts && opts.onCapsChange) {
        opts.onCapsChange(lastCapsState);
      }

      // Register the JS callback as a native function pointer
      // 注意：hookProc 必须保持强引用——被 GC 后原生回调触发即崩溃
      const hookProc = koffi.register((nCode: number, wParam: number, lParam: unknown) => {
        if (nCode >= 0) {
          // Decode the KBDLLHOOKSTRUCT from lParam pointer
          const ks = koffi.decode(lParam, KBDLLHOOKSTRUCT);
          const isKeyDown = wParam === WM_KEYDOWN || wParam === WM_SYSKEYDOWN;
          const isKeyUp = wParam === WM_KEYUP || wParam === WM_SYSKEYUP;

          if (isKeyDown || isKeyUp) {
            // Get unshifted character via MapVirtualKeyW (MAPVK_VK_TO_CHAR = 2)
            const charCode = MapVirtualKeyW(ks.vkCode, MAPVK_VK_TO_CHAR);
            cb({
              vkCode: ks.vkCode,
              scanCode: ks.scanCode,
              isKeyDown,
              charCode: charCode & 0xFFFF,
              isInjected: (ks.flags & LLKHF_INJECTED) !== 0
            });

            // Check Caps Lock toggle on key-up of VK_CAPITAL
            if (ks.vkCode === VK_CAPITAL && isKeyUp && opts && opts.onCapsChange) {
              const capsOn = (GetKeyState(VK_CAPITAL) & 1) !== 0;
              if (capsOn !== lastCapsState) {
                lastCapsState = capsOn;
                opts.onCapsChange(capsOn);
              }
            }
          }
        }
        return CallNextHookEx(null, nCode, wParam, lParam);
      }, koffi.pointer(HOOKPROC));

      // Install the low-level keyboard hook (dwThreadId=0 for global)
      hookHandle = SetWindowsHookExW(WH_KEYBOARD_LL, hookProc, null, 0);

      if (!hookHandle) {
        console.error('Failed to install keyboard hook');
        return;
      }

      // Message pump: WH_KEYBOARD_LL requires the installing thread
      // to pump messages. We poll PeekMessageW periodically.
      const msgBuf = Buffer.alloc(48); // sizeof(MSG) on x64
      pumpInterval = setInterval(() => {
        while (PeekMessageW(msgBuf, null, 0, 0, PM_REMOVE)) {
          TranslateMessage(msgBuf);
          DispatchMessageW(msgBuf);
        }
      }, 10);
    },

    stop() {
      clearInterval(pumpInterval);
      pumpInterval = undefined;
      if (hookHandle) {
        UnhookWindowsHookEx(hookHandle);
        hookHandle = null;
      }
    }
  };
}
