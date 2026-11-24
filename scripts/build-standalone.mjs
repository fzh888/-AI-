/**
 * 打包「离线单文件版」：把 src/game 的引擎 + Matter.js + 纯 DOM 外壳打成一个 IIFE，
 * 输出到 public/standalone/，双击 index.html 即可游玩（file:// 也能跑）。
 *
 *   pnpm build:standalone
 *
 * 产物：
 *   public/standalone/index.html
 *   public/standalone/game.js      （含 Matter.js，无外部依赖）
 *   public/standalone/style.css    （主题 token 从 src/app/globals.css 抽出）
 *   public/standalone/sprites/**   （角色/发射器序列帧，相对路径引用）
 */

import { createRequire } from 'node:module';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'standalone');

/** 取出 src 里从 startMarker 开始的第一个 { ... } 块的内容 */
function extractBlock(source, startMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`找不到 ${startMarker}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`${startMarker} 的括号没有闭合`);
}

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#9fd8f4" />
    <title>贪吃的绿皮猪</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <div id="stage">
      <canvas id="game"></canvas>

      <div id="hud" class="hud" hidden>
        <div class="hud-top">
          <div class="gd-plank plank">
            <span class="lv-id" id="levelId">1-1</span>
            <span id="levelName"></span>
          </div>
          <div class="hud-right">
            <div class="chain-badge" id="chainBadge" hidden>连锁 ×<span id="chainNum">0</span></div>
            <div class="gd-plank plank score"><span class="label">分数</span><span id="score">0</span></div>
            <button type="button" class="gd-btn icon" data-act="zoom-in" aria-label="放大">+</button>
            <button type="button" class="gd-btn icon" data-act="zoom-out" aria-label="缩小">−</button>
            <button type="button" class="gd-btn icon" data-act="achievements" aria-label="成就">★</button>
            <button type="button" class="gd-btn icon" data-act="retry" aria-label="重玩">↻</button>
            <button type="button" class="gd-btn icon" data-act="menu" aria-label="菜单">☰</button>
          </div>
        </div>
        <div class="hud-bottom">
          <div class="pigbar" id="pigbar"></div>
          <p class="hint" id="hint"></p>
        </div>
      </div>

      <div id="overlay" class="overlay"></div>
      <div class="rotate-tip">横屏玩更爽：把手机横过来</div>
    </div>
    <script src="./game.js"></script>
  </body>
</html>
`;

async function build() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // 1) JS：引擎 + Matter.js + DOM 外壳
  await esbuild.build({
    entryPoints: [path.join(root, 'src/standalone/main.ts')],
    outfile: path.join(outDir, 'game.js'),
    bundle: true,
    format: 'iife',
    target: ['es2019'],
    platform: 'browser',
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
  });

  // 2) CSS：把 globals.css 里的主题 token 与卡通组件抽出来注入
  const globals = await readFile(path.join(root, 'src/app/globals.css'), 'utf8');
  const rootBlock = extractBlock(globals, '\n:root');
  const components = extractBlock(globals, '@layer components');
  const standaloneCss = await readFile(path.join(root, 'src/standalone/main.css'), 'utf8');
  const theme = `:root {${rootBlock}}\n${components}`;
  await writeFile(
    path.join(outDir, 'style.css'),
    standaloneCss.replace('/* @@INJECT_THEME@@ */', theme),
    'utf8',
  );

  // 3) 角色/发射器序列帧
  await cp(path.join(root, 'public/sprites'), path.join(outDir, 'sprites'), { recursive: true });

  // 4) 入口页
  await writeFile(path.join(outDir, 'index.html'), html, 'utf8');

  console.log(`离线版已生成：${path.relative(root, outDir)}/index.html`);
}

await build();
