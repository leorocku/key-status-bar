// 复制 renderer 静态资产（html/css）到 build/renderer/。
// tsc 只编译 .ts；html/css 需要手动搬运。
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'renderer');
const dest = path.join(__dirname, '..', 'build', 'renderer');
fs.mkdirSync(dest, { recursive: true });

for (const file of fs.readdirSync(src)) {
  if (file.endsWith('.html') || file.endsWith('.css')) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
}
