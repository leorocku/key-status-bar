# KeyStatusBar

一个 Windows 托盘应用：实时显示**主机当前认为处于按下状态的键**，并自动解除卡住的键。

## 为什么需要它

我的主机与操作位相距约 30 米，键盘信号经由**设备信号增强器**（发射器 + 接收器，网线连接）传输。这条长链路经常丢信号或解析出错：

- **释放信号丢失**：按下并释放了 C，但释放信号没到主机 → 主机认为 C 仍被按住 → 编辑器持续输入 `c`。
- **信号解析出错**：按下并释放了 C，主机却收到"按下 B + 释放 C" → 卡住的键是 **B**，而你根本不知道。

两种故障的共同点：**卡住的键不一定是你以为的那个**，且无法凭手感判断。KeyStatusBar 的用途就是消除这个判断问题：盯着状态条看到哪个键卡住了，对它补一次"按下 + 释放"，让正确的释放信号到达主机即可。

## 功能

- 透明、置顶、无边框的状态条，实时渲染主机侧按下的全部按键（修饰键在前）
- 显示 Caps Lock 状态（`CAPS ON/OFF`）
- **自动纠错**：按键超过可配置的自动释放延迟仍未释放时，自动注入一次释放，解除卡键（可关闭、延迟可调）
- 配置面板：字体、颜色、间距、自动释放参数等外观与行为设置，即时生效
- 托盘常驻：关闭窗口不退出，从托盘菜单退出

## 技术栈

- Electron 31（仅 Windows x64）
- [koffi](https://koffi.dev/) FFI 调用 Win32 `WH_KEYBOARD_LL` 全局键盘钩子
- 纯 CommonJS + vanilla DOM，无打包器、无前端框架

## 使用

要求：Windows 10/11 x64。

安装器需自行打包（见下文"打包与测试"）。启动后状态条显示在屏幕上方，托盘出现图标；右键托盘图标可打开配置面板、切换自动纠错、退出。

## 从源码运行

要求：Node 18+、npm。

```bat
npm install
npm start
```

> 注：项目仅支持 Windows；electron 二进制下载源已在 `.npmrc` 配置为国内镜像，国内网络可直接安装。

## 打包与测试

```bat
:: 单元测试（27 用例）
npm test

:: 打包 NSIS 安装器 → dist/
npm run build
```

## 项目结构

```
├── main.js              入口；窗口/托盘/按键状态机/生命周期
├── preload.js           contextBridge 白名单（renderer 唯一 IPC 出口）
├── keyboard-hook.js     koffi/Win32 钩子封装与注入
├── auto-correct.js      自动纠错纯逻辑
├── keymap.js            vkCode → 显示文本映射
├── config-store.js      配置持久化
├── renderer/            状态条与配置面板（HTML/CSS/JS）
├── tests/               node --test 单元测试
├── CONTEXT.md           领域词汇表
└── docs/adr/            架构决策记录
```
