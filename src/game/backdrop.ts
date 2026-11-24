import { GROUND_Y, WORLD_WIDTH } from './levels';

/**
 * 关卡舞台：明亮的卡通鸟村天空。
 *
 * 天空 / 太阳 / 远山 / 草坡 / 树丛这些一眼看去不会变的东西，
 * 一次性画进离屏画布缓存，之后每帧只做一次 drawImage；
 * 云是唯一会动的背景元素，单独每帧画（7 朵，很便宜）。
 */
const CACHE_TOP = -560;
const CACHE_BOTTOM = 1040;
const CACHE_W = WORLD_WIDTH;
const CACHE_H = CACHE_BOTTOM - CACHE_TOP;

const SKY = { top: '#48a9e2', mid: '#9fd8f4', low: '#dcf3ff' };
const MOUNTAIN = { far: '#a9d7e6', farLight: '#c8ebf5', near: '#7cbfd4', nearLight: '#a4dbe9' };
const HILL = { face: '#8ed254', light: '#b6ea83', dark: '#5da532', deep: '#4a8a26' };
const TREE = { canopy: '#57a033', canopyLight: '#7cc24d', trunk: '#8a5a2c' };

let cache: HTMLCanvasElement | null = null;

/** 兼容旧调用：舞台是矢量画的，这里只是提前把缓存建好 */
export function preloadBackdrop(): void {
  if (cache) return;
  buildCache();
}

function mountains(
  ctx: CanvasRenderingContext2D,
  baseY: number,
  height: number,
  color: string,
  light: string,
  seed: number,
): void {
  ctx.beginPath();
  ctx.moveTo(-260, baseY);
  let x = -260;
  let i = 0;
  while (x < WORLD_WIDTH + 260) {
    const r = Math.sin((seed + i) * 1.7) * 0.5 + Math.cos((seed + i) * 0.9) * 0.5;
    const h = height * (0.55 + Math.abs(r) * 0.75);
    const w = 240 + Math.abs(Math.sin(i * 2.3)) * 220;
    ctx.lineTo(x + w / 2, baseY - h);
    ctx.lineTo(x + w, baseY);
    x += w;
    i += 1;
  }
  ctx.lineTo(WORLD_WIDTH + 260, baseY + 400);
  ctx.lineTo(-260, baseY + 400);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  // 受光的左坡：从山脊往左压一条亮面，山才有体积
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = light;
  ctx.fillRect(-260, baseY - height * 1.4, WORLD_WIDTH + 520, height * 0.5);
  ctx.restore();
}

function hill(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = HILL.face;
  ctx.fill();
  // 顶部受光
  ctx.save();
  ctx.clip();
  ctx.fillStyle = HILL.light;
  ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 0.42);
  ctx.restore();
}

/**
 * 一棵坡上的小树。lean（px）让树冠相对树根横移，用来表现风：
 * 只平移控制点、不换坐标系（比 save/rotate/restore 便宜得多，软件光栅下差别明显）。
 */
function tree(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number, lean = 0): void {
  const topX = x + lean * 0.42;
  const headX = x + lean;
  ctx.fillStyle = TREE.trunk;
  ctx.beginPath();
  ctx.moveTo(x - 5 * s, baseY);
  ctx.lineTo(topX - 3 * s, baseY - 34 * s);
  ctx.lineTo(topX + 3 * s, baseY - 34 * s);
  ctx.lineTo(x + 5 * s, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = TREE.canopy;
  ctx.beginPath();
  ctx.arc(headX, baseY - 52 * s, 30 * s, 0, Math.PI * 2);
  ctx.arc(headX - 24 * s, baseY - 38 * s, 21 * s, 0, Math.PI * 2);
  ctx.arc(headX + 25 * s, baseY - 38 * s, 22 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = TREE.canopyLight;
  ctx.beginPath();
  ctx.arc(headX - 8 * s, baseY - 62 * s, 17 * s, 0, Math.PI * 2);
  ctx.arc(headX + 8 * s, baseY - 56 * s, 11 * s, 0, Math.PI * 2);
  ctx.fill();
}

function buildCache(): void {
  const cv = document.createElement('canvas');
  cv.width = CACHE_W;
  cv.height = CACHE_H;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const oy = -CACHE_TOP; // 世界 y → 画布 y

  // 天空
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y + oy);
  sky.addColorStop(0, SKY.top);
  sky.addColorStop(0.55, SKY.mid);
  sky.addColorStop(1, SKY.low);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CACHE_W, CACHE_H);

  // 太阳：左上角一团暖光
  const sunX = 300;
  const sunY = 40 + oy;
  const glow = ctx.createRadialGradient(sunX, sunY, 20, sunX, sunY, 460);
  glow.addColorStop(0, 'rgba(255,252,214,0.95)');
  glow.addColorStop(0.28, 'rgba(255,246,190,0.42)');
  glow.addColorStop(1, 'rgba(255,246,190,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(sunX - 520, sunY - 520, 1040, 1040);

  // 远山两层：越远越淡、越靠上，靠色差拉开空气感
  mountains(ctx, 560 + oy, 210, MOUNTAIN.far, MOUNTAIN.farLight, 2.1);
  mountains(ctx, 640 + oy, 260, MOUNTAIN.near, MOUNTAIN.nearLight, 5.6);

  // 草坡：三个大圆叠在一起，压在地平线下面
  hill(ctx, 260, 760 + oy, 620, 240);
  hill(ctx, 1180, 742 + oy, 720, 250);
  hill(ctx, 1820, 770 + oy, 520, 230);
  // 坡脚阴影：让草坡和地面之间有一道深色分界
  const shade = ctx.createLinearGradient(0, 700 + oy, 0, GROUND_Y + oy);
  shade.addColorStop(0, 'rgba(70,130,36,0)');
  shade.addColorStop(1, 'rgba(58,110,30,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 700 + oy, CACHE_W, GROUND_Y - 700 + oy);

  // 坡上的小树：位置固定，靠三角函数摆开，避免整齐排队。
  // 注意：树不进离屏缓存，改由 drawWindTrees() 每帧画，这样才有"随风轻摆"。
  // （14 棵树的画笔成本 ≈ 50 个路径操作，实测对帧时间无可测影响）

  cache = cv;
}

/** 世界空间：把缓存的舞台铺满世界宽度（相机拉远时按需横向撑开） */
export function drawBackdrop(ctx: CanvasRenderingContext2D, viewHalfWidth: number): void {
  if (!cache) buildCache();
  if (!cache) return;
  const need = Math.max(1, (viewHalfWidth * 2) / CACHE_W);
  const w = CACHE_W * need;
  ctx.drawImage(cache, (CACHE_W - w) / 2, CACHE_TOP, w, CACHE_H);
}

/** 屏幕空间兜底：世界矩形之外也还是天空色，不会露出别的底色 */
export function drawBackdropScreen(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, SKY.top);
  g.addColorStop(1, SKY.low);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* ---------------- 坡上的小树（随风轻摆） ---------------- */

/**
 * 树的站位：与离屏缓存里原来的公式完全一致（x/baseY/s 全部由序号三角函数算出），
 * 所以从"烘焙进缓存"改成"每帧画"不会改变构图，只是多了摆动的可能。
 */
const TREES: Array<{ x: number; y: number; s: number; phase: number }> = Array.from(
  { length: 14 },
  (_, i) => ({
    x: 90 + i * 142 + Math.sin(i * 2.7) * 46,
    y: 690 + Math.sin(i * 1.9) * 26,
    s: 0.62 + ((i * 7) % 5) * 0.06,
    phase: i * 1.37,
  }),
);

/**
 * 远坡树丛：以树根为轴做 ±1.1° 的极慢摆动（周期 ~6s，各自错相位），
 * 只作用于绘制层，不进入物理。reduce = true 时摆角归零（低动态模式仍然把树画出来）。
 * 成本：14 棵树 ≈ 50 个路径操作 + 14 次 save/rotate/restore。
 */
export function drawWindTrees(ctx: CanvasRenderingContext2D, tSec: number, reduce = false): void {
  for (const tr of TREES) {
    const swing = reduce
      ? 0
      : (Math.sin(tSec * 1.05 + tr.phase) * 0.019 + Math.sin(tSec * 0.43 + tr.phase * 2) * 0.008) *
        70 *
        tr.s;
    tree(ctx, tr.x, tr.y, tr.s, swing);
  }
}

/* ---------------- 云 ---------------- */

const CLOUDS: Array<{ x: number; y: number; s: number; v: number }> = [
  // v 单位是「世界 px / 毫秒」：大云远、慢；小云近、快，形成视差
  { x: 120, y: 40, s: 1.2, v: 0.05 },
  { x: 700, y: -20, s: 0.9, v: 0.038 },
  { x: 1160, y: 110, s: 1.35, v: 0.058 },
  { x: 1620, y: 30, s: 1.0, v: 0.034 },
  { x: 1960, y: 190, s: 1.15, v: 0.048 },
  { x: 420, y: 250, s: 0.75, v: 0.075 },
  { x: 1400, y: 300, s: 0.65, v: 0.066 },
];

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const blobs: Array<[number, number, number]> = [
    [0, 0, 46],
    [-42, 10, 32],
    [44, 12, 34],
    [-16, -20, 34],
    [24, -14, 28],
    [-58, 22, 22],
    [62, 24, 22],
  ];
  // 底部一点冷色，云才有厚度；再叠一层纯白
  ctx.fillStyle = '#cfe9f8';
  blobs.forEach(([bx, by, br]) => {
    ctx.beginPath();
    ctx.arc(x + bx * s, y + (by + 8) * s, br * s, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  blobs.forEach(([bx, by, br]) => {
    ctx.beginPath();
    ctx.arc(x + bx * s, y + by * s, br * s, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** 云：一直往右飘，飘出世界右侧就从左侧重新进场，另加一点轻微上下浮动 */
export function drawClouds(ctx: CanvasRenderingContext2D, t: number): void {
  const span = WORLD_WIDTH + 800;
  CLOUDS.forEach((c, i) => {
    const x = (((c.x + t * c.v) % span) + span) % span - 400;
    const y = c.y + Math.sin(t * 0.00035 + i * 1.7) * 7;
    cloud(ctx, x, y, c.s);
  });
}
