import type { BirdType, PigType } from './types';

/* ============================================================
 * 精灵图配置：把用户提供的序列帧接到现有 Canvas 渲染管线上
 * ------------------------------------------------------------
 * 约定（与 DESIGN.md「素材与实现备注」一致）：
 *   - 每种角色一张横向序列图，单帧 256×256
 *   - 猪：5 帧，帧 0/1/2 待机、3/4 飞行；整图 1280×256
 *   - 鸟：6 帧，帧 0/1/2 待机、3/4/5 扇翅；整图 1536×256
 *   - 一律朝 +x 作画；鸟在引擎里靠 flipX 镜像成朝左，不用画两套
 *   - 每套图用 bodySize / centerX / centerY 标定本体直径与圆心，
 *     把精灵对齐到物理半径并保持各角色视觉大小一致
 *   - 只有一套绘制路径：图片没到（或未在 manifest 登记）就先不画，
 *     加载完下一帧自动出现，不再维护矢量画的备用版本
 * ============================================================ */

export interface SpriteSheetSpec {
  /** public 下的绝对路径 */
  src: string;
  /** 横向帧数 */
  frames: number;
  frameW: number;
  frameH: number;
  /** 帧内本体的最大外径，px；用来把精灵缩放到物理直径 2r */
  bodySize: number;
  /** 本体圆心的帧内坐标，默认帧中心 */
  centerX: number;
  centerY: number;
  /** 素材朝右、游戏内需要朝左时置 true（镜像绘制） */
  flipX?: boolean;
}

/**
 * 标定方法（换新素材时照做）：
 *   取帧 0（中性待机姿势），量本体（不含帽子/胡子/翅膀尖）的外接框，
 *   bodySize = max(宽, 高)，centerX / centerY = 外接框中心。
 * 戴帽子/头饰/头盔的角色本体偏下，必须改 centerY，否则看起来会陷进地面。
 */
export const PIG_SHEETS: Record<PigType, SpriteSheetSpec> = {
  normal: { src: '/sprites/pig/normal.png', frames: 5, frameW: 256, frameH: 256, bodySize: 194, centerX: 128, centerY: 128 },
  // 厨师猪：干净重导版（原 assets/五款绿猪厨师表情精灵图-1.png，2172×724 → 归一化到 5×256 帧）
  // 5 帧的本体圆心已统一对齐到 (128,168)，动画不再有逐帧左右跳动；bodySize 沿用 148 保持观感大小
  chef: { src: '/sprites/pig/chef.png', frames: 5, frameW: 256, frameH: 256, bodySize: 148, centerX: 128, centerY: 168 },
  prof: { src: '/sprites/pig/prof.png', frames: 5, frameW: 256, frameH: 256, bodySize: 193, centerX: 127, centerY: 128 },
  helmet: { src: '/sprites/pig/helmet.png', frames: 5, frameW: 256, frameH: 256, bodySize: 190, centerX: 128, centerY: 136 },
  king: { src: '/sprites/pig/king.png', frames: 5, frameW: 256, frameH: 256, bodySize: 150, centerX: 135, centerY: 160 },
  spy: { src: '/sprites/pig/spy.png', frames: 5, frameW: 256, frameH: 256, bodySize: 166, centerX: 136, centerY: 149 },
};

export const BIRD_SHEETS: Record<BirdType, SpriteSheetSpec> = {
  // 红鸟：帧 0/1/2 待机（眨眼），帧 3/4/5 是更平的扑击姿（帧 5 拉伸最长）
  red: { src: '/sprites/bird/red.png', frames: 6, frameW: 256, frameH: 256, bodySize: 160, centerX: 126, centerY: 146, flipX: true },
  // 黄鸟：三角身体，本体按黄色区块外接框量（宽 173 / 高 126），本体偏下
  yellow: { src: '/sprites/bird/yellow.png', frames: 6, frameW: 256, frameH: 256, bodySize: 173, centerX: 127, centerY: 130, flipX: true },
  // 蓝鸟：圆身体 + 头顶三根羽冠，本体按蓝色圆量（直径 162），羽冠不计入外径
  blue: { src: '/sprites/bird/blue.png', frames: 6, frameW: 256, frameH: 256, bodySize: 162, centerX: 129, centerY: 140, flipX: true },
};

export type AnimState = 'idle' | 'fly';

/* ---------------- 发射器：大炮（单张图集，不走动画器） ---------------- */

/**
 * 发射器图集（大炮 / 投石车）：6 帧 256×256 横向拼接（整图 1536×256）。
 * 没有呼吸/飞行两态，直接用「开火序列 + 逐帧停留」这张表驱动。
 * 装载点 anchor 对齐关卡发射锚点，底座底边 bottomY 对齐底座顶面，两张表就能把图摆正。
 */
export interface LauncherSheet {
  src: string;
  frames: number;
  frameW: number;
  frameH: number;
  /** 装载点（炮口中心 / 抛兜中心）在帧内的坐标：对齐世界发射点，小猪坐这一格 */
  anchorX: number;
  anchorY: number;
  /** 底座底边（帧内 y）：用来把发射器"坐"在炮台/土坡上 */
  bottomY: number;
  /** 帧像素 → 世界像素 */
  scale: number;
  /** 开火/投掷帧序列与逐帧停留 ms */
  fireFrames: number[];
  fireHolds: number[];
  /** 素材朝向与发射方向相反时置 true（绘制时以装载点为中心水平镜像） */
  flipX?: boolean;
}

/**
 * 大炮：0 待机；1/2 引信火花渐大；3 炮口爆焰；4 余烟；5 是后坐沉降姿态（不用，避免和待机帧互跳）。
 * scale 1.72 时炮口内径≈小猪直径，猪正好卡在炮口。
 */
export const CANNON: LauncherSheet = {
  src: '/sprites/cannon/cannon.png',
  frames: 6,
  frameW: 256,
  frameH: 256,
  anchorX: 162,
  anchorY: 123,
  bottomY: 240,
  scale: 1.72,
  fireFrames: [1, 2, 3, 4],
  fireHolds: [80, 80, 130, 320],
};

/**
 * 投石车：0 待机（抛臂放平、兜里装着猪）；1/2 抛臂缓缓抬起（蓄力）；3 抛臂甩到顶（出手）；
 * 4 抛臂回落。帧 5 与帧 0 同姿，用不上。
 * 出手瞬间从 3 → 4 → 待机，正好对上小猪离兜的时机。
 */
export const TREBUCHET: LauncherSheet = {
  src: '/sprites/trebuchet/trebuchet.png',
  frames: 6,
  frameW: 256,
  frameH: 256,
  anchorX: 204,
  anchorY: 177,
  bottomY: 216,
  scale: 1.45,
  fireFrames: [3, 4],
  fireHolds: [120, 220],
  flipX: true,
};

/** 一次发射动画的总时长（ms） */
export function launcherFireMs(sheet: LauncherSheet): number {
  return sheet.fireHolds.reduce((a, b) => a + b, 0);
}

/** 发射后 elapsed 毫秒应该显示哪一帧；null = 动画结束，回待机帧 0 */
export function launcherFireFrame(sheet: LauncherSheet, elapsed: number): number | null {
  let t = elapsed;
  for (let i = 0; i < sheet.fireFrames.length; i += 1) {
    if (t < sheet.fireHolds[i]) return sheet.fireFrames[i];
    t -= sheet.fireHolds[i];
  }
  return null;
}

export interface SpriteClip {
  /** 用到的帧号（对应序列图中的序号） */
  frames: number[];
  /** 每帧停留毫秒（与 frames 一一对应）。不等长 → 有"长-短-短"的节奏，不是机械匀速 */
  holds: number[];
}

/**
 * 节奏表：想改快慢只动这里，别处不用碰。
 *   idle：[420, 260, 260] = 一轮约 0.94s 的慢呼吸
 *   fly ：猪 [140, 110] 一轮 250ms；引擎会按速度再微调（快飞稍快、慢飞稍慢）
 */
export const PIG_CLIPS: Record<AnimState, SpriteClip> = {
  idle: { frames: [0, 1, 2], holds: [420, 260, 260] },
  fly: { frames: [3, 4], holds: [140, 110] },
};

/** 鸟：待机是小幅振翅，飞行是完整扇翅循环（上-中-下三帧） */
export const BIRD_CLIPS: Record<AnimState, SpriteClip> = {
  idle: { frames: [0, 1, 2], holds: [380, 240, 240] },
  fly: { frames: [3, 4, 5], holds: [95, 105, 95] },
};

/** 缺帧补间幅度：帧数少时靠极轻微的非等比缩放补足"活着的"感觉 */
export const PIG_MOTION = {
  /** 待机纵向呼吸幅度（±2%） */
  breath: 0.02,
  /** 飞行时沿速度方向的拉伸上限（6%） */
  stretch: 0.06,
};

/** 鸟的补间幅度：扇翅时身体轻微上下浮动，别像贴纸 */
export const BIRD_MOTION = {
  breath: 0.015,
  stretch: 0.04,
};

/** 状态切换时的交叉淡入时长：飞行动画不带翅膀，直接硬切会"啪"地掉一对翅膀 */
export const SPRITE_FADE_MS = 100;

/* ============================================================
 * 角色动作状态层（不新增素材也能有"活着"的反应）
 * ------------------------------------------------------------
 * 帧只有待机（idle 组）和飞行（fly 组）两套，所以**动作状态不改帧**，
 * 只在绘制层叠加旋转/缩放/位移——绝不碰刚体位置与角度。
 * 以后补了真实动作帧，只需把这里的 clip 指向新的帧组，调用方一行不用改。
 * ============================================================ */

export type PigAnimState = 'idle' | 'aim' | 'launch' | 'fly' | 'hit' | 'land' | 'skill' | 'win' | 'defeat';
export type BirdAnimState = 'idle' | 'fly' | 'hit' | 'fall';
export type SpriteState = PigAnimState | BirdAnimState;

/** 动作状态叠加到绘制层的姿态（都是"视觉层"，与物理无关） */
export interface PoseAdd {
  /** 额外旋转（rad），叠加在真实刚体角度之上 */
  rot: number;
  /** 沿朝向的缩放倍率 */
  sx: number;
  /** 垂直缩放倍率 */
  sy: number;
  /** 视觉位移（世界 px，正右正下） */
  ox: number;
  oy: number;
}

export interface SpriteStateDef {
  /** 用哪套帧（现有素材只有这两组） */
  clip: AnimState;
  /** 单次动作时长 ms；缺省 = 循环 */
  once?: number;
  /** p：当前状态进度 0~1（单次动作即"已经播了多少"）；charge：蓄力 0~1；t：状态内秒数 */
  pose: (p: number, charge: number, t: number) => Partial<PoseAdd>;
}

/** 不加任何姿态的状态直接用它（返回同一个空对象，零分配） */
const POSE_NONE: Partial<PoseAdd> = {};
const poseNone = (): Partial<PoseAdd> => POSE_NONE;

/**
 * 猪的动作状态表。关键约束：
 *   1. 只用 idle / fly 两套帧，绝不把飞行帧硬塞进受击动作；
 *   2. 幅度克制——小猪本体只有 52px 直径，超过 20% 的形变会糊成一团；
 *   3. 所有一次性动作到时由动画器自动回落（once），不靠外部计时器猜。
 */
export const PIG_STATES: Record<PigAnimState, SpriteStateDef> = {
  // 待机：帧本身三下呼吸，这里只补一点点极慢的左右晃动，避免"贴纸感"
  idle: { clip: 'idle', pose: (_p, _c, t) => ({ rot: Math.sin(t * 1.1) * 0.012 }) },
  // 瞄准：随拉伸力度压低身体、往前探，力度越大越明显
  aim: {
    clip: 'idle',
    pose: (_p, c) => ({ sy: 1 - 0.1 * c, sx: 1 + 0.07 * c, rot: -0.05 * c }),
  },
  // 发射：出膛瞬间纵向抽长、横向收紧，200ms 内收回
  launch: {
    clip: 'fly',
    once: 200,
    pose: (p) => {
      const k = 1 - p;
      return { sx: 1 + 0.16 * k, sy: 1 - 0.14 * k, rot: -0.08 * k };
    },
  },
  fly: { clip: 'fly', pose: poseNone },
  // 受击：横向撑开 + 抖动，220ms
  hit: {
    clip: 'idle',
    once: 220,
    pose: (p) => {
      const k = 1 - p;
      return { sx: 1 + 0.2 * k, sy: 1 - 0.18 * k, rot: Math.sin(p * 34) * 0.22 * k };
    },
  },
  // 落地：压扁后回弹，260ms
  land: {
    clip: 'idle',
    once: 260,
    pose: (p) => {
      const damp = Math.sin(p * Math.PI * 1.6) * (1 - p);
      return { sy: 1 - 0.22 * damp, sx: 1 + 0.16 * damp };
    },
  },
  // 技能：鼓气→爆发，320ms；护盾/尾焰等专属表现由 draw 层按 state 叠加
  skill: {
    clip: 'fly',
    once: 320,
    pose: (p) => {
      const k = Math.sin(p * Math.PI);
      return { sx: 1 + 0.1 * k, sy: 1 + 0.14 * k, rot: -0.06 * k };
    },
  },
  // 胜利：原地蹦跳（循环）
  win: {
    clip: 'idle',
    pose: (_p, _c, t) => ({ oy: -Math.abs(Math.sin(t * 5.2)) * 5, rot: Math.sin(t * 5.2) * 0.1 }),
  },
  // 沮丧：歪头缓慢摇晃（循环）
  defeat: {
    clip: 'idle',
    pose: (_p, _c, t) => ({ rot: 0.2 + Math.sin(t * 1.8) * 0.045, oy: 1.5 }),
  },
};

/** 鸟的动作状态表：受击/坠落靠一次性的挤压 + 引擎给的真实自转 */
export const BIRD_STATES: Record<BirdAnimState, SpriteStateDef> = {
  idle: { clip: 'idle', pose: poseNone },
  fly: { clip: 'fly', pose: poseNone },
  hit: {
    clip: 'idle',
    once: 200,
    pose: (p) => {
      const k = 1 - p;
      return { sx: 1 + 0.24 * k, sy: 1 - 0.2 * k };
    },
  },
  fall: { clip: 'fly', pose: (_p, _c, t) => ({ rot: Math.sin(t * 3) * 0.12 }) },
};

/** drawPig / drawBird 需要的最小动画信息（姿态字段都是绘制层叠加，不改刚体） */
export interface SpriteAnimFrame {
  state: SpriteState;
  frame: number;
  /** 沿本体 +x（朝向前方）的缩放 */
  scaleX: number;
  /** 垂直方向缩放 */
  scaleY: number;
  /** 切换瞬间的上一帧，用半透明垫在下面做交叉淡入 */
  fade?: { frame: number; alpha: number };
  /** 额外旋转（rad），叠加在真实刚体角度上 */
  rot?: number;
  /** 视觉位移（世界 px） */
  ox?: number;
  oy?: number;
}

/* ---------------- 资源加载（按 manifest 登记，缺图不 404） ---------------- */

const images = new Map<string, HTMLImageElement>();
const loaders = new Map<string, Promise<void>>();
const readyWaiters = new Map<string, Array<() => void>>();

/**
 * 资源根路径前缀：Next 页面里图上都是 `/sprites/...` 绝对路径（base 为 ''），
 * 而「离线单文件版」用 file:// 打开时绝对路径会指到磁盘根，必须改成相对路径（base 为 '.'）。
 */
let basePath = '';

export function setSpriteBase(prefix: string): void {
  basePath = prefix;
}

/**
 * manifest 读不到时的兜底登记表（file:// 下 fetch 本地 JSON 会被浏览器拦掉）。
 * 正常走 http 时仍然以 manifest.json 为准，这里只在读取失败时补位。
 */
const FALLBACK_TYPES: Record<string, string[]> = {
  '/sprites/pig': ['normal', 'chef', 'helmet', 'king', 'spy', 'prof'],
  '/sprites/bird': ['red', 'yellow', 'blue'],
  '/sprites/cannon': ['cannon'],
  '/sprites/trebuchet': ['trebuchet'],
};

function flush(dir: string): void {
  const list = readyWaiters.get(dir) ?? [];
  readyWaiters.set(dir, []);
  list.forEach((fn) => fn());
}

function preloadGroup(dir: string, sheets: Record<string, { src: string }>): Promise<void> {
  const existing = loaders.get(dir);
  if (existing) return existing;
  if (typeof window === 'undefined' || typeof Image === 'undefined') return Promise.resolve();

  // file:// 下浏览器不允许 fetch 本地 JSON，直接走兜底登记表，避免控制台刷一堆报错
  const canFetch = location.protocol !== 'file:';
  const manifest: Promise<string[] | null> = canFetch
    ? fetch(`${basePath}${dir}/manifest.json`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
        .then((data: unknown) => {
          const raw = (data as { types?: unknown } | null)?.types;
          return Array.isArray(raw)
            ? raw.filter((t): t is string => typeof t === 'string')
            : null;
        })
    : Promise.resolve(null);

  const job = manifest
    .then((fromManifest) => {
      const types = fromManifest ?? FALLBACK_TYPES[dir] ?? [];
      const wanted = types.filter((t) => t in sheets).map((t) => sheets[t]);
      return Promise.all(
        wanted.map(
          (spec) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => {
                images.set(spec.src, img);
                resolve();
              };
              img.onerror = () => resolve();
              img.src = `${basePath}${spec.src}`;
            }),
        ),
      );
    })
    .catch(() => undefined)
    .then(() => {
      flush(dir);
    });

  loaders.set(dir, job);
  return job;
}

/** 预加载猪的序列图（幂等） */
export function preloadPigSprites(): void {
  void preloadGroup('/sprites/pig', PIG_SHEETS);
}

/** 预加载鸟的序列图（幂等） */
export function preloadBirdSprites(): void {
  void preloadGroup('/sprites/bird', BIRD_SHEETS);
}

/** 猪的序列图：加载完成返回图片，否则 null（这一帧先不画） */
export function getPigSprite(type: PigType): HTMLImageElement | null {
  preloadPigSprites();
  return images.get(PIG_SHEETS[type].src) ?? null;
}

/** 精灵图的运行时地址（HUD 头像等用 CSS 背景显示同一张图） */
export function spriteUrl(src: string): string {
  return `${basePath}${src}`;
}

/** 鸟的序列图：加载完成返回图片，否则 null（这一帧先不画） */
export function getBirdSprite(kind: BirdType): HTMLImageElement | null {
  preloadBirdSprites();
  return images.get(BIRD_SHEETS[kind].src) ?? null;
}

/** 预加载大炮图集（幂等，只有大炮关才需要，但加载成本很低） */
export function preloadCannon(): void {
  void preloadGroup('/sprites/cannon', { cannon: CANNON });
}

/** 大炮图集：加载完成返回图片，否则 null（这一帧先不画） */
export function getCannonSprite(): HTMLImageElement | null {
  preloadCannon();
  return images.get(CANNON.src) ?? null;
}

/** 预加载投石车图集（幂等） */
export function preloadTrebuchet(): void {
  void preloadGroup('/sprites/trebuchet', { trebuchet: TREBUCHET });
}

/** 投石车图集：加载完成返回图片，否则 null（这一帧先不画） */
export function getTrebuchetSprite(): HTMLImageElement | null {
  preloadTrebuchet();
  return images.get(TREBUCHET.src) ?? null;
}

function whenGroupReady(dir: string, start: () => void): Promise<void> {
  start();
  const job = loaders.get(dir);
  if (!job) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const list = readyWaiters.get(dir) ?? [];
    list.push(resolve);
    readyWaiters.set(dir, list);
    void job.then(() => {
      const pending = readyWaiters.get(dir) ?? [];
      if (pending.includes(resolve)) flush(dir);
    });
  });
}

/** 猪的序列图加载结束（成功或失败都算）后 resolve，用于 UI 重绘 */
export function whenPigSpritesReady(): Promise<void> {
  return whenGroupReady('/sprites/pig', preloadPigSprites);
}

/* ---------------- 动画驱动 ---------------- */

type ClockFn = (dtMs: number) => void;

/**
 * HUD 头像共享时钟：多个小画布用同一个 dt 推进，
 * 保证左下角猪队列的呼吸节奏和场上小猪是"同一个心跳"。
 */
class SpriteClock {
  private subs = new Set<ClockFn>();
  private raf = 0;
  private last = 0;

  private readonly loop = (now: number): void => {
    const dt = this.last ? now - this.last : 16.7;
    this.last = now;
    this.subs.forEach((fn) => fn(dt));
    this.raf = requestAnimationFrame(this.loop);
  };

  subscribe(fn: ClockFn): () => void {
    this.subs.add(fn);
    if (!this.raf && typeof requestAnimationFrame === 'function') {
      this.last = 0;
      this.raf = requestAnimationFrame(this.loop);
    }
    return () => {
      this.subs.delete(fn);
      if (!this.subs.size && this.raf) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      }
    };
  }
}

export const spriteClock = new SpriteClock();

/**
 * 单个角色的帧动画器：每个实例一份，不能像示例代码那样用全局单例，
 * 否则同屏多个角色（发射器上的猪 + 飞行中的猪 + 一圈蓝鸟）会抢同一个 frame。
 */
export class SpriteAnimator {
  state: SpriteState = 'idle';
  frame: number;
  /** 当前帧内进度 0~1 */
  progress = 0;
  private clipIndex = 0;
  private acc = 0;
  /** 整轮循环走到的位置（ms），用于驱动平滑的呼吸缩放 */
  private cycle = 0;
  private speed = 0;
  /** 上一状态的帧与剩余淡入时间：0 表示没有过渡 */
  private fadeFrame = -1;
  private fadeT = 0;
  /** 当前状态已播时长（ms）与单次动作总时长（0 = 循环） */
  private stateT = 0;
  private onceMs = 0;
  /** 单次动作播完后回落到哪个状态 */
  private afterState: SpriteState | null = null;
  /** 蓄力比例 0~1，只有 aim 用得到 */
  private charge = 0;

  constructor(
    private readonly clips: Record<AnimState, SpriteClip>,
    private readonly motion: { breath: number; stretch: number },
    private readonly states: Record<string, SpriteStateDef>,
    /** 相位偏移 ms：同屏多个同种角色错开一点，避免整齐划一像复印机 */
    private readonly phaseMs = 0,
  ) {
    this.frame = clips.idle.frames[0];
    this.acc = this.phaseOf('idle');
  }

  /** 当前状态用哪套帧（新状态都复用 idle / fly 两组） */
  private clipOf(state: SpriteState): AnimState {
    return this.states[state]?.clip ?? 'idle';
  }

  private defOf(state: SpriteState): SpriteStateDef {
    return this.states[state] ?? { clip: 'idle', pose: poseNone };
  }

  private phaseOf(clip: AnimState): number {
    const total = this.clips[clip].holds.reduce((a, b) => a + b, 0);
    return total ? this.phaseMs % total : 0;
  }

  reset(): void {
    this.state = 'idle';
    this.clipIndex = 0;
    this.acc = this.phaseOf('idle');
    this.cycle = 0;
    this.speed = 0;
    this.progress = 0;
    this.fadeFrame = -1;
    this.fadeT = 0;
    this.stateT = 0;
    this.onceMs = 0;
    this.afterState = null;
    this.charge = 0;
    this.frame = this.clips.idle.frames[0];
  }

  /**
   * 切到某个动作状态。
   *   opts.after：单次动作播完后回落的状态（默认按当前帧组推断）
   *   opts.restart：同状态也重新播（连击受击时用）
   */
  playState(next: SpriteState, opts: { after?: SpriteState; restart?: boolean } = {}): void {
    if (next === this.state && !opts.restart) {
      this.afterState = opts.after ?? this.afterState;
      return;
    }
    const clip = this.clipOf(next);
    // 记下旧帧，做一次交叉淡入（飞行动画没有翅膀，硬切会突然掉一对翅膀）
    this.fadeFrame = this.frame;
    this.fadeT = SPRITE_FADE_MS;
    this.state = next;
    this.clipIndex = 0;
    this.acc = this.phaseOf(clip);
    this.cycle = 0;
    this.progress = 0;
    this.stateT = 0;
    this.onceMs = this.defOf(next).once ?? 0;
    this.afterState = opts.after ?? (this.onceMs > 0 ? (clip === 'fly' ? 'fly' : 'idle') : null);
    this.frame = this.clips[clip].frames[0];
  }

  /** 兼容旧调用：只关心"用哪套帧"时直接传 idle / fly */
  setState(next: AnimState): void {
    this.playState(next);
  }

  /** 当前状态是否还在播（一次性动作没播完） */
  get busy(): boolean {
    return this.onceMs > 0 && this.stateT < this.onceMs;
  }

  /**
   * dtMs：真实毫秒（不是物理步长）；speed：速率，用于飞行帧率的细微调速。
   * 用累加器 + 取模，掉帧/切标签页回来都不会越界或突然快进。
   */
  update(dtMs: number, speed = 0, charge = 0): void {
    this.speed = speed;
    this.charge = Math.max(0, Math.min(1, charge));
    const dt = Math.min(dtMs, 200);
    this.acc += dt;
    this.cycle += dt;
    this.stateT += dt;
    if (this.fadeT > 0) this.fadeT = Math.max(0, this.fadeT - dt);

    // 一次性动作播完 → 回落（受击/落地/技能都靠这条，不用外部计时器）
    if (this.onceMs > 0 && this.stateT >= this.onceMs) {
      this.playState(this.afterState ?? 'idle');
      this.fadeT = 0;
      this.fadeFrame = -1;
    }

    const clip = this.clips[this.clipOf(this.state)];
    let guard = 0;
    while (guard < 8) {
      const hold = this.holdOf(this.clipIndex);
      if (this.acc < hold) break;
      this.acc -= hold;
      this.clipIndex = (this.clipIndex + 1) % clip.frames.length;
      guard += 1;
    }
    this.frame = clip.frames[this.clipIndex];
    this.progress = Math.min(1, this.acc / this.holdOf(this.clipIndex));
  }

  /** 飞行时按速度给帧时长做 ±35% 的微调：飞得越快动得越急 */
  private holdOf(index: number): number {
    const clip = this.clips[this.clipOf(this.state)];
    const base = clip.holds[index];
    if (this.clipOf(this.state) !== 'fly') return base;
    const k = Math.min(this.speed / 26, 1);
    return base * (1.35 - 0.35 * k);
  }

  snapshot(): SpriteAnimFrame {
    const clip = this.clipOf(this.state);
    let scaleX = 1;
    let scaleY = 1;
    if (clip === 'idle') {
      // 呼吸：按时间走一条正弦，帧数少也不会显得是"定格三连"
      const phase = (this.cycle / 1000) * Math.PI * 2;
      const br = Math.sin(phase);
      scaleY = 1 + this.motion.breath * br;
      scaleX = 1 - this.motion.breath * 0.5 * br;
    } else {
      const k = Math.min(this.speed / 26, 1);
      scaleX = 1 + this.motion.stretch * k;
      scaleY = 1 - this.motion.stretch * 0.6 * k;
    }

    // 动作状态姿态：纯视觉叠加，绝不改刚体
    const def = this.defOf(this.state);
    const p = this.onceMs > 0 ? Math.min(1, this.stateT / this.onceMs) : 0;
    const pose = def.pose(p, this.charge, this.stateT / 1000);

    const fade =
      this.fadeT > 0 && this.fadeFrame >= 0
        ? { frame: this.fadeFrame, alpha: this.fadeT / SPRITE_FADE_MS }
        : undefined;
    return {
      state: this.state,
      frame: this.frame,
      scaleX: scaleX * (pose.sx ?? 1),
      scaleY: scaleY * (pose.sy ?? 1),
      fade,
      rot: pose.rot ?? 0,
      ox: pose.ox ?? 0,
      oy: pose.oy ?? 0,
    };
  }
}

/**
 * 六只猪的待机相位（ms）：同一套帧、不同的呼吸节拍起点，
 * 六个头像并排时不会像合唱团一样同时吸气（场上的猪会换，所以引擎侧固定用 0）。
 */
export const PIG_PHASE: Record<string, number> = {
  normal: 0,
  helmet: 170,
  king: 330,
  prof: 510,
  chef: 690,
  spy: 860,
};

/** 猪的动画器（节奏表 / 补间幅度固定为猪的那套） */
export class PigAnimator extends SpriteAnimator {
  constructor(phaseMs = 0) {
    super(PIG_CLIPS, PIG_MOTION, PIG_STATES, phaseMs);
  }
}

/** 鸟的动画器 */
export class BirdAnimator extends SpriteAnimator {
  constructor(phaseMs = 0) {
    super(BIRD_CLIPS, BIRD_MOTION, BIRD_STATES, phaseMs);
  }
}
