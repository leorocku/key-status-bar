// 自动纠错纯逻辑模块：一次性按键按下计时 + 修饰键连击续期。
// 不依赖 electron / win32，计时函数可注入以便测试。
// 语义定义见 CONTEXT.md（按键按下计时、修饰键连击续期），
// 取舍依据见 docs/adr/0002-one-shot-press-timer.md。

export const MODIFIER_VKS: ReadonlySet<number> = new Set([
  0x10, 0xA0, 0xA1, // Shift / LShift / RShift
  0x11, 0xA2, 0xA3, // Ctrl / LCtrl / RCtrl
  0x12, 0xA4, 0xA5, // Alt / LAlt / RAlt
  0x5B, 0x5C,       // LWin / RWin
]);

/** 计时句柄类型：默认全局计时器返回 NodeJS.Timeout，测试假时钟返回 number。 */
export type TimerHandle = number | NodeJS.Timeout;

export interface AutoCorrectOptions {
  /** 返回当前自动释放延迟（毫秒），每次启动计时时读取 */
  getDelay: () => number;
  /** 计时到期时回调，参数为 vkCode */
  onForceRelease: (vkCode: number) => void;
  /** 可注入（测试用），默认全局 */
  setTimeout?: (callback: () => void, delay: number) => TimerHandle;
  /** 可注入（测试用），默认全局 */
  clearTimeout?: (handle: TimerHandle) => void;
  /** 初始启停状态，默认开 */
  enabled?: boolean;
}

export interface AutoCorrect {
  keyDown(vkCode: number): void;
  keyUp(vkCode: number): void;
  setEnabled(value: boolean): void;
  isEnabled(): boolean;
  /** 当前被追踪（计时运行中）的键，测试/调试用。 */
  tracked(): number[];
}

export function createAutoCorrect(opts: AutoCorrectOptions): AutoCorrect {
  const _setTimeout = opts.setTimeout || setTimeout;
  const _clearTimeout = opts.clearTimeout || clearTimeout;

  let enabled = opts.enabled !== false;
  const timers = new Map<number, TimerHandle>(); // vkCode -> 计时句柄

  function startTimer(vkCode: number): void {
    timers.set(vkCode, _setTimeout(() => {
      timers.delete(vkCode);
      opts.onForceRelease(vkCode);
    }, opts.getDelay()));
  }

  function cancelTimer(vkCode: number): void {
    const handle = timers.get(vkCode);
    if (handle !== undefined) {
      _clearTimeout(handle);
      timers.delete(vkCode);
    }
  }

  return {
    /**
     * 非注入的按下事件。计时为 0（未被追踪）才启动计时；
     * 重复按下不刷新（一次性计时）。全新按下修饰键时续期所有已按下修饰键。
     */
    keyDown(vkCode: number) {
      if (!enabled || timers.has(vkCode)) return;
      startTimer(vkCode);
      if (MODIFIER_VKS.has(vkCode)) {
        for (const vk of [...timers.keys()]) {
          if (vk !== vkCode && MODIFIER_VKS.has(vk)) {
            cancelTimer(vk);
            startTimer(vk);
          }
        }
      }
    },

    /** 非注入或注入的释放事件：取消计时。 */
    keyUp(vkCode: number) {
      cancelTimer(vkCode);
    },

    /** 启停开关。关闭时清空全部计时（退回纯显示形态）。 */
    setEnabled(value: boolean) {
      enabled = value;
      if (!enabled) {
        for (const vk of [...timers.keys()]) cancelTimer(vk);
      }
    },

    isEnabled: () => enabled,

    /** 当前被追踪（计时运行中）的键，测试/调试用。 */
    tracked: () => [...timers.keys()],
  };
}
