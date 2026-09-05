// 全局 ambient 声明：IPC 契约与应用配置的唯一类型来源。
// 本文件无 import/export，声明对所有文件（主进程模块 + 经典脚本 renderer）全局可见，
// 编译时不产生任何产物。
//
// 约定：新增配置字段必须同时改 config-store.ts 的 DEFAULT_CONFIG 与此处的 Config；
// 新增 IPC 载荷形状在此定义，供 preload / renderer / main 共同引用。

interface RGBColor {
  r: number;
  g: number;
  b: number;
}

interface WindowPosition {
  x: number;
  y: number;
}

interface Config {
  fontSize: number;
  fontColor: RGBColor;
  blockSpacing: number;
  blockBgColor: RGBColor;
  statusBarBgColor: RGBColor;
  statusBarBgAlpha: number;
  padding: number;
  borderColor: RGBColor;
  borderWidth: number;
  width: number;
  statusBarVisible: boolean;
  windowPosition: WindowPosition | null;
  autoCorrectEnabled: boolean;
  autoCorrectMultiplier: number;
  releaseFlashDuration: number;
}

type ConfigKey = keyof Config;

/** 所有配置值类型的并集，供宽松签名（IPC 桥 / renderer 动态键）使用。 */
type ConfigValue = Config[ConfigKey];

/** keymap.getKeyDisplay 的返回形状。 */
interface KeyDisplay {
  text: string;
  isModifier: boolean;
}

/** main.js pressedKeys 中保存的按键条目（含按下顺序）。 */
interface PressedKey extends KeyDisplay {
  order: number;
}

/** keyboard-hook 回调收到的原始按键事件。 */
interface KeyEventInfo {
  vkCode: number;
  scanCode: number;
  isKeyDown: boolean;
  charCode: number;
  isInjected: boolean;
}

/** 'force-release' IPC 载荷：状态条做释放闪烁。 */
interface ForceReleaseInfo {
  vkCode: number;
  text: string;
}

/** 'resize-window' IPC 载荷：状态条请求窗口尺寸。 */
interface ResizeRequest {
  width: number;
  height: number;
}

/** preload 暴露给 renderer 的 window.electronAPI 契约（唯一 IPC 出口）。 */
interface ElectronAPI {
  getConfig(): Promise<Config>;
  setConfig(key: ConfigKey, value: ConfigValue): Promise<boolean>;
  onKeysUpdate(callback: (keys: PressedKey[]) => void): void;
  onConfigChange(callback: (config: Config) => void): void;
  onCapsUpdate(callback: (capsOn: boolean) => void): void;
  onForceRelease(callback: (info: ForceReleaseInfo) => void): void;
  resizeWindow(width: number, height: number): void;
}

interface Window {
  electronAPI: ElectronAPI;
}
