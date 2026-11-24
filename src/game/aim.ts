import { GROUND_Y, MAX_PULL, WORLD_WIDTH } from './levels';
import { MATERIALS } from './materials';
import { SPRING, TNT } from './mechanisms';
import type { BirdType, Material } from './types';

/**
 * 瞄准系统（弹道预测 + 瞄准表现），是本项目**唯一**的预测实现。
 *
 * 预测的步进方式与 Matter 的 `Body.update` 完全一致，所以虚线不只是"大概方向"：
 *   v = v_prev * (1 - frictionAir) + gravity.y * gravity.scale * STEP²
 *   p = p_prev + v
 * 在此基础上按物理规则分段续算：
 *   1. `shot`   —— 自由弹道，直到撞上第一块方块 / 弹簧板 / 鸟 / 车轮 / 地面；
 *   2. `smash`  —— 方块被撞穿（冲击强度 ≥ 材质耐久，与 applyImpact 同构），
 *                  保留 0.72 冲量继续飞（与 drainBreaks 的 pigSmashVelocity 同源）；
 *   3. `spring` —— 砸中弹簧板，按 trySpring 的同一套公式换向加速后再续算；
 *   4. `roll`   —— 落地后的滑行估算，用来回答"能不能滚进鸟窝"。
 *
 * 无法预测的部分（明确说明，不用假结果掩盖）：
 *   - 方块被撞碎后建筑会塌，落下的残骸不在预测范围内；
 *   - 炸药箱被引爆后的爆风无法预测，预测在炸药箱处直接终止；
 *   - 小鸟的运动由脚本驱动，只能按当前脚本外推一段（黄鸟冲刺 / 蓝鸟绕圈），
 *     撞击后的鸟会被撞飞、玩家放技能也会改变一切，所以拦截提示只是"风险估计"。
 */

const TAU = Math.PI * 2;

/** canvas 内配色，与 draw.ts / DESIGN.md 的 token 同源 */
const INK = '#3a2a18';
const CREAM = '#fff7e2';
const GOLD = '#ffc72e';
const GOLD_DARK = '#f2a30c';
const GREEN = '#56b32e';
const GREEN_DARK = '#35761a';
const ALARM = '#e0472c';
const BAND_OUTLINE = '#3a2718';
const BAND_FACE = '#6f4a2c';
const BAND_LIGHT = '#a3733f';
const BAND_DARK = '#5b3c24';
const DASH_INK = 'rgba(58,42,24,0.42)';

const FONT_STACK = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

export interface Vec {
  x: number;
  y: number;
}

/** 预测用的方块包围盒（取活体刚体的 bounds，已含旋转） */
export interface AimBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  mat: Material;
  /** 炸药箱：撞上去会被引爆，预测就在这里收尾 */
  tnt: boolean;
}

/** 预测用的弹簧板（法线指向"正面"，与 engine.trySpring 同一套参数） */
export interface AimSpring {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** 关卡里配的弹射倍率 */
  power: number;
}

/** 预测用的圆形刚体（车轮） */
export interface AimCircle {
  x: number;
  y: number;
  r: number;
}

/** 小鸟的运动脚本：与 engine.updateBirds 完全同构，所以短时间外推可信 */
export interface AimBirdMotion {
  type: 'static' | 'dash' | 'orbit';
  /** dash：冲刺起点→终点（世界 px）与节奏（ms） */
  toX: number;
  toY: number;
  restMs: number;
  dashMs: number;
  /** orbit：椭圆中心 / 半径 / 角速度（rad/s） */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  speed: number;
}

export interface AimBird {
  kind: BirdType;
  r: number;
  /** 当前位置（蹲在屋顶的红鸟会跟着塌楼走，每帧刷新） */
  x: number;
  y: number;
  /** 蓝鸟相位偏移（弧度） */
  phase: number;
  /** 运动最大偏离量，用来剪掉远处的小鸟检测（性能） */
  reach: number;
  motion: AimBirdMotion;
}

/** 一段预测的结束原因 */
export type AimEnd = 'ground' | 'block' | 'smash' | 'spring' | 'bird' | 'out' | 'none';

/** 预测段的类型：自由弹道 / 撞穿续飞 / 弹簧反弹 / 落地滚行 */
export type AimSegmentKind = 'shot' | 'smash' | 'spring' | 'roll';

export interface AimSegment {
  kind: AimSegmentKind;
  /** 采样点（构造期一次性分配的复用池，只有前 count 个有效） */
  points: Vec[];
  count: number;
  /** 段终点 */
  end: Vec;
  /** 段结束原因 */
  hit: AimEnd;
}

/** 鸟蛋可达性：直击 / 落地后可能滚进去 / 被硬挡住 / 撞穿后结果不确定 / 没戏 */
export type EggReach = 'direct' | 'roll' | 'blocked' | 'uncertain' | 'none';

export interface AimPlan {
  segments: AimSegment[];
  segmentCount: number;
  /** 第一个"会拦住小猪"的碰撞点（方块 / 弹簧板 / 鸟 / 地面） */
  firstHit: Vec;
  firstHitKind: AimEnd;
  firstHitMat: Material | null;
  firstHitTnt: boolean;
  hasFirstHit: boolean;
  /** 会擦到车轮的位置（车轮是轻质动态刚体，猪会把它撞开继续飞，所以不算拦截） */
  wheelHit: boolean;
  wheelAt: Vec;
  /** 弹道段的终点（撞方块=撞点，落地=着地点），这是可靠信息 */
  landing: Vec;
  landingKind: AimEnd;
  /** 落点是否可信（纯自由弹道落地）：撞穿/弹簧/滚行之后的落点只是估算 */
  landingSure: boolean;
  /** 落地后的滑行估算（不可靠，只用来判断"可能滚到鸟窝"） */
  rolled: boolean;
  rollEnd: Vec;
  /** 飞出世界 */
  out: boolean;
  /** 小鸟拦截风险（估算，不是保证） */
  intercept: {
    on: boolean;
    x: number;
    y: number;
    kind: BirdType;
    /** 是否会移动（黄/蓝鸟为 true） */
    moving: boolean;
    steps: number;
  };
  /** 鸟蛋路线 */
  egg: EggReach;
  /** 直击 / 滚入命中的预估步数（0 = 未命中） */
  eggSteps: number;
  /** 内部复用缓冲：本帧已撞穿的方块下标 */
  broken: number[];
}

export interface AimScene {
  start: Vec;
  vx: number;
  vy: number;
  /** 猪的空气阻力（Matter 每步乘 1 - frictionAir） */
  frictionAir: number;
  /** 预测半径（略小于实体，让"擦边"看起来也打得中） */
  radius: number;
  /** 每步重力增量 = gravity.y * gravity.scale * STEP² */
  gravityStep: number;
  /** 一步的毫秒数：小鸟位置外推要用同一个节拍 */
  stepMs: number;
  /** 预测起点对应的仿真时钟（秒） */
  now: number;
  /** 本关猪的力气系数（PIG_POWER），决定能不能撞穿方块 */
  pigPower: number;
  groundY?: number;
  /** 地面接触半径（= 实体半径），省略时与 `radius` 相同 */
  groundRadius?: number;
  boxes: readonly AimBox[];
  springs: readonly AimSpring[];
  circles: readonly AimCircle[];
  birds: readonly AimBird[];
  egg: { x: number; y: number; r: number } | null;
}

/** 预测步数上限（跨所有弹道段共享，绑住拖动时的计算量） */
const MAX_STEPS = 420;
/** 采样节奏：每 6 个物理步留一个点，点与点之间是等时距 */
const DOT_EVERY = 6;
/** 段数上限：首段 + 撞穿/弹簧续飞若干段 + 预留最后一段给滚行 */
const MAX_SEGMENTS = 8;
/** 弹道段采样点池容量 */
const SHOT_DOTS = 72;
/** 滚行段采样点池容量 */
const ROLL_DOTS = 40;
/** 撞穿后的冲量保留（与 engine.drainBreaks 的 0.72 同源） */
const SMASH_KEEP = 0.72;
/** 擦过车轮时保留的速度（实测 26 → 23，约掉一成） */
const WHEEL_KEEP = 0.9;
/** 落地滚行的每步速度衰减与步数上限（对拍校准，见 AGENTS.md） */
const ROLL_DECAY = 0.978;
const ROLL_STEPS = 120;
/** 滚行最多估这么远：真实滚行误差可达数百 px，再画长就只是噪声 */
const ROLL_TRAVEL_MAX = 460;
/** 入地水平速度低于这个值才把"滚进鸟窝"当成可信结论（更快就别装准） */
const ROLL_SURE_SPEED = 2.2;
/** 弹道离蛋心不到这个倍数（× 命中半径）时改判"不确定"，兜住撞穿衰减等估算误差 */
const NEAR_EGG_RATIO = 1.45;
/** 停在方块上时还留着这么大速度，就说明它会被弹开继续走 —— 别急着说"打不到" */
const RICOCHET_SPEED = 6;
/** 弹簧反弹后忽略该板面的步数，避免下一步又落在板里 */
const SPRING_GRACE = 10;

/** 建一份可长期复用的预测计划（点池只在这里分配一次） */
export function createAimPlan(): AimPlan {
  const segments: AimSegment[] = [];
  for (let i = 0; i < MAX_SEGMENTS; i += 1) {
    const size = i === MAX_SEGMENTS - 1 ? ROLL_DOTS : SHOT_DOTS;
    segments.push({
      kind: 'shot',
      points: Array.from({ length: size }, () => ({ x: 0, y: 0 })),
      count: 0,
      end: { x: 0, y: 0 },
      hit: 'none',
    });
  }
  return {
    segments,
    segmentCount: 0,
    firstHit: { x: 0, y: 0 },
    firstHitKind: 'none',
    firstHitMat: null,
    firstHitTnt: false,
    hasFirstHit: false,
    wheelHit: false,
    wheelAt: { x: 0, y: 0 },
    landing: { x: 0, y: 0 },
    landingKind: 'none',
    landingSure: false,
    rolled: false,
    rollEnd: { x: 0, y: 0 },
    out: false,
    intercept: { on: false, x: 0, y: 0, kind: 'red', moving: false, steps: 0 },
    egg: 'none',
    eggSteps: 0,
    broken: [],
  };
}

/** 小鸟在 tSec（仿真秒）时的位置：与 engine.updateBirds 的脚本逐句对应 */
function birdAt(bird: AimBird, tSec: number, out: Vec): void {
  const m = bird.motion;
  if (m.type === 'orbit') {
    const a = tSec * m.speed + bird.phase;
    out.x = m.cx + Math.cos(a) * m.rx;
    out.y = m.cy + Math.sin(a) * m.ry;
    return;
  }
  if (m.type === 'dash') {
    const rest = m.restMs / 1000;
    const dash = m.dashMs / 1000;
    const total = rest * 2 + dash * 2;
    const phase = total > 0 ? ((tSec % total) + total) % total : 0;
    const smooth = (k: number): number => k * k * (3 - 2 * k);
    let k = 0;
    if (phase < rest) k = 0;
    else if (phase < rest + dash) k = smooth((phase - rest) / dash);
    else if (phase < rest * 2 + dash) k = 1;
    else k = 1 - smooth((phase - rest * 2 - dash) / dash);
    out.x = bird.x + (m.toX - bird.x) * k;
    out.y = bird.y + (m.toY - bird.y) * k;
    return;
  }
  out.x = bird.x;
  out.y = bird.y;
}

/**
 * 预测一次发射并写入 `plan`（复用点池，不新建路径对象）。
 * 返回同一份 plan，方便 `drawAimPlan(predictAim(scene, plan), ...)` 这类写法。
 */
export function predictAim(scene: AimScene, plan: AimPlan): AimPlan {
  const groundY = scene.groundY ?? GROUND_Y;
  const r = scene.radius;
  // 地面接触用真实半径：预测半径故意比实体小一点（擦边也算打中），
  // 但落地横向误差会被"半径差 ÷ 竖直角"放大，所以落地判定必须用实体半径
  const gr = scene.groundRadius ?? r;
  const keep = 1 - scene.frictionAir;
  const stepSec = scene.stepMs / 1000;
  const egg = scene.egg;
  const eggR = egg ? egg.r + r : 0;

  plan.segmentCount = 0;
  plan.hasFirstHit = false;
  plan.wheelHit = false;
  plan.firstHitKind = 'none';
  plan.firstHitMat = null;
  plan.firstHitTnt = false;
  plan.landingKind = 'none';
  plan.landingSure = false;
  plan.rolled = false;
  plan.out = false;
  plan.intercept.on = false;
  plan.egg = 'none';
  plan.eggSteps = 0;
  plan.broken.length = 0;

  let x = scene.start.x;
  let y = scene.start.y;
  let vx = scene.vx;
  let vy = scene.vy;
  let steps = 0;
  /** 直击蛋 / 滚到蛋的步数（0 = 还没命中） */
  let eggDirectAt = 0;
  let eggRollAt = 0;
  /** 全程离蛋心的最近距离：几何预测有 3~7% 的误差，用它兜住"擦边"这种说不准的情况 */
  let eggMin = Number.POSITIVE_INFINITY;
  /** 落地速度够小才敢把滚行当成可信结论 */
  let rollSure = true;
  /** 收尾那一步的速率：撞在方块上还这么快，说明会被弹开接着走 */
  let exitSpeed = 0;
  let springGrace = 0;
  /** 已擦过的车轮（位掩码，避免同一个车轮每步都减速） */
  let wheelMask = 0;
  let segIndex = 0;
  let kind: AimSegmentKind = 'shot';
  let hit: AimEnd = 'none';
  const probe: Vec = { x: 0, y: 0 };

  while (segIndex < MAX_SEGMENTS) {
    const slot = plan.segments[segIndex];
    slot.kind = kind;
    slot.count = 0;
    hit = 'none';
    let endX = x;
    let endY = y;

    for (let i = 0; i < MAX_STEPS && steps < MAX_STEPS; i += 1) {
      vx *= keep;
      vy = vy * keep + scene.gravityStep;
      x += vx;
      y += vy;
      steps += 1;
      const speed = Math.hypot(vx, vy);
      exitSpeed = speed;

      if (i % DOT_EVERY === 0 && slot.count < slot.points.length) {
        const p = slot.points[slot.count];
        p.x = x;
        p.y = y;
        slot.count += 1;
      }

      // 鸟蛋：与 engine.updatePig 的赢判同构（中心距 < 蛋半径 + 猪半径）
      if (egg && eggDirectAt === 0) {
        const dx = x - egg.x;
        const dy = y - egg.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < eggMin * eggMin) eggMin = Math.sqrt(d2);
        if (d2 <= eggR * eggR) eggDirectAt = steps;
      }

      if (y + gr >= groundY) {
        y = groundY - gr;
        hit = 'ground';
        endX = x;
        endY = y;
        break;
      }

      // 方块（AABB，含旋转后的 bounds）
      let boxHit = -1;
      for (let k = 0; k < scene.boxes.length; k += 1) {
        if (plan.broken.indexOf(k) >= 0) continue;
        const b = scene.boxes[k];
        if (x + r > b.minX && x - r < b.maxX && y + r > b.minY && y - r < b.maxY) {
          boxHit = k;
          break;
        }
      }

      if (boxHit >= 0) {
        const b = scene.boxes[boxHit];
        const breaks = speed * scene.pigPower >= MATERIALS[b.mat].hp;
        // 炸药箱：冲击够 TNT.minImpact 就点着（与 applyImpact 的判定同门槛），
        // 240ms 后炸开的爆风无法预测，所以预测在这里收尾，只把"会炸"这件事标出来
        const willBlow = b.tnt && speed >= TNT.minImpact;
        endX = x;
        endY = y;
        if (!plan.hasFirstHit) {
          plan.hasFirstHit = true;
          plan.firstHit.x = x;
          plan.firstHit.y = y;
          plan.firstHitMat = b.mat;
          plan.firstHitTnt = willBlow;
          plan.firstHitKind = willBlow ? 'block' : breaks ? 'smash' : 'block';
        }
        if (willBlow) {
          hit = 'block';
          break;
        }
        if (breaks) {
          // 撞穿：方块碎掉，猪保留约七成冲量继续往里钻
          plan.broken.push(boxHit);
          vx *= SMASH_KEEP;
          vy *= SMASH_KEEP;
          hit = 'smash';
          break;
        }
        hit = 'block';
        break;
      }

      // 弹簧板
      let springHit = -1;
      if (springGrace <= 0) {
        for (let k = 0; k < scene.springs.length; k += 1) {
          const s = scene.springs[k];
          if (x + r > s.minX && x - r < s.maxX && y + r > s.minY && y - r < s.maxY) {
            springHit = k;
            break;
          }
        }
      } else {
        springGrace -= 1;
      }

      if (springHit >= 0) {
        const s = scene.springs[springHit];
        // 与 engine.trySpring 同一套公式：法向撞击优先，横向擦上板面用总速度折算
        const along = vx * s.nx + vy * s.ny;
        const approach = -along;
        const side = (x - s.x) * s.nx + (y - s.y) * s.ny;
        const impact = approach >= SPRING.minSpeed ? approach : side > 0 ? speed * SPRING.grazeKeep : 0;
        endX = x;
        endY = y;
        if (impact < SPRING.minSpeed) {
          // 速度不够，弹簧板这时就是一块硬板
          if (!plan.hasFirstHit) {
            plan.hasFirstHit = true;
            plan.firstHit.x = x;
            plan.firstHit.y = y;
            plan.firstHitKind = 'block';
          }
          hit = 'block';
          break;
        }
        if (!plan.hasFirstHit) {
          plan.hasFirstHit = true;
          plan.firstHit.x = x;
          plan.firstHit.y = y;
          plan.firstHitKind = 'spring';
        }
        const bonus = Math.min(SPRING.maxBonus, impact * 0.55);
        const launch = Math.min(SPRING.maxSpeed, (SPRING.power + bonus) * s.power);
        const tx = vx - s.nx * along;
        const ty = vy - s.ny * along;
        vx = s.nx * launch + tx * SPRING.tangentKeep;
        vy = s.ny * launch + ty * SPRING.tangentKeep;
        // 从板面法线方向挪出去，否则下一步又落在板里
        x += s.nx * (r + 2);
        y += s.ny * (r + 2);
        endX = x;
        endY = y;
        springGrace = SPRING_GRACE;
        hit = 'spring';
        break;
      }

      // 车轮：轻质动态刚体，实测猪只会掉一成左右速度就把它撞开继续飞，
      // 所以这里不做"轨迹终止"，只做一次减速 + 记下擦碰点（要求：别把会挡路的刚体当装饰，
      // 但也别把撞得开的车轮当墙）。
      let wheelHit = -1;
      for (let k = 0; k < scene.circles.length && k < 31; k += 1) {
        if (((wheelMask >> k) & 1) === 1) continue;
        const c = scene.circles[k];
        const dx = x - c.x;
        const dy = y - c.y;
        const rr = r + c.r;
        if (dx * dx + dy * dy <= rr * rr) {
          wheelHit = k;
          break;
        }
      }
      if (wheelHit >= 0) {
        wheelMask |= 1 << wheelHit;
        if (!plan.wheelHit) {
          plan.wheelHit = true;
          plan.wheelAt.x = x;
          plan.wheelAt.y = y;
        }
        vx *= WHEEL_KEEP;
        vy *= WHEEL_KEEP;
      }

      // 小鸟：按脚本把位置外推到"猪走到这一步"的时刻再判定，不能拿当前坐标当全程坐标
      let birdHit = -1;
      for (let k = 0; k < scene.birds.length; k += 1) {
        const b = scene.birds[k];
        if (Math.abs(x - b.x) > b.reach + r + b.r + 120) continue;
        birdAt(b, scene.now + steps * stepSec, probe);
        const dx = x - probe.x;
        const dy = y - probe.y;
        const rr = r + b.r;
        if (dx * dx + dy * dy <= rr * rr) {
          birdHit = k;
          if (!plan.intercept.on) {
            plan.intercept.on = true;
            plan.intercept.x = probe.x;
            plan.intercept.y = probe.y;
            plan.intercept.kind = b.kind;
            plan.intercept.moving = b.motion.type !== 'static';
            plan.intercept.steps = steps;
          }
          break;
        }
      }
      if (birdHit >= 0) {
        endX = x;
        endY = y;
        if (!plan.hasFirstHit) {
          plan.hasFirstHit = true;
          plan.firstHit.x = x;
          plan.firstHit.y = y;
          plan.firstHitKind = 'bird';
        }
        hit = 'bird';
        break;
      }

      if (x > WORLD_WIDTH + 600 || x < -400 || y > groundY + 500 || y < -1200) {
        endX = x;
        endY = y;
        plan.out = true;
        hit = 'out';
        break;
      }
    }

    if (slot.count === 0 || slot.points[slot.count - 1].x !== endX || slot.points[slot.count - 1].y !== endY) {
      if (slot.count < slot.points.length) {
        const p = slot.points[slot.count];
        p.x = endX;
        p.y = endY;
        slot.count += 1;
      }
    }
    slot.end.x = endX;
    slot.end.y = endY;
    slot.hit = hit;
    segIndex += 1;
    plan.segmentCount = segIndex;

    // 续算：撞穿后带着衰减冲量继续飞，踩到弹簧板后按弹射速度继续飞
    if (hit === 'smash' && segIndex < MAX_SEGMENTS - 1) {
      kind = 'smash';
      x = endX;
      y = endY;
      continue;
    }
    if (hit === 'spring' && segIndex < MAX_SEGMENTS - 1) {
      kind = 'spring';
      x = endX;
      y = endY;
      continue;
    }
    break;
  }

  // 落点：撞到东西就是撞点，落地则继续估一段滑行
  plan.landing.x = x;
  plan.landing.y = y;
  plan.landingKind = hit;
  // 纯自由弹道落到地面上 = 算得准；中途撞穿过/被弹簧弹过 = 只是估算（画虚环）
  plan.landingSure = hit === 'ground' && segIndex === 0;

  if (hit === 'ground' && Math.abs(vx) > 0.6 && segIndex < MAX_SEGMENTS) {
    const slot = plan.segments[segIndex];
    slot.kind = 'roll';
    slot.count = 0;
    slot.hit = 'ground';
    const ry = groundY - gr;
    let rx = x;
    let rvx = vx;
    // 滚行是"估算中的估算"：入地速度越大，摩擦模型的误差被放大得越厉害，
    // 所以只有慢速滑行才敢说"能滚进鸟窝"，高速冲进去只标记为不确定
    rollSure = Math.abs(vx) <= ROLL_SURE_SPEED;
    for (let i = 0; i < ROLL_STEPS; i += 1) {
      rvx *= ROLL_DECAY;
      if (Math.abs(rvx) < 0.06) break;
      rx += rvx;
      if (egg) {
        const dx = rx - egg.x;
        const dy = ry - egg.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < eggMin * eggMin) eggMin = Math.sqrt(d2);
        if (eggRollAt === 0 && d2 <= eggR * eggR) eggRollAt = steps + i + 1;
      }
      if (i % 4 === 0 && slot.count < slot.points.length) {
        const p = slot.points[slot.count];
        p.x = rx;
        p.y = ry;
        slot.count += 1;
      }
      if (rx < -300 || rx > WORLD_WIDTH + 400) break;
      if (Math.abs(rx - x) > ROLL_TRAVEL_MAX) break;
    }
    if (slot.count < slot.points.length) {
      const p = slot.points[slot.count];
      p.x = rx;
      p.y = ry;
      slot.count += 1;
    }
    slot.end.x = rx;
    slot.end.y = ry;
    plan.segmentCount = segIndex + 1;
    plan.rolled = true;
    plan.landingSure = false;
    plan.rollEnd.x = rx;
    plan.rollEnd.y = ry;
    plan.landing.x = rx;
    plan.landing.y = ry;
  }

  if (egg) {
    if (eggDirectAt > 0) {
      plan.egg = 'direct';
      plan.eggSteps = eggDirectAt;
    } else if (eggRollAt > 0 && rollSure) {
      plan.egg = 'roll';
      plan.eggSteps = eggRollAt;
    } else if (eggRollAt > 0 || hit === 'smash' || eggMin <= eggR * NEAR_EGG_RATIO) {
      // 三种"说不准"：高速滚行贴到蛋、撞穿到最后还在往里钻、弹道从蛋边擦过。
      // 几何预测的撞穿衰减 / 摩擦都只是近似，这里如实标成不确定，不假装能算准
      plan.egg = 'uncertain';
    } else if (hit === 'block' && exitSpeed >= RICOCHET_SPEED) {
      // 撞在方块上但还有余速：真实物理里会被弹开、滑落、连带塌方，
      // 落点完全不可预测，所以只能说"说不准"，不能断言打不到
      plan.egg = 'uncertain';
    } else if (plan.hasFirstHit && plan.firstHit.x < egg.x - egg.r) {
      // 撞点落在鸟蛋前面 —— 路上有东西挡着，明确告诉玩家"打不穿这层"
      plan.egg = 'blocked';
    }
  }

  return plan;
}

/* ---------------- 瞄准表现 ---------------- */

/** 瞄准状态提示的四种语气：命中 / 不确定 / 无效 / 危险 */
export type AimTone = 'green' | 'gold' | 'muted' | 'alarm';

export interface AimStatus {
  text: string;
  tone: AimTone;
}

const TONE_COLOR: Record<AimTone, { text: string; dot: string }> = {
  green: { text: GREEN_DARK, dot: GREEN },
  gold: { text: '#8a5a06', dot: GOLD_DARK },
  muted: { text: '#6f5b43', dot: '#a08c72' },
  alarm: { text: '#a92a17', dot: ALARM },
};

/**
 * 完整瞄准图形：鸟蛋目标环 → 分段弹道 → 拦截风险 → 首撞点 → 最终落点。
 * 全部画在世界坐标系里，随相机缩放一起缩放（标记尺寸按世界 px 设计，缩到 0.5 也认得出）。
 */
export function drawAimPlan(
  ctx: CanvasRenderingContext2D,
  plan: AimPlan,
  egg: { x: number; y: number; r: number } | null,
  t: number,
): void {
  drawEggTarget(ctx, egg, plan.egg, t);
  drawTrajectory(ctx, plan);
  drawWheelHint(ctx, plan);
  drawInterceptHint(ctx, plan, t);
  drawHitMarker(ctx, plan, t);
  drawLandingMarker(ctx, plan, t);
}

/** 弹道采样点：首段实心米白；撞穿/弹簧续飞段改空心金点；滚行段用极淡小点 */
function drawTrajectory(ctx: CanvasRenderingContext2D, plan: AimPlan): void {
  ctx.save();
  for (let s = 0; s < plan.segmentCount; s += 1) {
    const seg = plan.segments[s];
    const n = seg.count;
    if (n === 0) continue;
    for (let i = 0; i < n; i += 1) {
      const p = seg.points[i];
      const k = n <= 1 ? 0 : i / (n - 1);
      if (seg.kind === 'roll') {
        // 滚行是估算值：只给一点点"还能滑到这"的暗示，不做强调
        ctx.globalAlpha = 0.3 * (1 - k * 0.6);
        ctx.fillStyle = CREAM;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.4 - k * 1.2, 0, TAU);
        ctx.fill();
        continue;
      }
      if (seg.kind === 'shot') {
        // 主弹道：越远越淡越小，但始终看得清
        ctx.globalAlpha = Math.max(0.45, 0.95 - k * 0.42);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8.2 - k * 3.2, 0, TAU);
        ctx.fillStyle = '#fffdf0';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = INK;
        ctx.stroke();
        continue;
      }
      // 撞穿 / 弹簧反弹后的续飞段：空心金点 = "这段是估算的"
      ctx.globalAlpha = Math.max(0.34, 0.82 - k * 0.34);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6.4 - k * 2.4, 0, TAU);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = seg.kind === 'spring' ? GOLD : GOLD_DARK;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 预计首个碰撞点：菱形 + 短芒，撞穿/弹簧/小鸟各有自己的小符号 */
function drawHitMarker(ctx: CanvasRenderingContext2D, plan: AimPlan, t: number): void {
  if (!plan.hasFirstHit) return;
  const { x, y } = plan.firstHit;
  const kind = plan.firstHitKind;
  const pulse = 0.5 + Math.sin(t * 0.008) * 0.5;
  const rr = 12.5;
  const core = kind === 'bird' ? ALARM : kind === 'spring' ? GOLD : GOLD_DARK;

  ctx.save();
  ctx.translate(x, y);
  // 菱形体
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(0, -rr);
  ctx.lineTo(rr, 0);
  ctx.lineTo(0, rr);
  ctx.lineTo(-rr, 0);
  ctx.closePath();
  ctx.fillStyle = CREAM;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // 内部符号
  ctx.beginPath();
  if (kind === 'spring') {
    // 两道向上的人字：这里是会被弹起来的地方
    ctx.moveTo(-5, 2);
    ctx.lineTo(0, -4);
    ctx.lineTo(5, 2);
    ctx.strokeStyle = core;
    ctx.lineWidth = 3;
  } else if (kind === 'bird') {
    // 感叹号：小心，这只鸟会在半路拦你
    ctx.moveTo(0, -5);
    ctx.lineTo(0, 2);
    ctx.strokeStyle = core;
    ctx.lineWidth = 3.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 6, 1.9, 0, TAU);
    ctx.fillStyle = core;
    ctx.fill();
  } else if (kind === 'smash') {
    // 裂纹：这块会被撞穿，轨迹会接着往里走
    ctx.moveTo(-3.6, -5);
    ctx.lineTo(1.2, -0.6);
    ctx.lineTo(-1.4, 1.6);
    ctx.lineTo(3.6, 5);
    ctx.strokeStyle = core;
    ctx.lineWidth = 2.6;
  } else {
    ctx.arc(0, 0, 4.6, 0, TAU);
    ctx.fillStyle = core;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
  }
  if (kind !== 'bird') ctx.stroke();

  // 四向短芒（鸟用外圈脉冲代替，避免提示叠太多）
  if (kind !== 'bird') {
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i += 1) {
      const a = (Math.PI / 2) * i + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (rr + 3), Math.sin(a) * (rr + 3));
      ctx.lineTo(Math.cos(a) * (rr + 9), Math.sin(a) * (rr + 9));
      ctx.stroke();
    }
  } else {
    ctx.globalAlpha = 0.45 * (1 - pulse);
    ctx.beginPath();
    ctx.arc(0, 0, rr + 6 + pulse * 9, 0, TAU);
    ctx.lineWidth = 3;
    ctx.strokeStyle = ALARM;
    ctx.stroke();
  }
  ctx.restore();
}

/** 预计最终落点：只有和撞点不重合时才画，圆环 + 落地阴影 */
function drawLandingMarker(ctx: CanvasRenderingContext2D, plan: AimPlan, t: number): void {
  if (plan.landingKind === 'none' || plan.landingKind === 'out') return;
  const { x, y } = plan.landing;
  const hit = plan.firstHit;
  if (plan.hasFirstHit && Math.hypot(hit.x - x, hit.y - y) < 18) return;

  const pulse = 0.5 + Math.sin(t * 0.008) * 0.5;
  const rr = 15;
  const sure = plan.landingSure;
  ctx.save();
  if (plan.landingKind === 'ground') {
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(x, y + rr * 0.95, rr * 1.05, rr * 0.34, 0, 0, TAU);
    ctx.fill();
  }
  // 估算落点：半透明虚环 + 只有外圈，别让人以为这就是最终位置
  ctx.globalAlpha = sure ? 1 : 0.62;
  ctx.beginPath();
  ctx.arc(x, y, rr, 0, TAU);
  ctx.fillStyle = sure ? CREAM : 'rgba(255,247,226,0.55)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.setLineDash(sure ? [] : [7, 6]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(x, y, rr * 0.46, 0, TAU);
  ctx.fillStyle = sure ? GOLD : 'rgba(255,199,46,0.5)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();

  ctx.globalAlpha = 0.5 * (1 - pulse);
  ctx.beginPath();
  ctx.arc(x, y, rr + 5 + pulse * 9, 0, TAU);
  ctx.lineWidth = 3;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  ctx.restore();
}

/** 车轮擦碰提示：一个不起眼的棕色小环，说明"这一发会蹭到车轮"（不影响弹道结论） */
function drawWheelHint(ctx: CanvasRenderingContext2D, plan: AimPlan): void {
  if (!plan.wheelHit) return;
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(plan.wheelAt.x, plan.wheelAt.y, 13, 0, TAU);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = BAND_FACE;
  ctx.stroke();
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.arc(plan.wheelAt.x, plan.wheelAt.y, 5, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = CREAM;
  ctx.stroke();
  ctx.restore();
}

/** 小鸟拦截提示：在"猪和鸟会相遇"的位置画一个警报圈，不是鸟的当前位置 */
function drawInterceptHint(ctx: CanvasRenderingContext2D, plan: AimPlan, t: number): void {
  if (!plan.intercept.on) return;
  const { x, y } = plan.intercept;
  const pulse = 0.5 + Math.sin(t * 0.012) * 0.5;
  const rr = 20;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(x, y, rr, 0, TAU);
  ctx.lineWidth = 2.6;
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = ALARM;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.32 + pulse * 0.28;
  ctx.beginPath();
  ctx.arc(x, y, rr + 5 + pulse * 6, 0, TAU);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  ctx.restore();
}

/** 鸟蛋目标：常驻淡环 + 可达时的高亮（直击绿实线 / 可能滚入绿虚线，被挡住不给绿） */
function drawEggTarget(
  ctx: CanvasRenderingContext2D,
  egg: { x: number; y: number; r: number } | null,
  reach: EggReach,
  t: number,
): void {
  if (!egg) return;
  const pulse = 0.5 + Math.sin(t * 0.006) * 0.5;
  const base = egg.r + 10;
  ctx.save();

  // 常驻目标环（米白 + 深描边）：只说明"这里是鸟蛋"，不代表打得中
  ctx.globalAlpha = 0.42;
  ctx.beginPath();
  ctx.arc(egg.x, egg.y, base + 4, 0, TAU);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(egg.x, egg.y, base, 0, TAU);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = CREAM;
  ctx.stroke();

  if (reach === 'uncertain') {
    // 擦边 / 高速滚行：给一圈金虚线，明确表示"可能碰到，但算不准"
    ctx.globalAlpha = 0.3 + pulse * 0.28;
    ctx.beginPath();
    ctx.arc(egg.x, egg.y, base + 2 + pulse * 3, 0, TAU);
    ctx.lineWidth = 2.4;
    ctx.setLineDash([7, 8]);
    ctx.strokeStyle = GOLD;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (reach === 'direct' || reach === 'roll') {
    const direct = reach === 'direct';
    ctx.globalAlpha = direct ? 0.92 : 0.55;
    ctx.beginPath();
    ctx.arc(egg.x, egg.y, base + 2, 0, TAU);
    ctx.lineWidth = direct ? 3.6 : 2.6;
    if (!direct) ctx.setLineDash([9, 7]);
    ctx.strokeStyle = GREEN;
    ctx.stroke();
    ctx.setLineDash([]);

    // 外圈脉冲：直击更亮，滚入更含蓄
    ctx.globalAlpha = (direct ? 0.55 : 0.3) * (1 - pulse);
    ctx.beginPath();
    ctx.arc(egg.x, egg.y, base + 8 + pulse * 12, 0, TAU);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = GREEN;
    ctx.stroke();

    // 四向小箭头：直击时给出明确的"进门"感觉
    if (direct) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = GREEN;
      for (let i = 0; i < 4; i += 1) {
        const a = (Math.PI / 2) * i + Math.PI / 4;
        const bx = egg.x + Math.cos(a) * (base + 3);
        const by = egg.y + Math.sin(a) * (base + 3);
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(a) * 6, by + Math.sin(a) * 6);
        ctx.lineTo(bx + Math.cos(a + 2.4) * 5, by + Math.sin(a + 2.4) * 5);
        ctx.lineTo(bx + Math.cos(a - 2.4) * 5, by + Math.sin(a - 2.4) * 5);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** 拉杆边界：满拉半径的虚线圈，拖到极限时变金并起光 */
export function drawPullLimit(ctx: CanvasRenderingContext2D, anchor: Vec, power: number): void {
  const atMax = power > 0.97;
  ctx.save();
  ctx.setLineDash([10, 10]);
  ctx.lineWidth = 3;
  if (atMax) {
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = GOLD;
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 12;
  } else {
    ctx.globalAlpha = 0.3 + power * 0.2;
    ctx.strokeStyle = DASH_INK;
  }
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, MAX_PULL, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * 皮筋 / 绳带的动态形变：从发射点（抛兜口）向后拉出两根带子，
 * 拉得越远越细越直，蓄力满时绷成一条直线；末端的皮兜随拖拽点转动。
 * `pull` 是拖拽点（世界坐标），与发射点的连线方向就是"被拉的方向"。
 */
export function drawPullBand(
  ctx: CanvasRenderingContext2D,
  anchor: Vec,
  pull: Vec,
  power: number,
): void {
  const dx = pull.x - anchor.x;
  const dy = pull.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  // 松弛时下垂，绷紧时打直
  const sag = (1 - power) * 12 + 2;
  const spread = 12 - power * 3;
  const bandW = 11 - power * 5.5;

  const strand = (side: number): void => {
    const ax = anchor.x + nx * side * spread;
    const ay = anchor.y + ny * side * spread;
    const bx = pull.x + nx * side * (spread - 3);
    const by = pull.y + ny * side * (spread - 3);
    const cx = (ax + bx) / 2 + nx * side * sag;
    const cy = (ay + by) / 2 + ny * side * sag;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, cy, bx, by);
    ctx.lineCap = 'round';
    ctx.strokeStyle = BAND_OUTLINE;
    ctx.lineWidth = bandW + 4;
    ctx.stroke();
    ctx.strokeStyle = side < 0 ? BAND_FACE : BAND_DARK;
    ctx.lineWidth = bandW;
    ctx.stroke();
    ctx.strokeStyle = BAND_LIGHT;
    ctx.lineWidth = Math.max(1.6, bandW * 0.28);
    ctx.stroke();
  };

  ctx.save();
  ctx.globalAlpha = 0.95;
  strand(-1);
  strand(1);

  // 末端的皮兜（跟着拖拽方向转）
  const angle = Math.atan2(uy, ux);
  ctx.translate(pull.x + ux * 4, pull.y + uy * 4);
  ctx.rotate(angle);
  ctx.fillStyle = BAND_FACE;
  ctx.strokeStyle = BAND_OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  const hw = 16;
  const hh = 11;
  const rad = 6;
  ctx.moveTo(-hw + rad, -hh);
  ctx.lineTo(hw - rad, -hh);
  ctx.quadraticCurveTo(hw, -hh, hw, -hh + rad);
  ctx.lineTo(hw, hh - rad);
  ctx.quadraticCurveTo(hw, hh, hw - rad, hh);
  ctx.lineTo(-hw + rad, hh);
  ctx.quadraticCurveTo(-hw, hh, -hw, hh - rad);
  ctx.lineTo(-hw, -hh + rad);
  ctx.quadraticCurveTo(-hw, -hh, -hw + rad, -hh);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(214,160,96,0.45)';
  panel(ctx, -9, -6, 8, 12, 3);
  ctx.fill();
  ctx.restore();
}

/**
 * 力度 / 角度读数（屏幕空间，画在世界之外的固定位置，避开四角 HUD）。
 * 底部居中：上方是预测结论（直击 / 拦截 / 被挡住），下方左边角度、右边力度条。
 */
export function drawAimReadout(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  angleDeg: number,
  power: number,
  status: AimStatus | null,
): void {
  const w = Math.max(196, Math.min(244, Math.round(cssW) - 48));
  const h = 62;
  const x = Math.round(cssW / 2 - w / 2);
  const y = Math.round(cssH - h - 96);
  const pct = Math.round(Math.min(1, Math.max(0, power)) * 100);
  const deg = Math.round(angleDeg);

  ctx.save();
  // 底部厚度（落影）
  ctx.fillStyle = 'rgba(58,42,24,0.34)';
  panel(ctx, x, y + 6, w, h, 16);
  ctx.fill();
  // 面板
  ctx.fillStyle = CREAM;
  panel(ctx, x, y, w, h, 16);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // 奶油内环
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  panel(ctx, x + 4, y + 4, w - 8, h - 8, 12);
  ctx.stroke();

  // 角度
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#8a6a3c';
  ctx.font = `700 11px ${FONT_STACK}`;
  ctx.fillText('角度', x + 16, y + 24);
  ctx.fillStyle = '#3a2a18';
  ctx.font = `900 26px ${FONT_STACK}`;
  ctx.fillText(`${deg}°`, x + 16, y + 50);

  // 分隔线
  ctx.strokeStyle = 'rgba(58,42,24,0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 100, y + 14);
  ctx.lineTo(x + 100, y + h - 14);
  ctx.stroke();

  // 力度条
  const barX = x + 114;
  const barW = w - 114 - 16;
  const barY = y + 32;
  ctx.fillStyle = '#8a6a3c';
  ctx.font = `700 11px ${FONT_STACK}`;
  ctx.fillText('力度', barX, y + 24);
  ctx.textAlign = 'right';
  ctx.fillStyle = pct >= 97 ? '#b5660a' : '#3a2a18';
  ctx.font = `900 12px ${FONT_STACK}`;
  ctx.fillText(`${pct}%`, x + w - 16, y + 24);
  ctx.textAlign = 'left';

  // 轨道
  ctx.fillStyle = '#e6dbc4';
  panel(ctx, barX, barY, barW, 16, 8);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // 填充
  const fillW = Math.max(3, (barW - 6) * Math.min(1, power));
  const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  grad.addColorStop(0, '#ffe066');
  grad.addColorStop(0.62, GOLD);
  grad.addColorStop(1, pct >= 97 ? '#e88c14' : GOLD_DARK);
  ctx.fillStyle = grad;
  panel(ctx, barX + 3, barY + 3, fillW, 10, 5);
  ctx.fill();
  ctx.restore();

  if (status) drawStatusChip(ctx, cssW / 2, y - 20, status);
}

/** 预测结论小牌子：一句话说清"这一发会怎样"，不占画面中央 */
function drawStatusChip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  status: AimStatus,
): void {
  const tone = TONE_COLOR[status.tone];
  ctx.save();
  ctx.font = `900 13px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const textW = ctx.measureText(status.text).width;
  const h = 30;
  const w = Math.round(textW + 40);
  const x = Math.round(cx - w / 2);
  const y = Math.round(cy - h / 2);

  ctx.fillStyle = 'rgba(58,42,24,0.32)';
  panel(ctx, x, y + 4, w, h, 15);
  ctx.fill();
  ctx.fillStyle = CREAM;
  panel(ctx, x, y, w, h, 15);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x + 15, cy, 4.6, 0, TAU);
  ctx.fillStyle = tone.dot;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = INK;
  ctx.stroke();

  ctx.fillStyle = tone.text;
  ctx.fillText(status.text, x + 26, cy + 0.5);
  ctx.restore();
}

function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/**
 * 飞行速度线：沿速度反方向拖出三根米白短线，越快越长越实。
 * 只在真正高速时出现（慢放里也不会糊成一片）。
 */
export function drawSpeedLines(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  vx: number,
  vy: number,
  speed: number,
  radius: number,
): void {
  if (speed < 9) return;
  const k = Math.min(1, (speed - 9) / 20);
  const ux = vx / speed;
  const uy = vy / speed;
  const nx = -uy;
  const ny = ux;
  const len = 16 + k * 40;
  const offsets = [-0.55, 0, 0.55];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#fffdf0';
  for (let i = 0; i < offsets.length; i += 1) {
    const off = offsets[i] * radius;
    const sx = x + nx * off - ux * radius * 0.95;
    const sy = y + ny * off - uy * radius * 0.95;
    const shrink = i === 1 ? 1 : 0.7;
    ctx.globalAlpha = 0.3 * k * (i === 1 ? 1 : 0.85);
    ctx.lineWidth = i === 1 ? 4 : 3;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - ux * len * shrink, sy - uy * len * shrink);
    ctx.stroke();
  }
  ctx.restore();
}
