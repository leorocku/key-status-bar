# 用 SendInput 注入 key-up 实现强制释放

卡住的键之所以持续打字，是因为释放信号丢失后键盘状态表停留在"按下"，win32k 持续合成重复按键。要真正解除，必须向系统输入流注入一个 key-up 清掉状态表。决定采用 `SendInput(KEYEVENTF_KEYUP)` 注入，钩子通过 `KBDLLHOOKSTRUCT.flags & LLKHF_INJECTED` 识别自身注入的事件，只用于同步显示、不参与计时。

已实验验证:注入 up 能清掉 `GetAsyncKeyState` 按键位（本地可复现）;注入事件不触发自动重复（无害，因本机制只注入 up）。未验证项:真实卡键场景下注入 up 能否终止 win32k 的 typematic 重复流——测试环境无法物理复现卡键，需首次上线实测。备选方案（只更新应用内显示状态、不注入）无法停止编辑器打字，等于没修，故拒绝。
