// keyboard-hook.ts
//
// 全部 koffi FFI / Win32 细节隔离在此，其他模块只见纯 JS 接口。
// 本模块是状态条数据的唯一来源（WH_KEYBOARD_LL 全局钩子）——应用展示的是
// 主机侧按键状态而非物理按键，这正是它诊断"卡住的键"的价值所在（见 CONTEXT.md）。
// 绕过本模块的任何状态来源都会破坏这一诊断能力。
//
// 两个不能动的实现约束：
// 1. koffi.register 返回的原生回调指针必须保持强引用（hookProc 局部变量被
//    start() 闭包持有），否则 GC 后原生层再触发即崩溃。
// 2. WH_KEYBOARD_LL 要求装钩线程持续泵消息，否则 Windows 静默摘除钩子——
//    10ms setInterval + PeekMessageW 循环就是为此存在，不能删。
//
// 不纳入单测：依赖 Windows GUI 会话与全局钩子权限。
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

const user32 = koffi.load('user32.dll');

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
              charCode: charCode & 0xFFFF
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
