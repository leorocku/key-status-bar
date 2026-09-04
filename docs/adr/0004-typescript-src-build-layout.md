# 0004 - TypeScript 迁移：src/ → build/，无打包器，全局 ambient 类型

## Context

项目需要类型安全（尤其是 IPC 契约——此前两侧手写字符串字面量、无共享常量）。决定迁移到 TypeScript 5.9.3（strict 模式）。

## Decision

1. **源码进 `src/`，编译输出到 `build/`**。`package.json` 的 `main` 指向 `build/main.js`；`start.bat`（`electron .`）无需修改。打包白名单简化为 `["build/**/*"]`。

2. **不引入打包器**。`tsc` 直出 CommonJS（主进程模块）+ 经典脚本（renderer）。renderer 的 `.html`/`.css` 留在 `renderer/` 作为静态资产，由 `scripts/copy-assets.js` 复制到 `build/renderer/`。

3. **全局 ambient 声明（`src/types.d.ts`）** 作为 IPC 契约的唯一类型来源。无 import/export = 全局可见，主进程模块与经典脚本 renderer 都能直接引用，编译时不产生任何产物。`ElectronAPI`、`Config`、`PressedKey`、`KeyEventInfo`、`ForceReleaseInfo`、`RGBColor` 等类型定义在此。

4. **测试保持 JS，测编译产物**。`tests/*.test.js` 的 `require` 指向 `../build/*`，`npm test` 前先 `npm run compile`。零新测试依赖。

5. **renderer 脚本用 IIFE 包裹**。经典脚本共享全局作用域，两个窗口的同名声明（`clampByte`、`init`、`currentConfig`）会冲突。

## Considered Alternatives

- **打包器（webpack/esbuild）**：解决模块解析但引入构建复杂度和新依赖，本项目编译量极小（8 个文件），收益为零。
- **模块式 `types.ts` + `import type`**：renderer 是 `<script>` 标签加载的经典脚本，没有模块系统——要么给 renderer 也走 ambient 声明（两种机制并存），要么引入打包器。全局 ambient 一种机制通吃。
- **测试也转 TS**：需要引入 `tsx` 或把测试一起编译，复杂度更高，收益仅为测试文件的类型提示。

## Consequences

- `npm start` / `npm test` / `npm run build` 均自动先编译（链式），每次多约 1 秒。
- 新增配置字段必须同时改 `config-store.ts` 的 `DEFAULT_CONFIG` 与 `types.d.ts` 的 `Config` 接口。
- 新增源码放 `src/`，不再放根目录。
