import type { BirdType, Material, PigType } from './types';
import { CRACK_HEAVY, CRACK_HIT, MATERIALS, type MaterialProfile } from './materials';
import {
  BIRD_SHEETS,
  CANNON,
  TREBUCHET,
  getBirdSprite,
  getCannonSprite,
  getPigSprite,
  getTrebuchetSprite,
  PIG_SHEETS,
  type LauncherSheet,
  type SpriteAnimFrame,
  type SpriteSheetSpec,
} from './sprite';

export const OUTLINE = '#2b2b2b';

/**
 * 障碍物材质取自资产表的四套道具：
 * 橙木箱（Wood）、浅岩石（Stone）、冰玻璃（Glass）、铁皮笼（Metal）。
 * 每种材质都是"深描边 + 内圈亮边 + 平涂 + 细节线"的卡通画法，缩放到任意尺寸都清晰。
 * 配色与耐久统一放在 `materials.ts`，绘制只读不另存一份。
 */
const palOf = (mat: Material): MaterialProfile['palette'] => MATERIALS[mat].palette;

/**
 * 轻伤痕迹的门槛：比 CRACK_HIT 低得多。
 * 玻璃一碰就该"发白"、铁皮一碰就该有划痕与凹陷，木/石的裂要等真受伤才出现。
 */
const MAT_SCAR = 0.05;

const EGG = '#fdf6e3';
const EGG_SPOT = '#e2d2a8';

/** TNT 炸药箱 */
const TNT = { wood: '#c8823c', woodDark: '#8e5522', label: '#f6f2e6', ink: '#c22218' };

/** 碎块：多边形碎片，带自转与生命值，落地会弹一下 */
export interface ShardFx {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  hw: number;
  hh: number;
  /** 四角相对中心点的抖动偏移，长度 8（x0,y0,x1,y1,... 顺时针） */
  pts: number[];
  mat: Material;
  /** 重力/阻力/落地弹跳按材质给，缺省是旧的统一手感（木屑飘、石块沉、玻璃脆、铁皮闷） */
  grav?: number;
  drag?: number;
  bounce?: number;
  life: number;
  ttl: number;
}

/** 尘土 / 烟：破裂与爆炸都会腾起的团块，快速膨胀后淡出 */
export interface PuffFx {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  grow: number;
  life: number;
  ttl: number;
  mat: Material;
  /** 爆炸烟是深灰的，破块尘是材质色 */
  smoke?: boolean;
}

/** 闪裂：方块消失那一瞬的白色剪影，给"啪"的反馈 */
export interface FlashFx {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  life: number;
  ttl: number;
}

/** 爆炸火球：橙黄核心 + 放射火星 */
export interface BlastFx {
  x: number;
  y: number;
  r: number;
  max: number;
  life: number;
  ttl: number;
  seed: number;
}

/**
 * 撞击火花：命中瞬间从接触点甩出去的短线，寿命不到 200ms。
 * 羽毛（受击小鸟掉的）复用同一个类型，只是更长更慢、颜色固定为暖白。
 */
export interface SparkFx {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 线的长度（px） */
  len: number;
  rot: number;
  mat: Material;
  life: number;
  ttl: number;
  feather?: boolean;
}

/** 世界内飘字：连锁层数、抢到鸟蛋之类的即时提示，边升边淡出 */
export interface FloatTextFx {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
  ttl: number;
}

/** 冲击波：一圈快速扩散的白环 */
export interface RingFx {
  x: number;
  y: number;
  r: number;
  max: number;
  life: number;
  ttl: number;
}

export interface Cam {
  x: number;
  y: number;
  scale: number;
}

function rr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/* ---------------- 地面 ---------------- */

const GRASS = { top: '#b6ea83', face: '#8ed254', deep: '#5da532', shadow: '#37701d' };
const DIRT = { top: '#d59a58', face: '#c08343', deep: '#8a5c2c', dark: '#6b4520' };

/**
 * 世界空间地面：一条亮绿草皮压着泥土剖面。
 * 卡通风格的草地必须有"深描边 + 亮顶边"，否则和天空糊在一起看不出落点。
 */
/**
 * 地形：草皮 + 土层 + 草簇。
 * sway 是世界时间（秒）：让草簇叶尖按各自相位轻摆，同一套笔触、零额外绘制成本。
 */
export function drawTerrain(ctx: CanvasRenderingContext2D, groundY: number, sway = 0): void {
  const span = 900;
  const x0 = -span;
  const w = 2000 + span * 2;
  const grassH = 26;
  const bottom = groundY + 420;

  // 泥土
  const soil = ctx.createLinearGradient(0, groundY + grassH, 0, bottom);
  soil.addColorStop(0, DIRT.top);
  soil.addColorStop(0.24, DIRT.face);
  soil.addColorStop(0.62, DIRT.deep);
  soil.addColorStop(1, DIRT.dark);
  ctx.fillStyle = soil;
  ctx.fillRect(x0, groundY + grassH - 2, w, bottom - groundY - grassH + 2);

  // 草皮
  const turf = ctx.createLinearGradient(0, groundY - 4, 0, groundY + grassH);
  turf.addColorStop(0, GRASS.top);
  turf.addColorStop(0.5, GRASS.face);
  turf.addColorStop(1, GRASS.deep);
  ctx.fillStyle = turf;
  ctx.fillRect(x0, groundY - 4, w, grassH + 4);

  // 草皮顶边的深描边：整条地平线的"轮廓线"
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(x0, groundY - 6, w, 4);

  // 泥土里的层理与碎石
  for (let i = 0; i < 40; i += 1) {
    const sx = x0 + ((i * 173) % w);
    const sy = groundY + 62 + ((i * 67) % 250);
    ctx.fillStyle = i % 3 === 0 ? 'rgba(107,69,32,0.32)' : 'rgba(214,158,96,0.18)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 30 + (i % 5) * 9, 5 + (i % 3) * 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 34; i += 1) {
    const sx = x0 + ((i * 211) % w);
    const sy = groundY + 54 + ((i * 47) % 260);
    ctx.fillStyle = 'rgba(184,176,162,0.55)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 9 + (i % 4) * 3, 6 + (i % 3) * 2, (i % 5) * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,84,72,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 草皮上的草簇：三片叶子一撮，短而硬；叶尖按相位随风轻摆（sway=0 时完全静止）
  for (let i = 0; i < 150; i += 1) {
    const x = x0 + i * 22 + ((i * 37) % 11);
    const len = 9 + ((i * 13) % 12);
    const bend = sway ? Math.sin(sway * 1.7 + i * 0.55) * (1.4 + len * 0.08) : 0;
    ctx.strokeStyle = i % 3 === 0 ? GRASS.top : GRASS.deep;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, groundY - 4);
    ctx.quadraticCurveTo(x - 3, groundY - len * 0.7, x - 6 + bend, groundY - len);
    ctx.moveTo(x, groundY - 4);
    ctx.quadraticCurveTo(x + 1, groundY - len * 0.8, x + bend * 0.7, groundY - len - 3);
    ctx.moveTo(x, groundY - 4);
    ctx.quadraticCurveTo(x + 4, groundY - len * 0.7, x + 7 + bend * 0.9, groundY - len * 0.9);
    ctx.stroke();
  }
}

/* ---------------- 方块 ---------------- */

/**
 * 画一个障碍物。`tnt` 为真时画成炸药箱（材质固定按木头处理）。
 * 所有材质统一：投影 → 底色 + 描边 → 裁剪内画细节 → 内圈亮边。
 */
export function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  angle: number,
  mat: Material,
  alpha = 1,
  tnt = false,
  /** 损伤进度 0~1：≥CRACK_HIT 出细裂，≥CRACK_HEAVY 裂纹加粗并压暗 */
  dmg = 0,
  /** 裂纹随机种子（取方块 id），保证同一块的裂纹不逐帧抖动 */
  seed = 1,
  /** 炸药箱引信进度 0~1（0 = 没点着，接近 1 = 马上炸） */
  fuse = 0,
  /** 动画时钟（毫秒），引信火星与闪白用它 */
  now = 0,
  /** 最近一次有效撞击的落点（方块局部坐标）：木裂顺纹从这里走、石裂从这里放射、铁皮从这里凹 */
  hit?: { x: number; y: number },
): void {
  const pal = palOf(mat);
  const radius = mat === 'stone' ? 10 : mat === 'glass' ? 8 : 7;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);

  // 投影
  ctx.fillStyle = 'rgba(58,92,38,0.22)';
  rr(ctx, -w / 2 + 4, -h / 2 + 6, w, h, radius);
  ctx.fill();

  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;

  if (tnt) {
    drawTntCrate(ctx, w, h, radius, fuse, now);
    ctx.restore();
    return;
  }

  // 底色
  if (mat === 'glass') {
    ctx.fillStyle = pal.face;
    ctx.globalAlpha = alpha * 0.82;
    rr(ctx, -w / 2, -h / 2, w, h, radius);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.stroke();
  } else {
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, pal.light);
    g.addColorStop(0.45, pal.face);
    g.addColorStop(1, pal.dark);
    ctx.fillStyle = g;
    rr(ctx, -w / 2, -h / 2, w, h, radius);
    ctx.fill();
    ctx.stroke();
  }

  ctx.save();
  rr(ctx, -w / 2, -h / 2, w, h, radius);
  ctx.clip();
  const vertical = h >= w;
  const long = vertical ? h : w;
  const short = vertical ? w : h;

  if (mat === 'wood') {
    // 木板缝：顺着短边分段，每段一道深缝 + 一道亮边
    const step = 34;
    ctx.lineWidth = 2;
    for (let d = step; d < long - 8; d += step) {
      const t = d - long / 2;
      ctx.strokeStyle = 'rgba(122,64,18,0.75)';
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(-w / 2, t);
        ctx.lineTo(w / 2, t);
      } else {
        ctx.moveTo(t, -h / 2);
        ctx.lineTo(t, h / 2);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,226,180,0.5)';
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(-w / 2, t + 3);
        ctx.lineTo(w / 2, t + 3);
      } else {
        ctx.moveTo(t + 3, -h / 2);
        ctx.lineTo(t + 3, h / 2);
      }
      ctx.stroke();
    }
    // 木纹：两条顺着长边的波浪线
    ctx.strokeStyle = 'rgba(140,74,22,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i += 1) {
      const off = (i === 0 ? -1 : 1) * short * 0.2;
      ctx.beginPath();
      for (let s = 0; s <= long; s += 12) {
        const p = s - long / 2;
        const wob = Math.sin(s * 0.09 + i * 2.1) * short * 0.06;
        if (vertical) {
          if (s === 0) ctx.moveTo(off + wob, -h / 2 + 2);
          else ctx.lineTo(off + wob, p);
        } else if (s === 0) ctx.moveTo(-w / 2 + 2, off + wob);
        else ctx.lineTo(p, off + wob);
      }
      ctx.stroke();
    }
    // 两端钉子
    if (long > 90) {
      ctx.fillStyle = 'rgba(90,58,24,0.55)';
      const n = Math.min(3, Math.floor(long / 70));
      for (let i = 0; i < n; i += 1) {
        const t = (i + 0.5) / n;
        const p = (t - 0.5) * long * 0.86;
        const q = short * 0.26;
        [
          [p, q],
          [p, -q],
        ].forEach(([a, b]) => {
          ctx.beginPath();
          if (vertical) ctx.arc(b, a, 2.4, 0, Math.PI * 2);
          else ctx.arc(a, b, 2.4, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }
  } else if (mat === 'stone') {
    // 石面：大色块 + 裂缝 + 麻点
    ctx.fillStyle = 'rgba(134,130,120,0.35)';
    ctx.beginPath();
    ctx.arc(w * 0.16, h * 0.2, Math.min(w, h) * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,76,68,0.7)';
    ctx.lineWidth = 2;
    const crackCount = long > 110 ? 3 : 2;
    for (let i = 0; i < crackCount; i += 1) {
      const base = ((i + 1) / (crackCount + 1) - 0.5) * long * 0.8;
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(-short * 0.3, base);
        ctx.lineTo(short * 0.05, base + 12);
        ctx.lineTo(-short * 0.12, base + 24);
        ctx.lineTo(short * 0.28, base + 38);
      } else if (long > short) {
        ctx.moveTo(base, -short * 0.32);
        ctx.lineTo(base + 12, short * 0.04);
        ctx.lineTo(base + 26, -short * 0.14);
        ctx.lineTo(base + 40, short * 0.3);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(120,116,106,0.5)';
    for (let i = 0; i < 9; i += 1) {
      const px = (((i * 71) % 100) / 100 - 0.5) * (w - 12);
      const py = (((i * 37) % 100) / 100 - 0.5) * (h - 12);
      ctx.beginPath();
      ctx.arc(px, py, 1.6 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (mat === 'glass') {
    // 冰玻璃：白色裂纹 + 斜向高光条
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    for (let i = 0; i < 2; i += 1) {
      const cy = (i === 0 ? -0.22 : 0.24) * h;
      ctx.beginPath();
      ctx.moveTo(-w * 0.46, cy);
      ctx.lineTo(-w * 0.16, cy - h * 0.16);
      ctx.lineTo(w * 0.02, cy + h * 0.04);
      ctx.lineTo(w * 0.28, cy - h * 0.18);
      ctx.lineTo(w * 0.46, cy + h * 0.1);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, -h * 0.1);
    ctx.lineTo(-w * 0.16, -h * 0.5);
    ctx.lineTo(w * 0.04, -h * 0.5);
    ctx.lineTo(-w * 0.34, -h * 0.04);
    ctx.closePath();
    ctx.fill();
  } else {
    // 铁皮：斜向拉丝 + 铆钉
    ctx.globalAlpha = alpha * 0.28;
    ctx.fillStyle = '#ffffff';
    for (let i = -2; i < 6; i += 1) {
      ctx.beginPath();
      const t = i * 26;
      ctx.moveTo(t - w * 0.1, h / 2);
      ctx.lineTo(t + w * 0.16, -h / 2);
      ctx.lineTo(t + w * 0.28, -h / 2);
      ctx.lineTo(t + w * 0.02, h / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pal.dark;
    const inset = 9;
    [
      [-w / 2 + inset, -h / 2 + inset],
      [w / 2 - inset, -h / 2 + inset],
      [-w / 2 + inset, h / 2 - inset],
      [w / 2 - inset, h / 2 - inset],
    ].forEach(([px, py]) => {
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // 损伤：先压暗（重伤才明显），再画材质专属的损伤纹理——裂纹始终在块面之内，看起来是"这块要碎了"
  if (dmg >= CRACK_HIT) {
    const k = Math.min(1, (dmg - CRACK_HIT) / (1 - CRACK_HIT));
    ctx.globalAlpha = alpha * (0.06 + k * 0.26);
    ctx.fillStyle = mat === 'glass' ? '#27505c' : mat === 'stone' ? '#4b4740' : '#4a2c14';
    rr(ctx, -w / 2, -h / 2, w, h, radius);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  // 玻璃与铁皮轻碰就该留下痕迹：玻璃是细裂、铁皮是划痕/凹陷，都比木石的"裂开"更早出现
  if (dmg >= MAT_SCAR) drawDamage(ctx, w, h, dmg, seed, mat, hit);
  ctx.restore();

  // 内圈亮边：卡通道具的"厚板"感全靠这一圈
  ctx.globalAlpha = alpha * (mat === 'glass' ? 0.75 : 0.55);
  ctx.strokeStyle = mat === 'stone' ? 'rgba(255,255,255,0.75)' : pal.light;
  ctx.lineWidth = 2;
  rr(ctx, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, Math.max(2, radius - 3));
  ctx.stroke();
  ctx.restore();
}

/** 线性同余伪随机：同一种子每次画出完全一样的裂纹，不会逐帧抖 */
function seeded(seed: number): () => number {
  let s = (seed || 1) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 损伤纹理：四种材质各说自己的语言。
 * - 木头：顺着木纹的细裂缝 + 受击处的木纤维崩口，越重越长、越往块里走；
 * - 石头：从撞击点向四周放射的折线裂缝，末端分叉，重伤再崩掉一块边；
 * - 玻璃：撞击点的放射蛛网 + 同心圆裂纹，细而亮；
 * - 铁皮：不裂，先划痕、再凹陷（暗面 + 亮边），重伤才在折痕处长一道细裂。
 * 撞击点来自引擎（`blockDamage.hx/hy`），所以裂纹真的长在被打的地方。
 */
function drawDamage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dmg: number,
  seed: number,
  mat: Material,
  hit?: { x: number; y: number },
): void {
  const heavy = dmg >= CRACK_HEAVY;
  const k = Math.max(0, Math.min(1, (dmg - MAT_SCAR) / (1 - MAT_SCAR)));
  const rnd = seeded(seed * 7919 + 13);
  const hx = hit ? hit.x : (rnd() - 0.5) * w * 0.4;
  const hy = hit ? hit.y : (rnd() - 0.5) * h * 0.4;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (mat === 'wood') {
    const vertical = h > w;
    const grain = vertical ? Math.PI / 2 : 0;
    const count = heavy ? 4 : dmg >= CRACK_HIT ? 2 : 1;
    ctx.strokeStyle = 'rgba(58,30,8,0.82)';
    ctx.lineWidth = heavy ? 2.6 : 1.7;
    for (let i = 0; i < count; i += 1) {
      // 从受击点出发，主要沿木纹方向走（木头的裂是"顺着纤维撕开"的）
      let x = hx + (rnd() - 0.5) * w * 0.16;
      let y = hy + (rnd() - 0.5) * h * 0.16;
      let dir = grain + (rnd() - 0.5) * 0.5 * (i === 0 ? 0.6 : 2.2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(rnd() * 3);
      for (let s = 0; s < segs; s += 1) {
        const len = Math.min(w, h) * (0.2 + rnd() * 0.3) + 6;
        dir += (rnd() - 0.5) * 0.36;
        x += Math.cos(dir) * len * (0.6 + k * 0.7);
        y += Math.sin(dir) * len * (0.6 + k * 0.7);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      // 木屑纤维：主裂旁边几根短刺，越重越多
      if (i === 0) {
        ctx.lineWidth = 1.1;
        const ticks = heavy ? 4 : 2;
        for (let t = 0; t < ticks; t += 1) {
          const a = grain + (rnd() > 0.5 ? 1 : -1) * (0.9 + rnd() * 0.5);
          const bx = hx + (rnd() - 0.5) * w * 0.3;
          const by = hy + (rnd() - 0.5) * h * 0.3;
          const l = 5 + rnd() * 9;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(a) * l, by + Math.sin(a) * l);
          ctx.stroke();
        }
        ctx.lineWidth = heavy ? 2.6 : 1.7;
      }
    }
    // 重伤：受击侧崩掉一层木纤维（浅色豁口）
    if (heavy) {
      ctx.fillStyle = 'rgba(246,214,164,0.55)';
      const nw = Math.min(w, h) * 0.22;
      ctx.beginPath();
      ctx.moveTo(hx - nw, hy - nw * 0.25);
      ctx.lineTo(hx + nw * 0.4, hy - nw * 0.5);
      ctx.lineTo(hx + nw * 0.2, hy + nw * 0.6);
      ctx.lineTo(hx - nw * 0.8, hy + nw * 0.2);
      ctx.closePath();
      ctx.fill();
    }
  } else if (mat === 'stone') {
    // 放射裂纹：从撞击点向四周折出去，末端分叉
    const rays = heavy ? 5 : dmg >= CRACK_HIT ? 3 : 2;
    ctx.strokeStyle = 'rgba(52,48,42,0.85)';
    for (let i = 0; i < rays; i += 1) {
      const spread = (i / rays) * Math.PI * 2 + rnd() * 0.8;
      let x = hx;
      let y = hy;
      let dir = spread;
      ctx.lineWidth = heavy ? 3.2 : 2.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(rnd() * 2);
      for (let s = 0; s < segs; s += 1) {
        const len = Math.min(w, h) * (0.16 + rnd() * 0.22) + 7;
        x += Math.cos(dir) * len;
        y += Math.sin(dir) * len;
        ctx.lineTo(x, y);
        dir += (rnd() - 0.5) * 1.5;
        if (rnd() > 0.55) {
          // 分叉：一根短岔口
          ctx.moveTo(x, y);
          const bl = 5 + rnd() * 10;
          ctx.lineTo(x + Math.cos(dir + 1.1) * bl, y + Math.sin(dir + 1.1) * bl);
          ctx.moveTo(x, y);
        }
      }
      ctx.stroke();
    }
    // 撞击点：一小块被打白的坑
    ctx.fillStyle = 'rgba(226,220,206,0.75)';
    ctx.beginPath();
    ctx.arc(hx, hy, Math.min(w, h) * (0.05 + k * 0.05), 0, Math.PI * 2);
    ctx.fill();
    // 重伤：边上崩掉一块（缺角）
    if (heavy) {
      ctx.fillStyle = 'rgba(72,68,60,0.5)';
      const nw = Math.min(w, h) * 0.2;
      ctx.beginPath();
      ctx.moveTo(hx + nw * 0.6, hy - nw * 0.9);
      ctx.lineTo(hx + nw * 1.4, hy - nw * 0.1);
      ctx.lineTo(hx + nw * 0.5, hy + nw * 0.8);
      ctx.closePath();
      ctx.fill();
    }
  } else if (mat === 'glass') {
    // 蛛网：从撞击点放射的细亮线 + 一两圈同心圆
    const rays = heavy ? 9 : dmg >= CRACK_HIT ? 6 : 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = heavy ? 2 : 1.4;
    const reach = Math.min(w, h) * 0.62;
    for (let i = 0; i < rays; i += 1) {
      const a = (i / rays) * Math.PI * 2 + rnd() * 0.3;
      const l = reach * (0.55 + rnd() * 0.6) * (0.7 + k * 0.5);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + Math.cos(a) * l * 0.55, hy + Math.sin(a) * l * 0.55);
      ctx.lineTo(hx + Math.cos(a + 0.12) * l, hy + Math.sin(a + 0.12) * l);
      ctx.stroke();
    }
    const rings = heavy ? 2 : 1;
    for (let i = 0; i < rings; i += 1) {
      const r = Math.min(w, h) * (0.16 + i * 0.16) * (0.8 + k * 0.7);
      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 撞击点的高光：玻璃挨打是"发白"的
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(hx, hy, 2 + k * 3.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 铁皮：划痕 → 凹陷（暗心 + 亮边），重伤才在凹处挂一道细裂
    const dents = heavy ? 2 : 1;
    for (let i = 0; i < dents; i += 1) {
      const cx = hx + (rnd() - 0.5) * w * 0.24;
      const cy = hy + (rnd() - 0.5) * h * 0.24;
      const rr2 = Math.min(w, h) * (0.12 + k * 0.16) + 4;
      const g = ctx.createRadialGradient(cx, cy, rr2 * 0.2, cx, cy, rr2);
      g.addColorStop(0, 'rgba(26,32,38,0.42)');
      g.addColorStop(0.7, 'rgba(26,32,38,0.16)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, rr2, 0, Math.PI * 2);
      ctx.fill();
      // 凹陷下缘的亮边（被压下去的地方反光更强）
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy + rr2 * 0.18, rr2 * 0.78, 0.35, Math.PI - 0.35);
      ctx.stroke();
      // 划痕
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.2;
      for (let s = 0; s < 2; s += 1) {
        const a = -0.5 + rnd() * 1.0;
        const l = rr2 * (0.7 + rnd() * 0.7);
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * l, cy - Math.sin(a) * l);
        ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
        ctx.stroke();
      }
    }
    if (heavy) {
      ctx.strokeStyle = 'rgba(40,36,32,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      let x = hx - Math.min(w, h) * 0.18;
      let y = hy;
      ctx.moveTo(x, y);
      let dir = (rnd() - 0.5) * 0.9;
      for (let s = 0; s < 3; s += 1) {
        const len = Math.min(w, h) * (0.14 + rnd() * 0.16);
        dir += (rnd() - 0.5) * 0.9;
        x += Math.cos(dir) * len;
        y += Math.sin(dir) * len;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** 炸药箱：木条箱 + 白底红字 TNT 标签 */
function drawTntCrate(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  radius: number,
  fuse = 0,
  now = 0,
): void {
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, '#e09a52');
  g.addColorStop(0.5, TNT.wood);
  g.addColorStop(1, TNT.woodDark);
  ctx.fillStyle = g;
  rr(ctx, -w / 2, -h / 2, w, h, radius);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  rr(ctx, -w / 2, -h / 2, w, h, radius);
  ctx.clip();
  // 竖木条
  ctx.strokeStyle = 'rgba(110,62,20,0.65)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i += 1) {
    const px = -w / 2 + (w * i) / 4;
    ctx.beginPath();
    ctx.moveTo(px, -h / 2);
    ctx.lineTo(px, h / 2);
    ctx.stroke();
  }
  // 上下横梁
  ctx.fillStyle = 'rgba(96,52,16,0.35)';
  ctx.fillRect(-w / 2, -h / 2, w, h * 0.16);
  ctx.fillRect(-w / 2, h / 2 - h * 0.16, w, h * 0.16);
  // 标签
  const lw = w * 0.72;
  const lh = h * 0.4;
  ctx.save();
  ctx.rotate(-0.06);
  ctx.fillStyle = TNT.label;
  rr(ctx, -lw / 2, -lh / 2, lw, lh, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,50,16,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = TNT.ink;
  ctx.font = `900 ${Math.max(10, lh * 0.72)}px "Noto Sans SC", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TNT', 0, lh * 0.04);
  ctx.restore();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,224,180,0.6)';
  ctx.lineWidth = 2;
  rr(ctx, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, Math.max(2, radius - 3));
  ctx.stroke();

  // 引信：从箱顶右上角伸出一截，末端常亮一颗火星（点着后火星变大、整箱闪白）
  const lit = fuse > 0;
  const px = w * 0.28;
  const py = -h / 2;
  const fw = Math.min(16, w * 0.16);
  const fh = Math.min(22, h * 0.22);
  ctx.strokeStyle = '#5a3a1c';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.quadraticCurveTo(px + fw * 0.7, py - fh * 0.35, px + fw * 0.25, py - fh);
  ctx.stroke();
  ctx.lineCap = 'butt';

  const pulse = 0.6 + 0.4 * Math.sin(now * (lit ? 0.05 : 0.011) + px);
  const r = (lit ? 4.6 + 3.4 * fuse : 2.2) * (0.85 + pulse * 0.3);
  const gx = px + fw * 0.25;
  const gy = py - fh;
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, r * 2.6);
  glow.addColorStop(0, 'rgba(255,255,236,0.95)');
  glow.addColorStop(0.42, 'rgba(255,206,84,0.8)');
  glow.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(gx, gy, r * 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = lit ? '#fffdf0' : '#ffd76a';
  ctx.beginPath();
  ctx.arc(gx, gy, r, 0, Math.PI * 2);
  ctx.fill();

  if (lit) {
    // 闪白：越接近爆炸，频率越高、罩得越白，给玩家"要炸了"的明确预警
    const flash = 0.18 + 0.5 * fuse;
    const blink = 0.5 + 0.5 * Math.sin(now * (0.05 + fuse * 0.08));
    ctx.save();
    rr(ctx, -w / 2, -h / 2, w, h, radius);
    ctx.clip();
    ctx.globalAlpha = flash * blink;
    ctx.fillStyle = '#fffdf2';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

/**
 * 弹簧板机关：木质踏板 + 深色底板 + 中间一根钢制蛇形弹簧。
 * `press` 0~1 表示被压下去的进度（0 = 待机，1 = 压到底），
 * 板面会被压向底板、弹簧随之压缩，配金色箭头指明"会把人往哪弹"。
 */
export function drawSpring(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  angle: number,
  press: number,
  now: number,
  groundY?: number,
): void {
  const p = Math.max(0, Math.min(1, press));
  const travel = h * 0.5 * p;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // 架在立柱上的弹射台：从板座下沿接到地面，让"悬空的板子"看起来有支点
  // 注意 legTop 是局部坐标（相对板心），所以地面高度要先换算到局部系
  const legTop = h / 2 + 8 + Math.max(9, h * 0.3);
  const localGround = groundY === undefined ? undefined : groundY - y;
  if (localGround !== undefined && localGround > legTop + 8) {
    const legW = Math.max(9, w * 0.09);
    const drop = localGround - legTop;
    ctx.fillStyle = '#8a5c2c';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    [-1, 1].forEach((s) => {
      const lx = s * (w * 0.32);
      rr(ctx, lx - legW / 2, legTop, legW, drop, 4);
      ctx.fill();
      ctx.stroke();
    });
    // 斜撑：两根细木条交叉，避免看起来像"插在空中的桌腿"
    ctx.strokeStyle = '#a86b31';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-w * 0.32, legTop + drop * 0.18);
    ctx.lineTo(w * 0.32, legTop + drop * 0.72);
    ctx.moveTo(w * 0.32, legTop + drop * 0.18);
    ctx.lineTo(-w * 0.32, legTop + drop * 0.72);
    ctx.stroke();
  }

  // 地基阴影
  ctx.fillStyle = 'rgba(58,92,38,0.22)';
  rr(ctx, -w / 2 + 3, h / 2 + 2, w, 10, 5);
  ctx.fill();

  // 底板（深色石座）
  const baseTop = h / 2 + 8;
  const baseH = Math.max(9, h * 0.3);
  const bg = ctx.createLinearGradient(0, baseTop, 0, baseTop + baseH);
  bg.addColorStop(0, '#9a7040');
  bg.addColorStop(0.5, '#7a5227');
  bg.addColorStop(1, '#553617');
  ctx.fillStyle = bg;
  ctx.beginPath();
  rr(ctx, -w / 2, baseTop, w, baseH, 5);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // 蛇形弹簧：三条折线，随 press 压缩
  const coilTop = h / 2 + travel;
  const coilBot = baseTop;
  const coilH = Math.max(4, coilBot - coilTop);
  const coils = 3;
  const half = (w * 0.34) / 2;
  ctx.strokeStyle = '#c8d2d8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i <= coils * 2; i += 1) {
    const t = i / (coils * 2);
    const cxp = i % 2 === 0 ? -half : half;
    const cyp = coilTop + coilH * t;
    if (i === 0) ctx.moveTo(cxp, cyp);
    else ctx.lineTo(cxp, cyp);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 踏板：木板 + 奶油内环 + 金色向上箭头
  const boardTop = -h / 2 + travel;
  const wg = ctx.createLinearGradient(0, boardTop, 0, boardTop + h);
  wg.addColorStop(0, '#f8c982');
  wg.addColorStop(0.5, '#e08838');
  wg.addColorStop(1, '#a85c1c');
  ctx.fillStyle = wg;
  rr(ctx, -w / 2, boardTop, w, h, 6);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  ctx.save();
  rr(ctx, -w / 2, boardTop, w, h, 6);
  ctx.clip();
  // 两侧木纹
  ctx.strokeStyle = 'rgba(140,74,22,0.45)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i += 1) {
    const px = -w / 2 + (w * i) / 4;
    ctx.beginPath();
    ctx.moveTo(px, boardTop);
    ctx.lineTo(px, boardTop + h);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,232,190,0.7)';
  ctx.lineWidth = 2;
  rr(ctx, -w / 2 + 4, boardTop + 4, w - 8, Math.max(3, h - 8), 4);
  ctx.stroke();

  // 金色箭头：往法线方向弹
  const glow = 0.55 + 0.45 * Math.sin(now * 0.006) + p * 0.4;
  ctx.globalAlpha = Math.min(1, 0.65 + glow * 0.3);
  ctx.fillStyle = '#ffcf3f';
  ctx.strokeStyle = '#7a3f04';
  ctx.lineWidth = 2;
  const aw = Math.min(w * 0.5, 46);
  const ah = Math.min(h * 0.5, 13);
  const ay = boardTop + h * 0.5;
  ctx.beginPath();
  ctx.moveTo(-aw / 2, ay + ah * 0.5);
  ctx.lineTo(0, ay - ah * 0.5);
  ctx.lineTo(aw / 2, ay + ah * 0.5);
  ctx.lineTo(0, ay);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();
}

/** 散落的木车轮：撞到会滚，纯装饰刚体 */
export function drawWheel(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(58,92,38,0.2)';
  ctx.beginPath();
  ctx.ellipse(3, r * 0.86, r * 0.94, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = '#c98a4a';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(120,64,18,0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 辐条
  ctx.strokeStyle = '#a8672c';
  ctx.lineWidth = Math.max(2, r * 0.13);
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI * 2 * i) / 6;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.18, Math.sin(a) * r * 0.18);
    ctx.lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
    ctx.stroke();
  }
  // 轮毂
  ctx.fillStyle = '#e6a355';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

/* ---------------- 蛋 / 发射器 / 角色 ---------------- */

/**
 * 鸟蛋。`pick` 是"被抢到"的动画进度（0~1）：
 * 鼓一下、左右晃两下、慢慢浮起来，同时光晕迅速放大变亮，配合一圈白环就是"到手了"的高光时刻。
 */
export function drawEgg(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  t: number,
  pick = 0,
): void {
  const p = Math.max(0, Math.min(1, pick));
  const bump = Math.sin(p * Math.PI) * 0.34;
  const lift = p * 30;
  ctx.save();
  ctx.translate(x, y - lift);
  const bob = Math.sin(t * 0.003) * 1.8 * (1 - p);
  ctx.translate(0, bob);
  if (p > 0) {
    ctx.rotate(Math.sin(p * Math.PI * 3) * 0.2);
    const s = 1 + bump - p * 0.18;
    ctx.scale(s, s);
  }
  // 一点暖光，让蛋在蓝天绿草里始终是最亮的焦点
  const haloRr = r * (2.6 + p * 2.4);
  const halo = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, haloRr);
  halo.addColorStop(0, `rgba(255,246,200,${0.55 + p * 0.4})`);
  halo.addColorStop(1, 'rgba(255,246,200,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, haloRr, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, EGG);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.82, r * 1.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = EGG_SPOT;
  const spots: Array<[number, number, number]> = [
    [-0.22, -0.3, 0.16],
    [0.26, -0.06, 0.13],
    [-0.1, 0.38, 0.12],
    [0.2, 0.5, 0.09],
  ];
  spots.forEach(([sx, sy, sr]) => {
    ctx.beginPath();
    ctx.arc(sx * r, sy * r, sr * r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.5, r * 0.16, r * 0.28, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * 把发射器图集的一帧贴到世界发射点上：帧内的 anchor（炮口/抛兜）落在 (x, y)。
 * 两张发射器图共用这一条路径，差别只在 LauncherSheet 的标定数值。
 */
function blitLauncher(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLImageElement,
  sheet: LauncherSheet,
  frame: number,
  x: number,
  y: number,
  offsetX = 0,
  offsetY = 0,
): void {
  const k = sheet.scale;
  const idx = Math.min(sheet.frames - 1, Math.max(0, frame));
  ctx.save();
  ctx.translate(x + offsetX, y + offsetY);
  if (sheet.flipX) {
    ctx.scale(-1, 1);
  }
  const destX = -sheet.anchorX * k;
  ctx.drawImage(
    sprite,
    idx * sheet.frameW,
    0,
    sheet.frameW,
    sheet.frameH,
    destX,
    -sheet.anchorY * k,
    sheet.frameW * k,
    sheet.frameH * k,
  );
  ctx.restore();
}

/**
 * 大炮发射器：木甲板 + 两根冰玻璃立柱的炮台 + 炮身贴图。
 * 坐标约定：x / y 就是世界里的发射点，也就是**炮口中心**。
 */
export function drawCannon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  groundY: number,
  fireFrame: number | null,
): void {
  const k = CANNON.scale;
  const deckTop = y + (CANNON.bottomY - CANNON.anchorY) * k;
  const deckH = 32;
  const postH = Math.max(24, groundY - deckTop - deckH);
  drawBlock(ctx, x, deckTop + deckH / 2, 300, deckH, 0, 'wood');
  drawBlock(ctx, x - 104, deckTop + deckH + postH / 2, 40, postH, 0, 'glass');
  drawBlock(ctx, x + 104, deckTop + deckH + postH / 2, 40, postH, 0, 'glass');

  const sprite = getCannonSprite();
  if (!sprite) return;
  const frame = fireFrame ?? 0;
  const kick = frame === 3 ? 7 : 0;
  blitLauncher(ctx, sprite, CANNON, frame, x, y, -kick * 0.82, kick * 0.58);
}

/**
 * 弹弓发射器：一根木立柱分出两根叉臂，皮筋从叉口拉回皮兜。
 * x / y 是发射点，也就是**皮兜中心**；发射点始终在叉口左侧（猪被拉在叉后），
 * 撒放时皮兜沿行程弹到叉口中间，皮筋由粗变细、由打直变松弛。
 * `fireT` <0 表示还没发射，0~1 是撒放进度。
 */
export function drawSling(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  groundY: number,
  fireT: number,
): void {
  const pal = palOf('wood');
  const forkX = x + 96;
  const junctionY = groundY - 112;
  const leftTip = { x: forkX - 56, y: groundY - 218 };
  const rightTip = { x: forkX + 48, y: groundY - 196 };

  const t = fireT < 0 ? 0 : Math.min(1, fireT);
  const ease = 1 - Math.pow(1 - t, 3);
  const restPouch = { x: forkX - 4, y: (leftTip.y + rightTip.y) / 2 + 6 };
  const pouch = {
    x: x + (restPouch.x - x) * ease,
    y: y + (restPouch.y - y) * ease,
  };

  const post = (x1: number, y1: number, x2: number, y2: number, width: number): void => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = width + 6;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = pal.face;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = Math.max(2, width * 0.32);
    ctx.beginPath();
    ctx.moveTo(x1 - width * 0.2, y1);
    ctx.lineTo(x2 - width * 0.2, y2);
    ctx.stroke();
  };

  ctx.save();

  // 接地阴影
  ctx.fillStyle = 'rgba(58,92,38,0.22)';
  ctx.beginPath();
  ctx.ellipse(forkX - 12, groundY + 4, 96, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // 立柱 + 两根叉臂
  post(forkX, groundY, forkX, junctionY + 6, 30);
  post(forkX, junctionY + 8, leftTip.x, leftTip.y, 24);
  post(forkX, junctionY + 8, rightTip.x, rightTip.y, 24);

  // 叉口绑皮筋的卡口
  [leftTip, rightTip].forEach((p) => {
    ctx.fillStyle = pal.dark;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.stroke();
  });

  // 皮筋：撒放后变细
  const bandW = 12 - ease * 6;
  const bands = [
    { from: leftTip, to: { x: pouch.x - 9, y: pouch.y - 6 }, inner: '#6f4a2c' },
    { from: rightTip, to: { x: pouch.x + 9, y: pouch.y + 3 }, inner: '#5b3c24' },
  ];
  ctx.lineCap = 'round';
  bands.forEach((b) => {
    ctx.strokeStyle = '#3a2718';
    ctx.lineWidth = bandW + 4;
    ctx.beginPath();
    ctx.moveTo(b.from.x, b.from.y);
    ctx.lineTo(b.to.x, b.to.y);
    ctx.stroke();
    ctx.strokeStyle = b.inner;
    ctx.lineWidth = bandW;
    ctx.beginPath();
    ctx.moveTo(b.from.x, b.from.y);
    ctx.lineTo(b.to.x, b.to.y);
    ctx.stroke();
  });

  // 皮兜（画在猪之前，猪正好坐上兜里）
  ctx.save();
  ctx.translate(pouch.x - 5, pouch.y);
  ctx.fillStyle = '#8a5a2c';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  rr(ctx, -14, -24, 28, 48, 11);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(214,160,96,0.5)';
  rr(ctx, -9, -15, 9, 30, 5);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/**
 * 投石车发射器：车体直接坐在地面上。
 * x / y 是发射点，也就是**抛兜中心**（抛臂平放时兜的位置）。
 */
export function drawTrebuchet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fireFrame: number | null,
): void {
  const sprite = getTrebuchetSprite();
  if (!sprite) return;
  const baseY = y + (TREBUCHET.bottomY - TREBUCHET.anchorY) * TREBUCHET.scale;
  ctx.save();
  ctx.fillStyle = 'rgba(58,92,38,0.26)';
  ctx.beginPath();
  ctx.ellipse(x + 130, baseY - 2, 132, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  blitLauncher(ctx, sprite, TREBUCHET, fireFrame ?? 0, x, y);
}

function blitSprite(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLImageElement,
  spec: SpriteSheetSpec,
  frame: number,
  r: number,
  scaleX: number,
  scaleY: number,
  alpha = 1,
  flipMul = 1,
): void {
  const k = (r * 2) / spec.bodySize;
  const idx = Math.min(spec.frames - 1, Math.max(0, frame));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.scale((spec.flipX ? -1 : 1) * flipMul * scaleX, scaleY);
  ctx.drawImage(
    sprite,
    idx * spec.frameW,
    0,
    spec.frameW,
    spec.frameH,
    -spec.centerX * k,
    -spec.centerY * k,
    spec.frameW * k,
    spec.frameH * k,
  );
  ctx.restore();
}

/**
 * 小猪只走序列帧：素材缺失时不画（等图集加载完，下一帧自然出现）。
 * anim 里的 rot / ox / oy 是动作状态给的**绘制层**姿态，不动刚体。
 */
export function drawPig(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  r: number,
  type: PigType,
  anim: SpriteAnimFrame,
): void {
  const sprite = getPigSprite(type);
  if (!sprite) return;
  const spec = PIG_SHEETS[type];
  ctx.save();
  ctx.translate(x + (anim.ox ?? 0), y + (anim.oy ?? 0));
  ctx.rotate(angle + (anim.rot ?? 0));
  if (anim.fade) {
    blitSprite(ctx, sprite, spec, anim.fade.frame, r, anim.scaleX, anim.scaleY, anim.fade.alpha);
  }
  blitSprite(ctx, sprite, spec, anim.frame, r, anim.scaleX, anim.scaleY);
  ctx.restore();
}

const BIRD_RADIUS: Record<BirdType, number> = { red: 26, yellow: 24, blue: 18 };

export function drawBird(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: BirdType,
  t: number,
  anim: SpriteAnimFrame,
  spin = 0,
  flash = 0,
  alpha = 1,
  /** 朝向：+1 朝右、-1 朝左（按真实速度算，蓝鸟绕圈时会翻面） */
  face = -1,
): void {
  const sprite = getBirdSprite(kind);
  if (!sprite) return;
  const spec = BIRD_SHEETS[kind];
  const r = BIRD_RADIUS[kind];
  const f = Math.max(0, Math.min(1, flash));
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(x + (anim.ox ?? 0), y + (anim.oy ?? 0));
  ctx.rotate(spin + (anim.rot ?? 0) + Math.sin(t * 0.006) * 0.06);
  if (anim.state === 'fly' || anim.state === 'fall') ctx.rotate(0.12);
  // 被撞那一下整体弹一下，砸出"被打中"的体积感
  if (f > 0) {
    const k = 1 + f * 0.22;
    ctx.scale(k, k);
  }
  if (anim.fade) {
    blitSprite(ctx, sprite, spec, anim.fade.frame, r, anim.scaleX, anim.scaleY, anim.fade.alpha, face);
  }
  blitSprite(ctx, sprite, spec, anim.frame, r, anim.scaleX, anim.scaleY, 1, face);
  if (f > 0) {
    // 受击白闪：一个亮圆 + 四道放射星芒，压住贴图让"中招"一眼可见
    ctx.globalAlpha = f * 0.72;
    ctx.fillStyle = '#fffdf0';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff3ad';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.4;
    for (let i = 0; i < 4; i += 1) {
      const a = (Math.PI / 2) * i + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1);
      ctx.lineTo(Math.cos(a) * r * (1.5 + f * 0.5), Math.sin(a) * r * (1.5 + f * 0.5));
      ctx.stroke();
    }
  }
  ctx.restore();
}

/* ---------------- 小猪技能表现（都是叠加在贴图上的绘制层，不动刚体） ---------------- */

/**
 * 间谍猪的护盾：双层青白环 + 内侧微光。
 * k = 剩余时间比例（1 → 刚开，0 → 快结束），结束时环会变薄并闪一下。
 */
export function drawPigShield(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  k: number,
  tMs: number,
): void {
  const fade = Math.min(1, k * 3); // 最后 1/3 时间淡出
  const pulse = 1 + Math.sin(tMs * 0.012) * 0.05;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pulse, pulse);
  ctx.globalAlpha = 0.85 * fade;
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#8ff0ff';
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.5 * fade;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#e8ffff';
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.52, -0.6, Math.PI * 1.1);
  ctx.stroke();
  ctx.globalAlpha = 0.16 * fade;
  ctx.fillStyle = '#a9f4ff';
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * 厨师猪的冲刺尾焰：三片向后收尖的火舌，跟着真实速度方向走。
 * k = 剩余时间比例；速度由调用方给，慢下来自然变短。
 */
export function drawPigDash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  vx: number,
  vy: number,
  r: number,
  k: number,
): void {
  const speed = Math.hypot(vx, vy);
  if (speed < 2) return;
  const ux = vx / speed;
  const uy = vy / speed;
  const len = r * (1.5 + Math.min(1, speed / 24)) * Math.max(0.35, k);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(uy, ux));
  for (let i = 0; i < 3; i += 1) {
    const spread = (i - 1) * r * 0.34;
    const l = len * (i === 1 ? 1 : 0.7);
    ctx.globalAlpha = (i === 1 ? 0.72 : 0.44) * k;
    ctx.fillStyle = i === 1 ? '#ffd45e' : '#ff9d3c';
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, spread);
    ctx.lineTo(-r * 0.8 - l, spread * 1.15 + (i - 1) * 2);
    ctx.lineTo(-r * 0.8, spread + r * 0.22);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** "哼！"气泡：普通/钢盔/国王按技能键时的即时回应（这三种没有真技能） */
export function drawOinkBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  k: number,
): void {
  if (k <= 0) return;
  const pop = Math.min(1, k * 2.4);
  ctx.save();
  ctx.translate(x, y - r * 1.5 - (1 - pop) * 6);
  ctx.scale(pop, pop);
  ctx.globalAlpha = Math.min(1, k * 1.8);
  ctx.fillStyle = '#fff8e6';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  rr(ctx, -r * 0.86, -r * 0.62, r * 1.72, r * 1.08, 8);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.22, r * 0.44);
  ctx.lineTo(-r * 0.06, r * 0.86);
  ctx.lineTo(r * 0.24, r * 0.44);
  ctx.closePath();
  ctx.fillStyle = '#fff8e6';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#8a3f08';
  ctx.font = `900 ${Math.round(r * 0.72)}px "Noto Sans SC", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('哼!', 0, -r * 0.06);
  ctx.restore();
}

/* ---------------- 特效 ---------------- */

/** 白色闪裂：方块消失那一瞬的同形剪影 */
export function drawFlashes(ctx: CanvasRenderingContext2D, items: FlashFx[]): void {
  items.forEach((f) => {
    const t = f.life / f.ttl;
    ctx.save();
    ctx.globalAlpha = Math.max(0, t) * 0.7;
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    const s = 1 + (1 - t) * 0.14;
    ctx.scale(s, s);
    ctx.fillStyle = '#fffdf0';
    rr(ctx, -f.w / 2, -f.h / 2, f.w, f.h, 6);
    ctx.fill();
    ctx.restore();
  });
}

/** 尘土 / 烟：先涌后淡 */
export function drawPuffs(ctx: CanvasRenderingContext2D, items: PuffFx[]): void {
  items.forEach((p) => {
    const t = Math.max(0, p.life / p.ttl);
    const base = p.smoke ? '#6f6a62' : palOf(p.mat).dust;
    ctx.save();
    ctx.globalAlpha = t * (p.smoke ? 0.62 : 0.55);
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = t * 0.34;
    ctx.beginPath();
    ctx.arc(p.x + p.r * 0.55, p.y - p.r * 0.35, p.r * 0.68, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

/** 碎块：多边形碎片 + 描边 + 受光棱，最后 240ms 淡出 */
export function drawShards(ctx: CanvasRenderingContext2D, items: ShardFx[]): void {
  items.forEach((s) => {
    const pal = palOf(s.mat);
    const a = Math.min(1, s.life / 240) * (s.mat === 'glass' ? 0.86 : 1);
    const p = s.pts;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(p[2], p[3]);
    ctx.lineTo(p[4], p[5]);
    ctx.lineTo(p[6], p[7]);
    ctx.closePath();
    ctx.fillStyle = pal.face;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(p[2], p[3]);
    ctx.strokeStyle = pal.light;
    ctx.globalAlpha = a * 0.8;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  });
}

/** 爆炸火球：橙黄球体 + 白热核心 + 放射火星 */
export function drawBlasts(ctx: CanvasRenderingContext2D, items: BlastFx[]): void {
  items.forEach((b) => {
    const t = Math.max(0, b.life / b.ttl); // 1 → 0
    const grow = 1 - t;
    const r = b.r + (b.max - b.r) * Math.min(1, grow * 1.6);
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 1.5);
    const g = ctx.createRadialGradient(b.x, b.y, r * 0.1, b.x, b.y, r);
    g.addColorStop(0, 'rgba(255,255,236,0.98)');
    g.addColorStop(0.35, 'rgba(255,214,90,0.95)');
    g.addColorStop(0.7, 'rgba(244,132,38,0.82)');
    g.addColorStop(1, 'rgba(196,64,16,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();

    // 爆心白闪：只在前 90ms 存在，让"炸白 → 火球 → 冲击环 → 烟"四层错开出现
    const age = b.ttl - b.life;
    if (age < 90) {
      const f = 1 - age / 90;
      const g2 = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r * (0.55 + (1 - f) * 0.5));
      g2.addColorStop(0, `rgba(255,255,255,${0.95 * f})`);
      g2.addColorStop(0.6, `rgba(255,250,214,${0.5 * f})`);
      g2.addColorStop(1, 'rgba(255,244,180,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * (0.55 + (1 - f) * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    // 火星：固定角度分布，长度按 seed 抖动，随时间外扩变短
    ctx.strokeStyle = 'rgba(255,236,168,0.9)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i += 1) {
      const a = (Math.PI * 2 * i) / 12 + Math.sin(b.seed + i) * 0.22;
      const near = r * (0.55 + ((i * 7) % 5) * 0.05);
      const far = r * (1.15 + ((i * 11) % 7) * 0.12);
      ctx.lineWidth = 3.4 - i * 0.15;
      ctx.globalAlpha = Math.min(1, t * 1.6) * 0.85;
      ctx.beginPath();
      ctx.moveTo(b.x + Math.cos(a) * near, b.y + Math.sin(a) * near);
      ctx.lineTo(b.x + Math.cos(a) * far, b.y + Math.sin(a) * far);
      ctx.stroke();
    }
    ctx.restore();
  });
}

/** 冲击波：双环，外环细、内环粗，一起扩散变淡 */
export function drawShockwaves(ctx: CanvasRenderingContext2D, items: RingFx[]): void {
  items.forEach((r) => {
    const t = Math.max(0, r.life / r.ttl);
    const radius = r.r + (r.max - r.r) * (1 - t);
    ctx.save();
    ctx.globalAlpha = t * 0.85;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 10 * t + 2;
    ctx.beginPath();
    ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = t * 0.45;
    ctx.strokeStyle = 'rgba(255,224,140,0.9)';
    ctx.lineWidth = 4 * t + 1;
    ctx.beginPath();
    ctx.arc(r.x, r.y, radius * 0.86, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

/** 撞击火花：从接触点甩出去的短线，最后 40% 生命淡出 */
export function drawSparks(ctx: CanvasRenderingContext2D, items: SparkFx[]): void {
  items.forEach((s) => {
    const t = Math.max(0, s.life / s.ttl);
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 1.7) * (s.feather ? 0.95 : 0.9);
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    const k = 0.55 + t * 0.45;
    ctx.strokeStyle = s.feather ? '#fffdf6' : palOf(s.mat).light;
    ctx.lineCap = 'round';
    ctx.lineWidth = (s.feather ? 2.6 : 2.1) * k;
    ctx.beginPath();
    ctx.moveTo(-s.len * 0.5 * k, 0);
    ctx.lineTo(s.len * 0.5 * k, 0);
    ctx.stroke();
    ctx.restore();
  });
}

/** 世界内飘字：深描边 + 平涂文字，边升边淡出 */
export function drawFloatTexts(ctx: CanvasRenderingContext2D, items: FloatTextFx[]): void {
  items.forEach((f) => {
    const t = Math.max(0, f.life / f.ttl);
    const grow = 1 + (1 - t) * 0.14;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 1.9);
    ctx.translate(f.x, f.y);
    ctx.scale(grow, grow);
    ctx.font = `900 ${f.size}px "Noto Sans SC", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, f.size * 0.22);
    ctx.strokeStyle = OUTLINE;
    ctx.strokeText(f.text, 0, 0);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, 0, 0);
    ctx.restore();
  });
}

/* ---------------- 前景 ---------------- */

/** 前景：左右下角的灌木剪影 + 几丛近景草，压住画面下缘当取景框 */
/**
 * 空气中的浮尘 / 光点：世界坐标里的十几粒小亮点，缓慢斜向上飘。
 * 位置完全由时间 + 序号算出（无状态、无粒子池），所以：
 *   - 不进入物理，不影响任何碰撞；
 *   - 不遮挡瞄准：画在背景之后、地形之前，亮度极低（≤0.18）；
 *   - 成本 = 18 个圆，可忽略。
 */
export function drawAmbient(
  ctx: CanvasRenderingContext2D,
  worldWidth: number,
  groundY: number,
  tSec: number,
  density = 1,
): void {
  const n = Math.round(18 * density);
  if (n <= 0) return;
  ctx.save();
  for (let i = 0; i < n; i += 1) {
    const seedX = (i * 733) % 1000;
    const baseX = (seedX / 1000) * worldWidth;
    const baseY = groundY - 40 - ((i * 197) % 460);
    const drift = (tSec * (7 + (i % 5) * 3) + i * 41) % 220;
    const x = baseX + Math.sin(tSec * 0.35 + i) * 26 + drift * 0.35;
    const y = baseY - (drift % 90) * 0.6;
    const twinkle = 0.5 + 0.5 * Math.sin(tSec * 1.6 + i * 1.7);
    ctx.globalAlpha = 0.08 + twinkle * 0.1;
    ctx.fillStyle = i % 4 === 0 ? '#fff6c4' : '#fdfbe8';
    const r = 1.6 + (i % 3) * 0.9;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawForeground(
  ctx: CanvasRenderingContext2D,
  groundY: number,
  worldWidth: number,
  sway = 0,
): void {
  const dark = '#3f7a22';
  const mid = '#4f9430';

  const bush = (bx: number, by: number, r: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(bx, by, r, Math.PI, Math.PI * 2);
    ctx.arc(bx + r * 0.86, by, r * 0.72, Math.PI, Math.PI * 2);
    ctx.arc(bx - r * 0.82, by, r * 0.64, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(bx, by, r, Math.PI, Math.PI * 2);
    ctx.stroke();
  };

  ctx.save();
  bush(-86, groundY + 34, 118, dark);
  bush(-14, groundY + 48, 74, mid);
  bush(worldWidth + 76, groundY + 30, 128, dark);
  bush(worldWidth + 10, groundY + 46, 78, mid);

  // 近景草：比地面草簇更长更粗，做出前后层次；叶尖摆幅比地上草簇更大
  for (let i = 0; i < 26; i += 1) {
    const x = i < 13 ? -40 + i * 46 : worldWidth + 10 - (i - 13) * 46;
    const len = 34 + ((i * 17) % 26);
    const bend = sway ? Math.sin(sway * 1.3 + i * 0.7) * (3 + len * 0.06) : 0;
    ctx.strokeStyle = i % 2 === 0 ? dark : mid;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, groundY + 44);
    ctx.quadraticCurveTo(x - 8, groundY + 12, x - 22 + bend, groundY - len * 0.4);
    ctx.moveTo(x, groundY + 44);
    ctx.quadraticCurveTo(x + 2, groundY + 6, x + 6 + bend * 0.8, groundY - len * 0.7);
    ctx.stroke();
  }

  // 世界最底部一条压边
  ctx.fillStyle = 'rgba(58,92,38,0.5)';
  ctx.fillRect(-600, groundY + 150, worldWidth + 1200, 460);
  ctx.restore();
}
