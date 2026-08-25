// Cherina Pod 前端构建：esbuild 打包 app.ts（前端逻辑）与 sw.ts（Service Worker）。
// 输出到 public/（Cloudflare ASSETS 目录），文件名保持稳定：
//   app.ts → public/app.js   （index.html 以 <script src="./app.js"> 引用）
//   sw.ts  → public/sw.js    （SW 注册路径 ./sw.js 不变）
// Worker（src/index.ts）由 wrangler 原生编译，不在此打包。
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  minify: false,
  sourcemap: false,
  target: 'es2022',
  logLevel: 'info',
};

const entries = [
  { entryPoints: ['src/app.ts'], outfile: 'public/app.js' },
  { entryPoints: ['src/sw.ts'], outfile: 'public/sw.js' },
];

if (watch) {
  const ctxs = await Promise.all(entries.map(e => context({ ...common, ...e })));
  await Promise.all(ctxs.map(c => c.watch()));
  console.log('👀 监听中…（Ctrl+C 退出）');
} else {
  await Promise.all(entries.map(e => build({ ...common, ...e })));
  console.log('✅ 构建完成：public/app.js + public/sw.js');
}
