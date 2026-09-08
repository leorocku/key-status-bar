# Repository Guidelines

## Project Overview

KeyStatusBar：Windows-only 的 Electron 托盘应用，通过 `koffi` FFI 安装 Win32 全局低级键盘钩子（`WH_KEYBOARD_LL`），把当前按下的键和 Caps Lock 状态实时渲染到一个透明、置顶、无边框的状态条窗口上。附带一个配置面板窗口，可调整字体、颜色、间距等外观参数。

TypeScript 5.9（strict），CommonJS 输出，无打包器、无前端框架。所有渲染层代码为 vanilla DOM。

## 项目背景与目标（为什么做这个应用）

用户的主机与操作位相距约 30 米，键盘/鼠标/显示器全部经由**设备信号增强器**（发射器 + 接收器，网络双绞线连接）传输。这条长链路经常**丢信号**或**解析出错**，产生两类故障：

1. **释放信号丢失**：按下 C 并释放，但释放信号没到主机 → 主机认为 C 仍被按住 → 编辑器持续输入 `C`，直到再次按下并成功释放 C。
2. **信号解析出错**：按下 C 并释放，主机却收到“按下 B + 释放 C” → **B** 卡死在按下状态持续输入，直到按下并成功释放 B。

两种故障的共同点：**卡住的键不一定是用户以为的那个键**（故障 2 中是 B 不是 C），且用户无法凭手感判断。本应用的唯一目标就是解决这个判断问题：实时显示**主机当前认为处于按下状态的键**，用户看到卡住的键后，对它补一次“按下 + 释放”，让正确的释放信号到达主机，即可解除持续输入。

由此推出的两条设计约束，改代码时不要破坏：

- **状态条展示的是主机侧（Windows 钩子层）的按键状态，不是用户物理按了什么**——这正是它有用的原因。任何绕过 `src/keyboard-hook.ts` 钩子的状态来源都会让它失去诊断价值。
- 显示必须**低延迟且始终可见**（透明置顶、托盘常驻、不抢焦点），因为用户是在故障发生时盯着它做判断的。

## Architecture & Data Flow

单 main 进程持有全部应用状态（`src/main.ts`），最多两个 BrowserWindow（statusBar、config），共用同一个 `src/preload.ts`。

```
Win32 键盘事件
  → src/keyboard-hook.ts (koffi: SetWindowsHookExW + PeekMessageW 消息泵, 10ms setInterval)
  → cb({ vkCode, scanCode, isKeyDown, charCode })
  → src/main.ts onKeyEvent → pressedKeys: Map<vkCode, PressedKey>
    （键已按下又收到 down = 重复 down：连续 2 个置 isRepeating，key-up 归零）
  → getSortedKeys()（修饰键在前，各自按按下顺序）
  → IPC 'keys-update' → src/renderer/statusbar.ts 重建 span.key-block（isRepeating 加闪烁 class）
```

配置流：`src/renderer/config.ts` → `window.electronAPI.setConfig(key, value)` → `src/config-store.ts`（3s debounce 落盘 + EventEmitter 'change'）→ main 广播 `'config-changed'` 到状态条 + 重建托盘菜单。

### IPC 通道（字符串字面量；载荷类型定义在 `src/types.d.ts`）

| 通道 | 方向 | 方式 | 载荷 |
|---|---|---|---|
| `get-config` | renderer→main | invoke | 无 → config 对象 |
| `set-config` | renderer→main | invoke | `(key, value)` → true |
| `resize-window` | renderer→main | send | `{ width, height }` |
| `keys-update` | main→renderer | send | 排序后的按键数组 |
| `config-changed` | main→renderer | send | 完整 config |
| `caps-update` | main→renderer | send | boolean |

**新增 IPC 通道必须同时改三处**：`src/main.ts`（handler）、`src/preload.ts`（`window.electronAPI` 白名单）、对应 renderer 脚本。载荷形状必须同步更新 `src/types.d.ts`。preload 是唯一桥，renderer 永远不直接接触 `ipcRenderer`。

### koffi / Win32 封装（`src/keyboard-hook.ts`）

工厂函数 `createKeyboardHook(cb, opts) → { start, stop }`：

- `SetWindowsHookExW(WH_KEYBOARD_LL, hookProc, null, 0)` 装全局钩子；回调经 `koffi.register` 注册为原生函数指针。
- `WH_KEYBOARD_LL` 要求装钩线程泵消息 → `setInterval` 每 10ms `PeekMessageW` 循环（`msgBuf = Buffer.alloc(48)`，x64 `sizeof(MSG)`）。
- `MapVirtualKeyW(vk, MAPVK_VK_TO_CHAR)` 提供 charCode 兜底；`GetKeyState(VK_CAPITAL)` 检测 Caps 翻转（仅在 `VK_CAPITAL` key-up 时比对）。
- `stop()`：clearInterval + `UnhookWindowsHookEx`，幂等。**`will-quit` 必须调用**（`src/main.ts` 已接），否则钩子泄漏。

## Key Directories

```
/src                 TypeScript 源码（编译到 /build）
├── main.ts          Electron 入口，窗口/托盘/生命周期/按键状态机（全部应用状态在此）
├── preload.ts       contextBridge → window.electronAPI（IPC 白名单唯一出口）
├── keyboard-hook.ts koffi FFI + Win32 钩子封装（SetWindowsHookExW + PeekMessageW 消息泵）
├── keymap.ts        纯函数 vkCode → { text, isModifier }
├── config-store.ts  JSON 配置持久化（userData 目录，3s debounce）
├── types.d.ts       全局 ambient 类型：IPC 契约与配置形状的唯一来源（见 ADR-0004）
└── renderer/        两个窗口的 TS（vanilla DOM，IIFE 包裹）
/renderer            静态资产（HTML/CSS），由 scripts/copy-assets.js 复制到 build/renderer/
/build               编译产物（不入版本控制；.gitignore）
/tests               node --test 单元测试（JS，测编译产物，不打包）
/scripts             copy-assets.js（构建辅助）
/docs/adr/           架构决策记录
/CONTEXT.md          领域词汇表（硬件故障与显示语义的权威定义）
```

## Development Commands

```bat
:: 一次性准备（项目依赖）
npm install

:: 编译（tsc + 复制静态资产；其他脚本已链式调用，通常无需手动跑）
npm run compile

:: 运行（先编译，再用项目内 electron.exe 加载本目录）
npm start

:: 打包 NSIS 安装器 → dist/（先编译）
npm run build
```

验证方式：`npm test`（17 用例）之外手动冒烟——`npm start` 后：按任意组合键确认状态条渲染与 `CAPS ON/OFF`，松开后键块消失；**按住任意键超过系统重复延迟**（约 0.75s），该键块应变红闪烁（主机自动重复进行中），松开即灭；配置面板滑动条/颜色即时生效；托盘菜单可隐藏状态条、开配置面板、退出。

## Code Conventions & Common Patterns

- **模块格式**：TypeScript 源码（`src/`），`tsc` 编译为 CommonJS 输出（`build/`）。renderer 脚本是经典脚本（无 import/export），用 IIFE 包裹避免全局作用域冲突。
- **命名**：文件 `kebab-case`（`keyboard-hook.ts`）；标识符 `camelCase`；常量 `SCREAMING_SNAKE_CASE`（`DEFAULT_CONFIG`、`VK_*`、`COLOR_FIELDS`）。
- **IPC 通道名**：`kebab-case` 字符串字面量，两侧手写——改一侧必须同步另一侧；载荷形状定义在 `src/types.d.ts`。
- **UI 文案**：简体中文（`lang="zh-CN"`、托盘菜单、配置面板、部分注释）。
- **安全模型**：`contextIsolation: true` + `nodeIntegration: false`。renderer 一律走 `window.electronAPI`，禁止引入任何需要 nodeIntegration 的写法。
- **配置即契约**：新配置字段必须同时改 `src/config-store.ts` 的 `DEFAULT_CONFIG` 与 `src/types.d.ts` 的 `Config` 接口——`setConfig` 对未知 key 静默拒绝（仅 `console.error`），不会抛错，容易误以为生效。
- **样式注入**：`src/renderer/statusbar.ts` 把 config 写入 `--sb-*` CSS 自定义属性；`statusbar.css` 对这些变量**无 fallback**，漏设一个窗口样式即坏。
- **表驱动控件**：`src/renderer/config.ts` 用 `COLOR_FIELDS` 常量表绑定 4 组颜色控件（picker ↔ RGB 输入 ↔ swatch 双向同步）；新颜色字段照此模式加表项 + HTML 控件。
- **窗口自适应**：`ResizeObserver` 测 container → `resizeWindow` → main 用 `setBounds`（不是 `setSize`——透明无边框窗口 `setSize` 会残留旧命中区域，见 `src/main.ts` 注释）。
- **托盘常驻**：`window-all-closed` 被 `preventDefault`，关窗不退出，退出只走托盘菜单。

### 已知陷阱（改代码前必读）

1. **`src/keymap.ts` 的 `CHAR_KEY_MAP` 故意硬编码 US QWERTY 未移位字符**（兼容中文输入法布局，避免 Shift 按下时显示大写字母）。不要"修复"成用 `MapVirtualKeyW` 结果。
2. **`koffi.register` 回调必须保持强引用**——`hookProc` 变量若被 GC，原生回调触发即崩溃。重构时不要把它变成匿名表达式。
3. **落盘是 3s debounce**：退出前靠 `will-quit` 里的 `flushSave()`；砍掉它用户最后 3 秒的配置会丢。
4. **钩子安装失败仅 `console.error`**，应用照常运行但无按键显示——调试“没反应”先看主进程日志。
5. **未知按键**回退显示 `Key` + 十六进制 vkCode，且 `isModifier: true`（会排在前面）。
6. **`flushSave()` 有 `configPath` 守卫**：第二实例退出路径会在 `createConfigStore()` 之前触发 `will-quit`。

## Important Files

| 文件 | 角色 |
|---|---|
| `src/main.ts` | 入口；窗口创建、托盘、按键状态机、生命周期（`whenReady`/`will-quit`/单实例锁） |
| `src/preload.ts` | `window.electronAPI` 全部 6 个方法；IPC 白名单唯一出口 |
| `src/keyboard-hook.ts` | koffi/Win32 全部细节隔离在此（钩子安装/消息泵/Caps 检测） |
| `src/keymap.ts` | `getKeyDisplay(vkCode, charCode)`，六级优先链（控制键名 → 小键盘运算符 → 小键盘数字 → 硬编码字符表 → charCode 兜底 → `Key`+hex） |
| `src/config-store.ts` | `DEFAULT_CONFIG`（唯一配置 schema）、`getConfig/setConfig/onConfigChange/flushSave` |
| `src/types.d.ts` | 全局 ambient 类型：`Config`、`ElectronAPI`、`PressedKey`、`KeyEventInfo` 等（见 ADR-0004） |
| `src/renderer/statusbar.ts` / `config.ts` | 两个窗口的全部逻辑 |
| `package.json` | scripts + 内嵌 electron-builder 配置（见下） |
| `start.bat` | 运行入口；缺 electron 时其报错信息是唯一的"安装文档" |
| `CONTEXT.md` / `docs/adr/` | 领域词汇表与决策记录 |

**打包白名单**：`package.json` 的 `build.files` 现为 `["build/**/*"]`，自动覆盖所有编译产物与复制的静态资产。新增源码放 `src/`，无需手动加白名单。

## Runtime/Tooling Preferences

- **平台**：仅 Windows x64。`@koromix/koffi-win32-x64` 是硬 dependency，在 Linux/macOS 上 `npm install` 会 `EBADPLATFORM` 失败。
- **运行时**：Electron 31（lockfile 解析为 31.7.7），Node CommonJS。
- **Electron 布局**：运行与打包共用项目 `node_modules` 内的单一 electron（`start.bat` 指向 `node_modules\electron\dist\electron.exe`）。二进制下载源由 `.npmrc` 的 `electron_mirror` 指向 npmmirror（见 `docs/adr/0003-unify-electron-layout.md`）。不要再引入 `%TEMP%` 副本。
- **依赖**：运行时仅 `koffi@3.0.2`（精确版本）+ 其平台二进制包；开发依赖含 `typescript@5.9.3` 与 `@types/node`。不要升级或替换 koffi，除非同步验证钩子行为。
- **registry**：`package-lock.json` 全部解析自 `registry.npmmirror.com`；重新生成 lock 时注意镜像漂移。
- **包管理器**：npm。

## Testing & QA

**测试**：内置 `node --test`，零新增依赖，`npm test` 即可（17 用例）。`tests/keymap.test.js` 覆盖 `getKeyDisplay` 六级优先链与各层 `isModifier` 契约；`tests/config-store.test.js` 用 `require.cache` 注入假 `electron` 模块 + 临时目录做真实磁盘往返（默认值、合并、损坏回落、未知 key 拒绝、`flushSave` 持久化）。无 lint、无 CI，其余验证靠 `npm start` 手动冒烟。

新增测试放 `tests/*.test.js`，用 `node --test` + `node:assert/strict`（`test` script 已配好，先编译再跑）；`tests/` 不在 `build.files` 白名单，不会进安装包。`src/keyboard-hook.ts` 依赖 Windows GUI 会话与全局钩子权限，不纳入单测。
