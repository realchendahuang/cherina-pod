// Cherina Pod 前端构建：esbuild 打包 app.ts（前端逻辑）与 sw.ts（Service Worker）。
// 输出到 public/（Cloudflare ASSETS 目录），文件名保持稳定：
//   app.ts → public/app.js   （index.html 以 <script src="./app.js"> 引用）
//   sw.ts  → public/sw.js    （SW 注册路径 ./sw.js 不变）
// Worker（src/index.ts）由 wrangler 原生编译，不在此打包。
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

// 站点配置：构建时注入，fork 后用环境变量覆盖即可，不必改源码。
//   SITE_URL   站点根 URL（canonical / og:url / 结构化数据）
//   SITE_NAME  站点名
//   SITE_DESC  站点描述
//   AUDIO_CDN  自建音频源前缀（**留空 = 只走 RSS 外链**，播放器自动降级）
// 例：SITE_URL=https://my-pod.pages.dev AUDIO_CDN=https://my-audio.example.com/ npm run build
// 注意用 `in` 判空而非 `||`：显式传空串要生效（AUDIO_CDN="" 表示"不要自建源"）。
const envOr = (key, fallback) => (key in process.env ? process.env[key] : fallback);

const siteConfig = {
  __SITE_URL__: JSON.stringify(envOr('SITE_URL', 'https://pod.cherina.app')),
  __SITE_NAME__: JSON.stringify(envOr('SITE_NAME', 'Cherina Pod')),
  __SITE_DESC__: JSON.stringify(envOr('SITE_DESC',
    'Cherina Pod 双语播客精听：中英对照逐句学习，跟读循环、倍速播放，从 BBC、TED、Hidden Brain、99% Invisible 等优质英文播客中提升听力与口语。')),
  __AUDIO_CDN__: JSON.stringify(envOr('AUDIO_CDN', 'https://pod-audio.cherina.app/')),
};

// 生产构建开 minify + sourcemap：包体显著变小；出问题时 .map 可还原排错。
// watch（本地开发）保持不压缩，便于直接读产物调试。
const common = {
  bundle: true,
  minify: !watch,
  sourcemap: !watch,
  target: 'es2022',
  logLevel: 'info',
  define: siteConfig,
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
