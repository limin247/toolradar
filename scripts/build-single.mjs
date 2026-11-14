// 把 index.html + style.css + app.js + tools.js 打成一个可直接双击/发送的 HTML
// 用法: node scripts/build-single.mjs  ->  dist/toolradar.html
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT = path.join(OUT_DIR, 'toolradar.html');

const read = (p) => fs.readFile(path.join(ROOT, p), 'utf8');

// 内联进 <script> 时必须打断 </script>，否则会提前闭合标签。
// 在 JS 字符串/模板里 \/ 等价于 /，语义不变。
const safeJs = (s) => s.replace(/<\/script/gi, '<\\/script');

let html = await read('index.html');
const css = await read('assets/style.css');
const app = await read('assets/app.js');
const data = await read('data/tools.js');

const before = html.length;

// 注意：index.html 是 CRLF，替换一律用正则容错；用函数式替换避免 $& 被解释
html = html.replace(
  /<link rel="stylesheet" href="assets\/style\.css">/,
  () => `<style>\n${css}\n</style>`,
);

html = html.replace(
  /<script src="data\/tools\.js"><\/script>\s*<script src="assets\/app\.js"><\/script>/,
  () => `<script>\n${safeJs(data)}\n</script>\n<script>\n${safeJs(app)}\n</script>`,
);

// 兜底：只看标签属性，别被正文/脚本里的说明文字误伤
const leftovers = [/src="assets\//, /src="data\//, /href="assets\//].filter((re) => re.test(html));
if (leftovers.length) {
  console.error(`!! 还有没内联的引用: ${leftovers.join(", ")}`);
  process.exitCode = 1;
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(OUT, html, 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + 'KB';
console.log(`dist/toolradar.html  ${kb(html.length)}（原 index.html ${kb(before)}，内联 CSS ${kb(css.length)} / JS ${kb(app.length)} / 数据 ${kb(data.length)}）`);
