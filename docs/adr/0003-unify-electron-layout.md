# 统一 Electron 布局：废除 %TEMP% 双副本，回归项目内单一安装

历史布局把运行用的 Electron 放在 `%TEMP%\electron-temp`（`start.bat` 只认这条路径），项目 `node_modules` 里的 electron 仅供 electron-builder 打包用。动机是隔离一次不稳定的下载：electron 二进制默认从 GitHub Releases 拉取，国内网络频繁失败，把它挪出 `npm install` 主流程后日常依赖安装永远秒过。

实际造成的问题：没有任何脚本创建 TEMP 那份——`postinstall` 只打警告，`start.bat` 只报错退出。全新机器或 `%TEMP%` 被清理（重启、磁盘清理）后，`npm start` 必挂；且 172MB 的 `electron.exe` 存两份，TEMP 那份无版本锁定、无锁文件、不可靠。

决定：废除双布局，`start.bat` 只用项目内 `node_modules\electron\dist\electron.exe`；原设计要规避的下载失败问题改由 `.npmrc` 的 `electron_mirror=https://npmmirror.com/mirrors/electron/` 解决——镜像与项目既有 registry（npmmirror）一致，下载稳定性保留，版本由 `package-lock.json` 锁定。

已拒绝的替代方案：(1) 保留双路径、项目内优先 + TEMP 回退——两条路径两份维护两种故障模式，且"回退"触发的前提（项目内没有 electron）本身就是 `npm install` 损坏，回退只会掩盖报错；(2) 维持原布局仅修首次安装缺口（让 `postinstall` 自动装 TEMP 那份）——不消除重复下载与无锁定副本。
