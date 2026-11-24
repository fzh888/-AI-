import Matter from 'matter-js';
import {
  createAimPlan,
  drawAimPlan,
  drawAimReadout,
  drawPullBand,
  drawPullLimit,
  drawSpeedLines,
  predictAim,
  type AimBird,
  type AimBox,
  type AimCircle,
  type AimPlan,
  type AimSpring,
  type AimStatus,
} from './aim';
import { drawBackdrop, drawBackdropScreen, drawClouds, drawWindTrees, preloadBackdrop } from './backdrop';
import {
  drawAmbient,
  drawBird,
  drawBlasts,
  drawBlock,
  drawCannon,
  drawEgg,
  drawFlashes,
  drawFloatTexts,
  drawForeground,
  drawOinkBubble,
  drawPig,
  drawPigDash,
  drawPigShield,
  drawPuffs,
  drawShards,
  drawShockwaves,
  drawSparks,
  drawSpring,
  drawTerrain,
  drawSling,
  drawTrebuchet,
  drawWheel,
  type BlastFx,
  type Cam,
  type FlashFx,
  type FloatTextFx,
  type PuffFx,
  type RingFx,
  type ShardFx,
  type SparkFx,
} from './draw';
import {
  GROUND_Y,
  LAUNCH_FACTOR,
  MAX_PULL,
  PIG_RADIUS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './levels';
import { CRACK_HEAVY, CRACK_HIT, MATERIALS } from './materials';
import { rateStars, totalScore } from './rating';
import { SPRING, TNT } from './mechanisms';
import {
  BirdAnimator,
  CANNON,
  PigAnimator,
  TREBUCHET,
  launcherFireFrame,
  launcherFireMs,
  preloadBirdSprites,
  preloadCannon,
  preloadPigSprites,
  preloadTrebuchet,
} from './sprite';
import type {
  BirdDef,
  BlockDef,
  GameState,
  Launcher,
  LevelDef,
  LoseInfo,
  Material,
  PigType,
  SfxName,
  Snapshot,
  SpringDef,
  WinResult,
} from './types';

const { Bodies, Body, Composite, Engine, Events, Vector } = Matter;

/** 撞飞一只小鸟的捕捉分 */
const BIRD_SCORE = 150;
/** 抢到鸟蛋的通关奖励 */
const EGG_BONUS = 1000;
/** 每剩一只小猪的奖励 */
const PIG_LEFT_BONUS = 200;
/** 弹弓撒放表演时长（皮兜从拉满弹回叉口） */
const SLING_RELEASE_MS = 260;
/** 世界重力：gravity.y = 3 ⇒ 每步速度增量 = 3 × 0.001 × 16.666² ≈ 0.833，预测与物理共用这一处 */
const GRAVITY_Y = 3;
const STEP = 16.666;
const GRAVITY_STEP = GRAVITY_Y * 0.001 * STEP * STEP;
/** 猪的空气阻力：Matter 每步把速度乘 (1 - frictionAir)，预测必须带上，否则落点偏远 */
const PIG_AIR_FRICTION = 0.001;
/** 预测用的猪半径：略小于实体，让"擦边"看起来也打得中 */
const AIM_RADIUS = PIG_RADIUS * 0.92;
/**
 * 瞄准预测的刷新间隔：拖动时每帧重算没必要（弹道点 30Hz 已经完全跟手），
 * 换来的是拖动期间零 GC 抖动（预测内部的点池都是复用的）。
 */
const AIM_REFRESH_MS = 32;

const PIG_MASS: Record<PigType, number> = {
  normal: 2,
  prof: 2,
  chef: 1.9,
  helmet: 2.6,
  king: 3.6,
  spy: 1.8,
};

const PIG_POWER: Record<PigType, number> = {
  normal: 1,
  prof: 1,
  chef: 1.15,
  helmet: 1.2,
  king: 1.7,
  spy: 1,
};

/**
 * 飞行慢放：只减少「每秒仿真步数」，不改任何一步内的物理量（速度、重力、破碎阈值都不动），
 * 所以所有关卡弹道与破坏结果完全不变，纯粹把猪在空中的真实时间拉长，方便飞行中点技能。
 */
const FLIGHT_SLOWMO = 0.72;
/** 猪速高于这个值才慢放（撞击减速后立刻恢复正常速度，塌楼不拖沓） */
const FLIGHT_SLOWMO_SPEED = 3;

/** 方块材质属性统一从 materials.ts 取（密度 / 摩擦 / 耐久 / 分值 / 碎屑风格） */
function bodyOptions(mat: Material): Matter.IChamferableBodyDefinition {
  const m = MATERIALS[mat];
  return {
    friction: m.friction,
    frictionStatic: m.frictionStatic,
    restitution: m.restitution,
    density: m.density,
  };
}

/** 单个刚体的速度上限：挡住爆炸/连锁带来的能量异常，同时保证一步位移小于最薄构件 */
const MAX_BODY_SPEED = 62;
/** 关卡开场静置保护：这段时间内的碰撞不算伤害、不点引信，防止落位抖动把炸药箱提前引爆 */
const ARM_DELAY_MS = 340;
/** 静止判定：低于这个速度且几乎不转的方块，直接把残余速度清零，杀掉"永远在抖"的微动 */
const REST_SPEED = 0.05;
const REST_SPIN = 0.008;
/** 连锁坍塌窗口：这么长时间内破的块算同一串 */
const CHAIN_WINDOW_MS = 700;
/**
 * 镜头位移上限（CSS px）：任何事件叠加后都不许超过这个量。
 * 小碰撞（轻蹭、碎一粒渣）根本加不上去，只有大冲击才会让画面晃一下。
 */
const SHAKE_MAX = 6.5;
/**
 * 镜头开始推近的飞行距离（世界 px）：小猪刚离开炮口时还算"在炮位附近"，
 * 这时候切特写会让整屏建筑突然放大 48%，观感像跳帧。
 */
const CAM_FOLLOW_AFTER = 130;
/** 同一块方块两次撞击音之间的最小间隔，防止贴着摩擦刷音 */
const HIT_SFX_GAP = 90;
/** 撞击火星 / 尘土出现的最小相对速度 */
const IMPACT_FX_SPEED = 3.4;
/**
 * 爆炸伤害：中轴处（核心区）的等效冲击强度，实际伤害 = 这个值 × power × 距离衰减 ÷ 材质耐久。
 * 34 是按"教授的爆炸在贴脸处能炸开铁皮、但在边缘只能炸木/玻璃"定标的。
 */
const BLAST_DMG = 34;
/** 核心区比例：半径的这个比例以内不衰减（几乎必碎），之外线性衰减到 BLAST_RIM */
const BLAST_CORE = 0.62;
/** 边缘保底系数：正好在爆炸半径上的方块还能吃到这么多伤害 */
const BLAST_RIM = 0.34;
/** 外圈推力系数（按距离衰减：贴在半径上最强，1.8R 处为 0） */
const BLAST_PUSH = 0.075;
/** 爆炸掀飞小猪的强度（贴着爆心 = 1，1.6R 处为 0） */
const BLAST_PIG_KNOCK = 15;
/**
 * 同一对物体重复计入伤害的最小间隔：Matter 在细碎抖动里可能"分开一帧又贴上"，
 * 会让同一个物理事件被扣两次耐久。只拦同一个对手的短间隔复发，不拦"被连续两下真撞"。
 */
const IMPACT_REPEAT_MS = 40;
/** 连线飘字的存活时长 */
const FLOAT_TEXT_TTL = 900;
/** 抢到鸟蛋后先播动画，再弹结算面板 */
const EGG_PICK_MS = 760;

/** 四种材质的物理手感：玻璃轻脆、木居中、石重且滑不动、铁板最沉 */

/**
 * 方块的损伤状态。除了累积伤害，还要记「最近一次有效撞击」的落点与方向：
 * 裂纹从落点长出来、碎片朝撞击方向飞、铁皮的凹陷朝受击面压下去——都由这里喂给绘制层。
 */
interface BlockDamage {
  dmg: number;
  seed: number;
  /** 撞击点（方块局部坐标，未旋转）：裂纹的起点 */
  hx: number;
  hy: number;
  /** 撞击方的速度（世界坐标）：碎片初速与凹陷朝向 */
  pushX: number;
  pushY: number;
  /** 上一次扣耐久的对手与时刻：防 Matter 抖动把一次撞击拆成两次 */
  lastOther: number;
  lastAt: number;
}

interface BirdRuntime {
  body: Matter.Body;
  def: BirdDef;
  offset: number;
  dash: boolean;
  /** 每只鸟一份帧动画器（蓝鸟三只循环飞行，不能共用一个 frame） */
  anim: BirdAnimator;
  /** 已被小猪撞飞（捕捉成功）：不再跑脚本轨迹，改为自由刚体 */
  captured: boolean;
  /** 被撞中的时间戳（-1 = 没被撞），驱动闪白 / 羽毛 / 淡出 */
  hitAt: number;
  /** 已淡出并移出世界，下一帧从列表里摘掉 */
  dead: boolean;
  /** 朝向：+1 朝右、-1 朝左（按真实位移算，蓝鸟绕圈回来会翻面） */
  face: number;
  /** 当前朝向已保持的帧数：位移太小（红鸟站桩）时不乱翻面 */
  faceHold: number;
  /** 上一帧的 x：朝向由真实位移算，不靠猜 */
  lastX: number;
}

/** 一块弹簧板的运行时状态 */
interface SpringRuntime {
  body: Matter.Body;
  def: SpringDef;
  /** 板面单位法线（指向"正面"） */
  nx: number;
  ny: number;
  /** 最近一次弹射的时间戳，-1 表示还没弹过 */
  firedAt: number;
  /** 冷却结束时间 */
  readyAt: number;
}

export interface EngineCallbacks {
  onSnapshot: (snapshot: Snapshot) => void;
  onWin: (result: WinResult) => void;
  onLose: (info: LoseInfo) => void;
  onSfx: (name: SfxName, power?: number) => void;
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private level: LevelDef;
  private cbs: EngineCallbacks;

  private engine: Matter.Engine;
  private world: Matter.World;

  private dpr = 1;
  private cssW = 960;
  private cssH = 540;
  private raf = 0;
  private acc = 0;
  private lastT = 0;
  private time = 0;
  private destroyed = false;

  private cam: Cam = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, scale: 0.5 };
  private camZoom = 1;
  private camInit = false;

  private blockBodies: Matter.Body[] = [];
  private blockMeta = new Map<number, BlockDef>();
  private breakQueue: Matter.Body[] = [];
  private wheelBodies: Matter.Body[] = [];
  private wheelRadii = new Map<number, number>();
  /** 弹簧板：静态弹射板 + 形变动画状态 */
  private springs: SpringRuntime[] = [];
  private birds: BirdRuntime[] = [];
  private eggBody: Matter.Body | null = null;

  /** 待发射的猪队列（第 0 位是当前装在发射器上的那只） */
  private pigQueue: PigType[] = [];
  /** 当前选中的猪在队列中的下标，玩家可在左下角队列里点选 */
  private selected = 0;
  private pigBody: Matter.Body | null = null;
  private pigAnim = new PigAnimator();
  /** 上次播放"受击"的时间：多条接触点不要在 140ms 内反复触发 */
  private pigHitAt = -1e9;
  /** 小猪是否处于"飞出去还没落地"的状态，用来只在落地那一下播 land */
  private pigWasAirborne = false;
  /** 上次使用技能的时间：护盾/尾焰/"哼"气泡都从这里起算 */
  private skillAt = -1e9;
  private pigType: PigType | null = null;
  private pigFlying = false;
  private skillUsed = false;
  /** 慢放后的仿真时钟（小鸟巡逻相位用它，保证飞行慢放时鸟不会相对猪变快） */
  private simClock = 0;
  /** 瞄准预测的解算结果（对象常驻，拖动时原地复用） */
  private aimPlan: AimPlan = createAimPlan();
  private aimPlanAt = -1;
  private aimPlanDx = 0;
  private aimPlanDy = 0;
  /** 预测场景：方块 / 弹簧板 / 车轮 / 小鸟，池化对象 + 有效长度，避免每帧新建 */
  private aimBoxes: AimBox[] = [];
  private aimBoxPool: AimBox[] = [];
  private aimSprings: AimSpring[] = [];
  private aimSpringPool: AimSpring[] = [];
  private aimCircles: AimCircle[] = [];
  private aimCirclePool: AimCircle[] = [];
  private aimBirds: AimBird[] = [];
  private aimBirdPool: AimBird[] = [];
  private immuneUntil = 0;
  private pierceUntil = 0;
  /** 跟随权重 0~1：0 = 全景瞄准，1 = 飞行特写。缓入缓出，避免发射瞬间镜头猛拉 */
  private camFollow = 0;
  /** 低动态模式：减震、减粒子、关掉装饰性摆动（不关掉必要的状态反馈） */
  private reduceMotion = false;
  private settleFrames = 0;
  /** 上一次飞行拖尾的时间戳 */
  private trailAt = 0;

  private score = 0;
  /** 分数构成（与 score 同步维护，结算面板与存档都用这一份明细） */
  private breakScore = 0;
  private chainBonus = 0;
  private birdScore = 0;
  /** 本关拆掉的方块数 / 撞飞的小鸟数（成就用） */
  private brokenBlocks = 0;
  private birdsCaptured = 0;
  /** 本关所有方块满分之和，用于判断"拆掉多少"的表现星 */
  private levelWorth = 0;
  private state: GameState = 'aiming';
  /** 方块的损伤状态：body.id → 已累积伤害（0~1，≥1 破碎）+ 裂纹种子 + 最近一次撞击的落点/方向 */
  private blockDamage = new Map<number, BlockDamage>();
  /** 上次掉碎屑的时间，防止贴着方块摩擦时每帧刷粒子 */
  private chipAt = new Map<number, number>();
  /** 已点着的炸药箱：body.id → 爆炸时间戳（引信） */
  private tntFuses = new Map<number, number>();
  /** 连锁坍塌：窗口期内连续破块，chain ≥ 3 给分包奖励 */
  private chain = 0;
  private maxChain = 0;
  private chainUntil = 0;
  /** 静止收敛的步进计数器 */
  private calmTick = 0;
  /**
   * 关卡开场保护截止时间：之前不结算伤害（避免落位抖动自爆）。
   * 时间基准是主循环的 rAF 时间戳（this.time），所以不能在建世界时直接算
   * （构造阶段 this.time 还是 0，而首帧会被写成 performance.now()）。
   * 改为建世界时挂起，等主循环第一帧拿到真实时间戳再落定，见 loop()。
   */
  private armedAt = 0;
  private armPending = true;
  private dragging = false;
  private dragPos: { x: number; y: number } | null = null;
  /** 发射器造型：投石车 or 大炮（两者都会播一次投掷/开火动画） */
  private launcher: Launcher = 'trebuchet';
  /** 开火动画已播放的毫秒数，-1 表示未在开火 */
  private fireT = -1;
  /** 发射瞬间的镜头推近量：1 → 0，渲染时按 1 + camPunch × 0.05 放大 */
  private camPunch = 0;

  private shards: ShardFx[] = [];
  private puffs: PuffFx[] = [];
  private flashes: FlashFx[] = [];
  private blasts: BlastFx[] = [];
  private rings: RingFx[] = [];
  private sparks: SparkFx[] = [];
  private texts: FloatTextFx[] = [];
  /** 屏幕震动强度，撞击和爆炸时往上顶一下再自然衰减（永远 ≤ SHAKE_MAX） */
  private shake = 0;
  /** 撞击音效节流：方块 body.id → 上次播放时间 */
  private hitSfxAt = new Map<number, number>();
  /** 全局撞击音节流（毫秒时间戳） */
  private impactSfxAt = 0;
  /** 倒塌音效节流：一串坍塌只响一次 */
  private collapseAt = -1e9;
  /** 鸟蛋被抢到的动画起点，-1 表示还没抢到 */
  private eggPickAt = -1;
  /** 通关结果延迟到蛋的动画播完再回调（否则结算面板会把动画盖住） */
  private pendingWin: WinResult | null = null;
  private pendingWinAt = -1;
  /** 小猪撞碎方块时保留的冲量，用于"撞穿"手感 */
  private pigSmashVelocity: { x: number; y: number } | null = null;
  /** 最后一发的客观记录：离鸟蛋最近距离（px）与撞到场景物件的次数，只喂给失败面板 */
  private shotClosest = Number.POSITIVE_INFINITY;
  private shotContacts = 0;
  private shotFar = Number.NEGATIVE_INFINITY;

  constructor(canvas: HTMLCanvasElement, level: LevelDef, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 Canvas 2D 上下文');
    this.ctx = ctx;
    this.level = level;
    this.cbs = callbacks;
    this.pigQueue = [...level.pigs];
    this.launcher = level.launcher ?? 'trebuchet';
    this.engine = Engine.create({ gravity: { x: 0, y: GRAVITY_Y, scale: 0.001 } });
    this.world = this.engine.world;

    preloadPigSprites();
    preloadBirdSprites();
    preloadCannon();
    preloadTrebuchet();
    preloadBackdrop();
    this.buildWorld();
    this.resize();
    this.attachInput();
    this.emit();
  }

  /**
   * 六种猪的技能表现，全部画在猪身上（纯绘制层，绝不碰刚体）：
   * - 间谍猪：青白护盾环（免疫 2000ms 期间）
   * - 厨师猪：冲刺激光尾焰（加速 + 穿透 900ms 期间）
   * - 普通/钢盔/国王：没有真技能，按一下冒一个「哼!」气泡（520ms）
   * - 教授猪：不叠绘制层，爆炸本身（火球 + 冲击环 + 震屏）就是表现
   */
  private drawSkillFx(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): void {
    if (this.time < this.immuneUntil) {
      drawPigShield(ctx, x, y, PIG_RADIUS, (this.immuneUntil - this.time) / 2000, this.time);
      return;
    }
    if (this.time < this.pierceUntil) {
      drawPigDash(ctx, x, y, vx, vy, PIG_RADIUS, (this.pierceUntil - this.time) / 900);
      return;
    }
    const since = this.time - this.skillAt;
    if (since < 520 && (this.pigType === 'normal' || this.pigType === 'helmet' || this.pigType === 'king')) {
      drawOinkBubble(ctx, x, y, PIG_RADIUS, 1 - since / 520);
    }
  }

  /* ---------------- 世界构建 ---------------- */

  private buildWorld(): void {
    Composite.clear(this.world, false, true);
    this.blockBodies = [];
    this.blockMeta.clear();
    this.breakQueue = [];
    this.wheelBodies = [];
    this.wheelRadii.clear();
    this.springs = [];
    this.tntFuses.clear();
    this.birds = [];
    this.eggBody = null;
    this.pigBody = null;
    this.pigType = null;
    this.pigQueue = [...this.level.pigs];
    this.selected = 0;
    this.pigFlying = false;
    this.skillUsed = false;
    this.settleFrames = 0;
    this.shotClosest = Number.POSITIVE_INFINITY;
    this.shotContacts = 0;
    this.shotFar = Number.NEGATIVE_INFINITY;
    this.pigAnim.reset();
    this.pigWasAirborne = false;
    this.skillAt = -1e9;
    this.immuneUntil = 0;
    this.pierceUntil = 0;
    this.camFollow = 0;
    this.camPunch = 0;
    this.score = 0;
    this.breakScore = 0;
    this.chainBonus = 0;
    this.birdScore = 0;
    this.brokenBlocks = 0;
    this.birdsCaptured = 0;
    this.levelWorth = 0;
    this.state = 'aiming';
    this.dragging = false;
    this.dragPos = null;
    this.shards = [];
    this.puffs = [];
    this.flashes = [];
    this.blasts = [];
    this.rings = [];
    this.shake = 0;
    this.sparks = [];
    this.texts = [];
    this.blockDamage.clear();
    this.chipAt.clear();
    this.hitSfxAt.clear();
    this.impactSfxAt = 0;
    this.collapseAt = -1e9;
    this.eggPickAt = -1;
    this.pendingWin = null;
    this.pendingWinAt = -1;
    this.chain = 0;
    this.maxChain = 0;
    this.chainUntil = 0;
    // 开场保护从主循环第一帧起算（见 armedAt/armPending 注释），这里只挂起
    this.armedAt = 0;
    this.armPending = true;

    const ground = Bodies.rectangle(1000, GROUND_Y + 300, 6000, 600, {
      isStatic: true,
      friction: 0.9,
      restitution: 0.02,
    });
    Composite.add(this.world, ground);

    this.level.blocks.forEach((def) => {
      const body = Bodies.rectangle(def.x, def.y, def.w, def.h, bodyOptions(def.mat));
      this.blockBodies.push(body);
      this.blockMeta.set(body.id, def);
      this.blockDamage.set(body.id, {
        dmg: 0,
        seed: body.id,
        hx: 0,
        hy: 0,
        pushX: 0,
        pushY: 0,
        lastOther: -1,
        lastAt: -1e9,
      });
      Composite.add(this.world, body);
    });

    // 本关满分：破坏得分上限（TNT 箱按木块分值算，和破坏计分一致）
    this.levelWorth = this.level.blocks.reduce((sum, def) => sum + MATERIALS[def.mat].score, 0);

    // 散落的木车轮：真实刚体，被猪撞到就一路滚出去，滚到地面自己停
    (this.level.wheels ?? []).forEach((def) => {
      const body = Bodies.circle(def.x, def.y, def.r, {
        friction: 0.55,
        frictionStatic: 0.6,
        frictionAir: 0.012,
        restitution: 0.24,
        density: 0.0012,
      });
      this.wheelBodies.push(body);
      this.wheelRadii.set(body.id, def.r);
      Composite.add(this.world, body);
    });

    // 弹簧板：静态板面（不参与破坏），物体撞到正面且速度够快就沿法线弹飞
    (this.level.springs ?? []).forEach((def) => {
      const angle = def.angle ?? 0;
      const body = Bodies.rectangle(def.x, def.y, def.w, def.h, {
        isStatic: true,
        friction: 0.9,
        frictionStatic: 1,
        restitution: 0,
        label: 'spring',
      });
      Body.setAngle(body, angle);
      this.springs.push({
        body,
        def,
        // 局部 +y 在旋转 angle 后指向 (sin a, cos a)；板面"正面"是它的反向
        nx: Math.sin(angle),
        ny: -Math.cos(angle),
        firedAt: -1,
        readyAt: 0,
      });
      Composite.add(this.world, body);
    });

    const egg = Bodies.circle(this.level.egg.x, this.level.egg.y, this.level.egg.r, {
      isStatic: true,
      friction: 0.9,
      restitution: 0.2,
    });
    this.eggBody = egg;
    Composite.add(this.world, egg);

    this.level.birds.forEach((def) => {
      if (def.kind === 'blue') {
        for (let i = 0; i < 3; i += 1) {
          const body = Bodies.circle(def.cx, def.cy, 18, {
            isStatic: true,
            friction: 0.6,
            restitution: 0.5,
          });
          // 三只蓝鸟错开相位，否则同一帧起跳，看起来像三张贴纸在同步平移
          const anim = new BirdAnimator(i * 65);
          this.birds.push({
            body,
            def,
            offset: (Math.PI * 2 * i) / 3,
            dash: false,
            anim,
            captured: false,
            hitAt: -1,
            dead: false,
            face: -1,
            faceHold: 0,
            lastX: -1e9,
          });
          Composite.add(this.world, body);
        }
      } else {
        // 蹲在房顶/地面的红鸟走真实刚体：墙体被轰塌后它会跟着一起掉下去、还会被猪撞飞；
        // 黄鸟是空中俯冲、蓝鸟是空中绕圈，必须留在静态体上由脚本摆位。
        const perched = def.kind === 'red';
        const body = Bodies.circle(def.x, def.y, def.kind === 'yellow' ? 24 : 26, {
          isStatic: !perched,
          friction: 1,
          frictionStatic: 1,
          frictionAir: perched ? 0.04 : 0.01,
          restitution: perched ? 0.05 : 0.5,
          density: 0.0012,
          // 圆的转动惯量默认可自由滚动，蹲在略斜的屋顶上会慢慢"滚"下去；
          // 锁死转动惯量后它只会被撞得平移，站稳就是站稳
          inertia: perched ? Infinity : undefined,
          label: 'bird',
        });
        this.birds.push({
          body,
          def,
          offset: 0,
          dash: false,
          anim: new BirdAnimator(),
          captured: false,
          hitAt: -1,
          dead: false,
          face: -1,
          faceHold: 0,
          lastX: -1e9,
        });
        Composite.add(this.world, body);
      }
    });

    Events.on(this.engine, 'collisionStart', this.onCollision);
    this.spawnPig();
  }

  /** 把队列里选中的那只猪装到发射器上（不消耗队列，发射时才移除） */
  private spawnPig(): void {
    const type = this.pigQueue[this.selected];
    if (!type) return;
    this.buildLoadedPig(type);
    this.emit();
  }

  /** 玩家在左下角队列里点选下一只猪：只换外观与体重，不消耗队列 */
  selectPig(index: number): void {
    if (this.state !== 'aiming' || this.dragging) return;
    if (index < 0 || index >= this.pigQueue.length || index === this.selected) return;
    const type = this.pigQueue[index];
    if (!type) return;
    this.selected = index;
    this.buildLoadedPig(type);
    this.cbs.onSfx('click');
    this.emit();
  }

  private buildLoadedPig(type: PigType): void {
    if (this.pigBody) {
      Composite.remove(this.world, this.pigBody);
      this.pigBody = null;
    }
    const anchor = this.level.launchPoint;
    const body = Bodies.circle(anchor.x, anchor.y, PIG_RADIUS, {
      friction: 0.4,
      frictionAir: 0.001,
      restitution: 0.35,
      density: 0.0014,
    });
    Body.setMass(body, PIG_MASS[type]);
    Body.setStatic(body, true);
    Body.setPosition(body, { x: anchor.x, y: anchor.y });
    this.pigBody = body;
    this.pigType = type;
    this.pigFlying = false;
    this.skillUsed = false;
    this.settleFrames = 0;
    this.pigAnim.reset();
    this.pigWasAirborne = false;
    this.skillAt = -1e9;
    this.immuneUntil = 0;
    this.pierceUntil = 0;
    this.dragging = false;
    this.dragPos = null;
    this.state = 'aiming';
    Composite.add(this.world, body);
  }

  /* ---------------- 输入 ---------------- */

  private attachInput(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  private detachInput(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }

  private toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    return {
      x: (cx - this.cssW / 2) / this.cam.scale + this.cam.x,
      y: (cy - this.cssH / 2) / this.cam.scale + this.cam.y,
    };
  }

  private clampDrag(p: { x: number; y: number }): { x: number; y: number } {
    const anchor = this.level.launchPoint;
    const dx = p.x - anchor.x;
    const dy = p.y - anchor.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= MAX_PULL) return p;
    const k = MAX_PULL / dist;
    return { x: anchor.x + dx * k, y: anchor.y + dy * k };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.state === 'flying') {
      this.triggerSkill();
      return;
    }
    if (this.state !== 'aiming') return;
    e.preventDefault();
    this.dragging = true;
    this.dragPos = this.clampDrag(this.toWorld(e.clientX, e.clientY));
    this.cbs.onSfx('pull');
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragPos = this.clampDrag(this.toWorld(e.clientX, e.clientY));
    if (this.pigBody) {
      Body.setPosition(this.pigBody, this.dragPos);
    }
  };

  private onPointerUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    const anchor = this.level.launchPoint;
    const pos = this.dragPos;
    const body = this.pigBody;
    this.dragPos = null;
    if (!pos || !body || !this.pigType) return;

    const dx = anchor.x - pos.x;
    const dy = anchor.y - pos.y;
    if (Math.hypot(dx, dy) < 12) {
      Body.setPosition(body, anchor);
      return;
    }
    Body.setStatic(body, false);
    Body.setPosition(body, anchor);
    Body.setVelocity(body, { x: dx * LAUNCH_FACTOR, y: dy * LAUNCH_FACTOR });
    Body.setAngularVelocity(body, Math.max(-0.3, Math.min(0.3, dx * 0.0016)));
    this.pigFlying = true;
    this.settleFrames = 0;
    this.state = 'flying';
    // 发射反馈：镜头一次推近 + 轻微震屏，力度越大越明显
    const power = Math.min(1, Math.hypot(dx, dy) / MAX_PULL);
    this.camPunch = this.reduceMotion ? 0 : 1;
    this.addShake(0.8 + power * 1.5);
    // 这只猪已经飞出去了：从待发射队列里划掉，队列指向队首
    this.pigQueue = this.pigQueue.filter((_, i) => i !== this.selected);
    this.selected = 0;
    this.fireT = 0;
    this.trailAt = this.time;
    // 出膛动作：抽长 200ms 后自动回落到飞行
    this.pigWasAirborne = true;
    this.pigAnim.playState('launch', { after: 'fly' });
    // 起手一蓬烟：炮口爆焰 / 抛兜甩出的尘土
    for (let i = 0; i < 6; i += 1) {
      const ttl = 260 + Math.random() * 200;
      this.puffs.push({
        x: anchor.x + (Math.random() - 0.5) * 44,
        y: anchor.y + (Math.random() - 0.5) * 34,
        vx: (Math.random() - 0.5) * 3.4 - dx * 0.02,
        vy: (Math.random() - 0.5) * 2.2 - 0.6,
        r: 9 + Math.random() * 12,
        grow: 0.36 + Math.random() * 0.3,
        life: ttl,
        ttl,
        mat: 'stone',
        smoke: true,
      });
    }
    this.cbs.onSfx('launch', power);
    this.emit();
  };

  private triggerSkill(): void {
    if (this.state !== 'flying' || this.skillUsed || !this.pigBody || !this.pigType) return;
    const type = this.pigType;
    // 技能动作：六种猪都先来一下"鼓气→释放"，专属表现（护盾环/冲刺尾焰/"哼"气泡）在绘制层叠加
    this.pigAnim.playState('skill', { after: 'fly' });
    this.skillAt = this.time;
    if (type === 'normal' || type === 'helmet' || type === 'king') {
      this.cbs.onSfx('oink');
      this.emit();
      return;
    }
    this.skillUsed = true;
    if (type === 'prof') {
      this.explode();
    } else if (type === 'chef') {
      const v = this.pigBody.velocity;
      const speed = Math.hypot(v.x, v.y) || 1;
      const boost = Math.min(44, speed * 1.9 + 5);
      Body.setVelocity(this.pigBody, { x: (v.x / speed) * boost, y: (v.y / speed) * boost });
      this.pierceUntil = this.time + 900;
      this.cbs.onSfx('booster');
    } else if (type === 'spy') {
      this.immuneUntil = this.time + 2000;
      this.cbs.onSfx('click');
    }
    this.emit();
  }

  private explode(): void {
    if (!this.pigBody) return;
    const { x, y } = this.pigBody.position;
    this.explodeAt(x, y, 185, 1, this.pigBody);
  }

  /**
   * 爆炸对单个方块结算伤害：核心区满伤害、往外线性衰减到 BLAST_RIM。
   * 不再"半径内一律瞬间粉碎"——石墙/铁皮在边缘能扛住，只裂不碎。
   */
  private applyBlast(body: Matter.Body, x: number, y: number, radius: number, power: number): void {
    const meta = this.blockMeta.get(body.id);
    if (!meta || this.breakQueue.includes(body)) return;
    const profile = MATERIALS[meta.mat];
    const st = this.blockDamage.get(body.id);
    const d = Vector.magnitude(Vector.sub(body.position, { x, y }));
    const t = radius > 0 ? Math.min(1, d / radius) : 0;
    const fall =
      t <= BLAST_CORE ? 1 : 1 - (1 - BLAST_RIM) * ((t - BLAST_CORE) / (1 - BLAST_CORE));
    const harm = (power * BLAST_DMG * fall) / profile.hp;
    const dmg = st ? Math.min(1, st.dmg + harm) : Math.min(1, harm);
    if (st) {
      st.dmg = dmg;
      // 冲击从爆心推过来：撞击点落在朝向爆心的那一面
      const inv = d > 0.001 ? { x: (x - body.position.x) / d, y: (y - body.position.y) / d } : { x: 0, y: 1 };
      const c = Math.cos(-body.angle);
      const s = Math.sin(-body.angle);
      st.hx = (inv.x * meta.w * 0.5) * c - (inv.y * meta.h * 0.5) * s;
      st.hy = (inv.x * meta.w * 0.5) * s + (inv.y * meta.h * 0.5) * c;
      st.pushX = -inv.x * power * 8;
      st.pushY = -inv.y * power * 8;
      st.lastOther = -1;
      st.lastAt = this.time;
    }
    if (dmg >= 1) this.breakQueue.push(body);
  }

  /**
   * 爆炸本体：核心区按距离衰减结算伤害，外圈吃一记随距离衰减的推力。
   * 炸药箱被打碎时也走这里，于是 TNT 能连锁引爆旁边的 TNT。
   * `source` 是"施爆者"（教授猪自己），不参与被自己的冲击波掀飞。
   */
  private explodeAt(x: number, y: number, radius: number, power: number, source?: Matter.Body): void {
    this.cbs.onSfx('boom');
    this.blasts.push({
      x,
      y,
      r: radius * 0.2,
      max: radius * 1.02,
      life: 380,
      ttl: 380,
      seed: Math.random() * 6.28,
    });
    this.rings.push({ x, y, r: radius * 0.16, max: radius * 1.5, life: 420, ttl: 420 });
    this.addShake(2.6 + power * 2.2);

    // 爆炸烟：几团深灰往上翻
    for (let i = 0; i < 7; i += 1) {
      const ttl = 520 + Math.random() * 320;
      this.puffs.push({
        x: x + (Math.random() - 0.5) * radius * 0.8,
        y: y + (Math.random() - 0.5) * radius * 0.7,
        vx: (Math.random() - 0.5) * 3.2,
        vy: -Math.random() * 2.2 - 0.4,
        r: 16 + Math.random() * 18,
        grow: 0.5 + Math.random() * 0.4,
        life: ttl,
        ttl,
        mat: 'stone',
        smoke: true,
      });
    }

    this.blockBodies.forEach((body) => {
      const d = Vector.magnitude(Vector.sub(body.position, { x, y }));
      if (d >= radius * 1.8) return;
      const dir =
        d > 0.001
          ? Vector.normalise(Vector.sub(body.position, { x, y }))
          : { x: 0, y: -1 };
      if (d < radius) {
        // 爆心一圈按距离衰减吃伤害（核心区必碎，边缘只碎木/玻璃，石/铁扛得住）
        this.applyBlast(body, x, y, radius, power);
      } else {
        // 外圈只有推力，且随距离衰减：远处建筑不会无缘无故被甩飞
        const t = (d - radius) / (radius * 0.8);
        const fall = Math.pow(Math.max(0, 1 - t), 1.3);
        const f = BLAST_PUSH * power * fall;
        Body.applyForce(body, body.position, {
          x: dir.x * body.mass * f,
          y: dir.y * body.mass * f - 0.01 * fall * body.mass,
        });
      }
    });

    // 小猪也会被冲击波掀一下（自己放的爆炸不掀自己，否则弹道会被自己的技能打乱）
    if (this.pigBody && this.pigBody !== source) {
      const body = this.pigBody;
      const d = Vector.magnitude(Vector.sub(body.position, { x, y }));
      const reach = radius * 1.6;
      if (d < reach) {
        const k = 1 - d / reach;
        const dir = d > 0.001 ? Vector.normalise(Vector.sub(body.position, { x, y })) : { x: 0, y: -1 };
        const knock = BLAST_PIG_KNOCK * power * (0.35 + k * 0.65);
        Body.setVelocity(body, {
          x: body.velocity.x + dir.x * knock,
          y: body.velocity.y + dir.y * knock - knock * 0.35,
        });
      }
    }

    // 机关连锁：范围内的其它炸药箱被引信带炸（错开几十毫秒，看得出"一串炸开"）
    this.blockBodies.forEach((body) => {
      const meta = this.blockMeta.get(body.id);
      if (!meta || !meta.tnt) return;
      const d = Vector.magnitude(Vector.sub(body.position, { x, y }));
      if (d > TNT.chainRadius) return;
      this.lightFuse(body, 60 + Math.random() * TNT.chainJitterMs);
    });

    // 车轮也被掀飞
    this.wheelBodies.forEach((body) => {
      const d = Vector.magnitude(Vector.sub(body.position, { x, y }));
      if (d > radius * 1.8) return;
      const dir = Vector.normalise(Vector.sub(body.position, { x, y }));
      Body.setVelocity(body, {
        x: body.velocity.x + dir.x * 9,
        y: body.velocity.y + dir.y * 9 - 4,
      });
    });
    this.clampSpeeds();
  }

  /** 速度上限：爆炸与撞穿会短暂给出很高的速度，钳一下防止穿透与能量异常放大 */
  private clampSpeeds(): void {
    const limit = (body: Matter.Body): void => {
      const s = Vector.magnitude(body.velocity);
      if (s <= MAX_BODY_SPEED) return;
      const k = MAX_BODY_SPEED / s;
      Body.setVelocity(body, { x: body.velocity.x * k, y: body.velocity.y * k });
    };
    this.blockBodies.forEach(limit);
    this.wheelBodies.forEach(limit);
    if (this.pigBody) limit(this.pigBody);
  }

  /**
   * 静止收敛：极慢的抖动直接清零，避免整栋楼在"计算误差"里持续蠕动。
   * 只处理速度与角速度都低于阈值的刚体，正在滚动/下落的不会被误冻。
   */
  private calmResting(): void {
    const calm = (body: Matter.Body): void => {
      if (body.isStatic) return;
      const v = body.velocity;
      if (Math.abs(v.x) < REST_SPEED && Math.abs(v.y) < REST_SPEED && Math.abs(body.angularVelocity) < REST_SPIN) {
        Body.setVelocity(body, { x: 0, y: 0 });
        Body.setAngularVelocity(body, 0);
      }
    };
    this.blockBodies.forEach(calm);
    this.wheelBodies.forEach(calm);
  }

  /* ---------------- 物理事件 ---------------- */

  private onCollision = (event: Matter.IEventCollision<Matter.Engine>): void => {
    const pairs = event.pairs as unknown as Array<{
      bodyA: Matter.Body;
      bodyB: Matter.Body;
      collision?: { supports?: Matter.Vector[]; normal?: Matter.Vector };
    }>;
    pairs.forEach((pair) => {
      const { bodyA, bodyB } = pair;
      // 接触点：撞击火星就从这里甩出去，比拿两体中点准得多
      const support = pair.collision?.supports?.[0];
      const contact = support ? { x: support.x, y: support.y } : null;
      // 法线方向的接近速度：擦着边滑过去（法向分量很小）不该和正面砸中一样疼。
      // Matter 的 normal 指向谁不影响结果——只有大小参与结算。
      const relVec = Vector.sub(bodyA.velocity, bodyB.velocity);
      const relSpeed = Vector.magnitude(relVec);
      const normal = pair.collision?.normal;
      // 真正砸进结构的是法向分量；切向那部分按接收材质的 shear 折算（见 applyImpact）
      const vn = normal ? Math.min(relSpeed, Math.abs(relVec.x * normal.x + relVec.y * normal.y)) : relSpeed;
      const pig = this.pigBody;
      if (pig && (bodyA === pig || bodyB === pig)) {
        const other = bodyA === pig ? bodyB : bodyA;
        if (this.eggBody && other === this.eggBody) {
          this.win();
          return;
        }
        // 只统计"撞到了场景里的东西"（方块 / 小车 / 弹簧板），落地滑行不算
        if (this.state === 'flying' && (this.blockMeta.has(other.id) || this.springs.some((sp) => sp.body === other))) {
          this.shotContacts += 1;
        }
        // 受击动作：够快才算"被打到"（擦地滑行不播），140ms 内不重复触发，避免多个接触点把动作刷成抖动
        if (relSpeed > 6 && this.time - this.pigHitAt > 140) {
          this.pigHitAt = this.time;
          this.pigAnim.playState('hit', { after: this.state === 'flying' ? 'fly' : 'idle', restart: true });
        }
        const bird = this.birds.find((b) => b.body === other);
        if (bird) {
          this.onBirdHit(bird);
          return;
        }
      }
      const springA = this.springs.find((sp) => sp.body === bodyA);
      const springB = this.springs.find((sp) => sp.body === bodyB);
      if (springA) this.trySpring(springA, bodyB);
      if (springB) this.trySpring(springB, bodyA);
      this.applyImpact(bodyA, bodyB, contact, vn, relSpeed);
      this.applyImpact(bodyB, bodyA, contact, vn, relSpeed);
    });
  };

  /**
   * 伤害结算：**以碰撞法线方向的接近速度为主**。
   * `hitSpeed = vn + (|vRel| − vn) × MATERIALS[被撞材质].shear`
   * - 擦着表面滑过去：法向分量很小 → 玻璃（shear .75）照样炸裂，石头铁皮（.25/.2）几乎不疼；
   * - 正面砸中：法向分量 ≈ 全相对速度 → 与旧版手感一致；
   * - 相对速度另留一份给表现层（火星/音效强度），让"擦一下"照样有视觉反馈。
   */
  private applyImpact(
    target: Matter.Body,
    other: Matter.Body,
    contact: { x: number; y: number } | null = null,
    vn = 0,
    relSpeed = 0,
  ): void {
    const meta = this.blockMeta.get(target.id);
    if (!meta) return;
    if (this.breakQueue.includes(target)) return;
    if (this.time < this.armedAt) return;

    const profile = MATERIALS[meta.mat];
    const hitSpeed = vn + Math.max(0, relSpeed - vn) * profile.shear;
    const isPig = other === this.pigBody;
    // 防抖：同一个对手在几十毫秒内的复发接触不重复扣耐久（真被连续撞两下不会走这条路）
    const st0 = this.blockDamage.get(target.id);
    if (st0 && st0.lastOther === other.id && this.time - st0.lastAt < IMPACT_REPEAT_MS) return;
    // 炸药箱不吃耐久累积：只要够得上引信阈值就点火，比木质方块敏感得多
    if (meta.tnt) {
      if (st0) {
        st0.lastOther = other.id;
        st0.lastAt = this.time;
      }
      if (hitSpeed >= TNT.minImpact) this.lightFuse(target);
      return;
    }
    // 静态体（地面、鸟蛋、站桩鸟）质量是 Infinity，按满系数 1.4 结算，
    // 这样"塌下来砸在地上的横梁"会碎，而不是无声无息地停住
    // 低于材质的最小冲击强度：接触/静置/轻微刮蹭都不掉耐久，避免开局自损与无意义抖动
    if (hitSpeed < profile.minImpact) return;

    const power = isPig
      ? hitSpeed * PIG_POWER[this.pigType ?? 'normal']
      : hitSpeed * Math.min(1.4, other.mass * 0.5);

    // 伤害按「冲击强度 / 材质耐久」累积，与碰撞次数无关
    const harm = power / profile.hp;
    const st = st0;
    const dmg = st ? Math.min(1, st.dmg + harm) : Math.min(1, harm);
    if (st) {
      st.dmg = dmg;
      st.lastOther = other.id;
      st.lastAt = this.time;
      this.markHitPoint(st, target, contact, other);
    }

    // 撞击反馈（音效 + 火星 + 轻微震动）：够得上"撞了一下"的速度才给，且同一块 90ms 内只来一次
    if (relSpeed >= IMPACT_FX_SPEED) {
      const lastHit = this.hitSfxAt.get(target.id) ?? -1e9;
      if (this.time - lastHit > HIT_SFX_GAP) {
        this.hitSfxAt.set(target.id, this.time);
        this.spawnImpactFx(contact ?? target.position, hitSpeed, meta, other.velocity);
      }
    }

    const piercing = isPig && this.time < this.pierceUntil && profile.pierce;
    if (dmg >= 1 || piercing) {
      this.breakQueue.push(target);
      if (isPig && this.pigBody) {
        this.pigSmashVelocity = { x: this.pigBody.velocity.x, y: this.pigBody.velocity.y };
      }
      return;
    }

    // 没碎但受了伤：掉碎屑 + 轻微震屏，让"打动了但没打穿"有反馈
    if (harm >= CRACK_HIT) {
      const last = this.chipAt.get(target.id) ?? -1e9;
      if (this.time - last > 110) {
        this.chipAt.set(target.id, this.time);
        this.spawnChips(target.position, target.angle, meta, harm, other.velocity);
      }
    }
  }

  /** 记录撞击点（转成方块局部坐标）与撞击方速度，供裂纹/凹陷/碎片方向使用 */
  private markHitPoint(
    st: BlockDamage,
    target: Matter.Body,
    contact: { x: number; y: number } | null,
    other: Matter.Body,
  ): void {
    st.pushX = other.velocity.x;
    st.pushY = other.velocity.y;
    if (!contact) return;
    const dx = contact.x - target.position.x;
    const dy = contact.y - target.position.y;
    const c = Math.cos(-target.angle);
    const s = Math.sin(-target.angle);
    const meta = this.blockMeta.get(target.id);
    const hw = meta ? meta.w / 2 : 0;
    const hh = meta ? meta.h / 2 : 0;
    st.hx = Math.max(-hw, Math.min(hw, dx * c - dy * s));
    st.hy = Math.max(-hh, Math.min(hh, dx * s + dy * c));
  }

  private drainBreaks(): void {
    if (this.breakQueue.length === 0) return;
    // 炸药箱被砸碎会立刻引爆周围的方块，那些方块又会进队列，
    // 所以这里循环排空（over 6 轮就强行收手，避免连锁失控）
    let guard = 0;
    while (this.breakQueue.length > 0 && guard < 6) {
      const queue = this.breakQueue;
      this.breakQueue = [];
      queue.forEach((body) => {
        const meta = this.blockMeta.get(body.id);
        if (!meta) return;
        const profile = MATERIALS[meta.mat];
        const pos = { x: body.position.x, y: body.position.y };
        const angle = body.angle;
        const dmgState = this.blockDamage.get(body.id);
        // 碎片顺着"最后砸中它的那一记"飞：炸开的往上散、撞穿的顺着猪往前钻
        const dmgPush =
          dmgState && (dmgState.pushX !== 0 || dmgState.pushY !== 0)
            ? { x: dmgState.pushX, y: dmgState.pushY }
            : null;
        this.blockMeta.delete(body.id);
        this.blockDamage.delete(body.id);
        this.chipAt.delete(body.id);
        this.blockBodies = this.blockBodies.filter((b) => b !== body);
        Composite.remove(this.world, body);
        // 碎片朝向优先用「最后砸中它的那一记」的方向（被打碎/被炸碎都有），
        // 拿不到才退回撞穿冲量，最后才让切块自己铺开。
        this.spawnBreakFx(pos, angle, meta, dmgPush ?? this.pigSmashVelocity);

        // 连锁坍塌：700ms 内连续破块计数，第 3 块起给分包奖励
        this.chain = this.time < this.chainUntil ? this.chain + 1 : 1;
        this.chainUntil = this.time + CHAIN_WINDOW_MS;
        this.maxChain = Math.max(this.maxChain, this.chain);
        this.breakScore += profile.score;
        this.brokenBlocks += 1;
        if (this.chain >= 3) this.chainBonus += (this.chain - 2) * 10;
        // 通关后 pendingWin 已经冻结了结算分数（含剩猪/鸟蛋奖励），这里不再重算，
        // 否则抢蛋动画期间的塌楼会把 HUD 分数从"含奖励"打回"不含奖励"，看起来像掉分。
        if (!this.pendingWin) {
          this.score = totalScore({
            breakScore: this.breakScore,
            chainBonus: this.chainBonus,
            birdScore: this.birdScore,
            pigBonus: 0,
            eggBonus: 0,
          });
        }

        // 破块震动按"材质重量 + 体积"分级：小碎块几乎不晃，石/铁塌下来才推一下，且永远不超过 SHAKE_MAX
        const heavy = meta.mat === 'stone' ? 0.1 : meta.mat === 'metal' ? 0.08 : 0;
        this.addShake(0.14 + heavy + Math.min(0.8, (meta.w * meta.h) / 16000));

        // 连锁提示：第 3 块起在世界里飘出「连锁 ×N」，并在里程碑补一声金色小叮
        if (this.chain >= 3) {
          this.pushText(
            pos.x,
            pos.y - meta.h * 0.5 - 10,
            `连锁 ×${this.chain}`,
            '#ffd75e',
            13 + Math.min(13, this.chain * 1.5),
          );
          if (this.chain === 3 || this.chain === 5 || this.chain === 8 || this.chain === 12) {
            this.cbs.onSfx('chain', Math.min(1, this.chain / 12));
          }
        }

        this.cbs.onSfx(profile.sfx);
        // 建筑倒塌：一串坍塌开始时补一层低频闷响（800ms 内只响一次，不会糊成噪音）
        if (this.chain === 3 && this.time - this.collapseAt > 800) {
          this.collapseAt = this.time;
          this.cbs.onSfx('collapse', Math.min(1, 0.45 + (meta.w * meta.h) / 26000));
        }
        if (meta.tnt) this.explodeAt(pos.x, pos.y, TNT.radius, TNT.power);
      });
      guard += 1;
    }

    // 撞穿：小猪击碎方块后保留约七成冲量，继续向内钻
    if (this.pigSmashVelocity) {
      const v = this.pigSmashVelocity;
      this.pigSmashVelocity = null;
      if (this.pigBody && this.state === 'flying') {
        Body.setVelocity(this.pigBody, { x: v.x * 0.72, y: v.y * 0.72 });
      }
    }
    this.emit();
  }

  /**
   * 破裂表现：白色闪裂 + 按网格切开的碎块 + 一蓬尘土。
   * 碎块按方块自身的旋转角铺开，破碎那一帧与方块轮廓完全重合，看起来才"是它碎了"，
   * 而不是原地消失换成一堆小方块。
   * 四种材质的碎块不只是"尺寸不同"：切法、飞散方向、重力、弹跳、寿命都各走一套
   * （木刺顺着撞击方向崩、石块又重又沉、玻璃细碎早消失、铁皮大片带火星）。
   */
  private spawnBreakFx(
    pos: { x: number; y: number },
    angle: number,
    meta: BlockDef,
    impulse: { x: number; y: number } | null,
  ): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // 材质决定碎块切法：木头长条木屑 / 石块厚块 / 玻璃细碎片 / 铁皮大片
    const style = MATERIALS[meta.mat].debris;
    let cols = Math.max(2, Math.min(3, 1 + Math.round(meta.w / 90)));
    let rows = Math.max(2, Math.min(3, 1 + Math.round(meta.h / 90)));
    let sizeK = 0.84;
    if (style === 'splinter') {
      // 顺着长边劈：沿长轴多切、短轴少切，得到细长木刺
      const long = meta.w >= meta.h;
      const splitLong = Math.max(2, Math.min(4, Math.round((long ? meta.w : meta.h) / 46)));
      cols = long ? splitLong : 2;
      rows = long ? 2 : splitLong;
      sizeK = 0.7;
    } else if (style === 'shard') {
      cols = Math.max(3, Math.min(4, 1 + Math.round(meta.w / 45)));
      rows = Math.max(3, Math.min(4, 1 + Math.round(meta.h / 45)));
      sizeK = 0.66;
    } else if (style === 'chunk') {
      cols = Math.max(2, Math.min(3, Math.round(meta.w / 110)));
      rows = Math.max(2, Math.min(3, Math.round(meta.h / 110)));
      sizeK = 0.9;
    } else {
      cols = 2;
      rows = Math.max(1, Math.min(2, Math.round(meta.h / 70)));
      sizeK = 0.94;
    }
    // 每种材质的"碎块手感"：重力、空气阻力、落地弹跳、自转、寿命区间
    const feel =
      meta.mat === 'wood'
        ? { grav: 0.5, drag: 0.995, bounce: 0.32, spin: 0.55, ttl0: 950, ttl1: 500, push: 0.26 }
        : meta.mat === 'glass'
          ? { grav: 0.58, drag: 0.992, bounce: 0.38, spin: 0.62, ttl0: 620, ttl1: 430, push: 0.2 }
          : meta.mat === 'stone'
            ? { grav: 0.95, drag: 0.998, bounce: 0.14, spin: 0.26, ttl0: 1050, ttl1: 550, push: 0.15 }
            : { grav: 0.8, drag: 0.999, bounce: 0.1, spin: 0.32, ttl0: 1050, ttl1: 550, push: 0.18 };
    const cw = meta.w / cols;
    const ch = meta.h / rows;
    const pushX = impulse ? impulse.x * feel.push : 0;
    const pushY = impulse ? impulse.y * feel.push : 0;
    // 撞击方向（单位向量）：碎块整体顺着"被打的方向"崩出去，散开后各自带一点乱飞
    const iLen = impulse ? Math.hypot(impulse.x, impulse.y) : 0;
    const ux = iLen > 0.01 ? (impulse as { x: number }).x / iLen : 0;
    const uy = iLen > 0.01 ? (impulse as { y: number }).y / iLen : 0;
    const along = Math.min(2.6, iLen * 0.16);

    this.flashes.push({ x: pos.x, y: pos.y, w: meta.w, h: meta.h, angle, life: 90, ttl: 90 });

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const lx = (c + 0.5) * cw - meta.w / 2;
        const ly = (r + 0.5) * ch - meta.h / 2;
        const hw = (cw * sizeK * (0.76 + Math.random() * 0.16)) / 2;
        const hh = (ch * sizeK * (0.76 + Math.random() * 0.16)) / 2;
        const jx = (): number => (Math.random() - 0.5) * cw * 0.3;
        const jy = (): number => (Math.random() - 0.5) * ch * 0.3;
        const spread = 0.9 + Math.random() * 1.9;
        const dirX = meta.w > 0 ? lx / (meta.w / 2) : 0;
        const dirY = meta.h > 0 ? ly / (meta.h / 2) : 0;
        const ttl = feel.ttl0 + Math.random() * feel.ttl1;
        this.shards.push({
          x: pos.x + lx * cos - ly * sin,
          y: pos.y + lx * sin + ly * cos,
          vx: dirX * spread * 1.7 + (Math.random() - 0.5) * 1.4 + pushX + ux * along,
          vy: dirY * spread * 1.1 - 1.7 - Math.random() * 1.6 + pushY + uy * along,
          rot: angle,
          spin: (Math.random() - 0.5) * feel.spin,
          hw,
          hh,
          pts: [
            -hw + jx(),
            -hh + jy(),
            hw + jx(),
            -hh + jy(),
            hw + jx(),
            hh + jy(),
            -hw + jx(),
            hh + jy(),
          ],
          mat: meta.mat,
          grav: feel.grav,
          drag: feel.drag,
          bounce: feel.bounce,
          life: ttl,
          ttl,
        });
      }
    }

    // 金属断裂：从中缝甩出一串亮火星（铁皮崩开是会冒火的）
    if (meta.mat === 'metal') {
      const n = 8 + Math.round(Math.min(1, iLen / 14) * 6);
      for (let i = 0; i < n; i += 1) {
        const a = Math.atan2(uy, ux) + (Math.random() - 0.5) * 2.2;
        const sp = 2.6 + Math.random() * 5.4;
        const ttl = 130 + Math.random() * 190;
        this.sparks.push({
          x: pos.x + (Math.random() - 0.5) * meta.w * 0.5,
          y: pos.y + (Math.random() - 0.5) * meta.h * 0.5,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 0.6,
          len: 6 + Math.random() * 7,
          rot: a,
          mat: 'metal',
          life: ttl,
          ttl,
        });
      }
      this.rings.push({ x: pos.x, y: pos.y, r: 6, max: 34 + meta.w * 0.16, life: 200, ttl: 200 });
    } else if (meta.mat === 'glass') {
      // 玻璃：几粒高光碎屑，闪一下就没了，别在画面上糊成一片
      for (let i = 0; i < 5; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1.8 + Math.random() * 2.6;
        const ttl = 110 + Math.random() * 120;
        this.sparks.push({
          x: pos.x + (Math.random() - 0.5) * meta.w * 0.8,
          y: pos.y + (Math.random() - 0.5) * meta.h * 0.8,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 0.5,
          len: 3 + Math.random() * 4,
          rot: a,
          mat: 'glass',
          life: ttl,
          ttl,
        });
      }
    }
    if (this.sparks.length > 120) this.sparks.splice(0, this.sparks.length - 120);

    // 石头的尘土更浓（砸开一块石头是"噗"的一团灰），铁皮最少
    const puffK = meta.mat === 'stone' ? 1.6 : meta.mat === 'metal' ? 0.6 : 1;
    const puffCount = Math.round((4 + Math.round((meta.w + meta.h) / 150)) * puffK);
    for (let i = 0; i < puffCount; i += 1) {
      const ttl = 320 + Math.random() * 200;
      this.puffs.push({
        x: pos.x + (Math.random() - 0.5) * meta.w * 0.85,
        y: pos.y + (Math.random() - 0.5) * meta.h * 0.85,
        vx: (Math.random() - 0.5) * 2.4 + pushX * 0.5,
        vy: -Math.random() * 1.2 - 0.2,
        r: 10 + Math.random() * 13,
        grow: 0.34 + Math.random() * 0.3,
        life: ttl,
        ttl,
        mat: meta.mat,
      });
    }

    // 一次大爆炸（教授猪）可能同时炸掉十几个方块，给粒子做个上限兜住帧率
    if (this.shards.length > 220) this.shards.splice(0, this.shards.length - 220);
    if (this.puffs.length > 160) this.puffs.splice(0, this.puffs.length - 160);
  }

  /**
   * 撞击表现：一记材质敲击音 + 从接触点甩出去的火星 + 一点尘。
   * 石/铁这种硬材质多给一圈白色小冲击波和更沉的震动，木/玻璃只给几粒碎屑，
   * 这样"咚"和"叮"的手感能听出来、也能看出来。
   */
  private spawnImpactFx(
    pos: { x: number; y: number },
    speed: number,
    meta: BlockDef,
    otherVel: { x: number; y: number },
  ): void {
    const mat = meta.mat;
    const k = Math.max(0, Math.min(1, speed / 12));
    // 全局再节流一次：爆炸掀飞十几块时别把撞击音砸成噪音墙（粒子照常给）
    if (this.time - this.impactSfxAt > 45) {
      this.impactSfxAt = this.time;
      this.cbs.onSfx(MATERIALS[mat].hitSfx, k);
    }

    // 撞击方向：沿撞击方的运动方向往外甩
    const dirLen = Math.hypot(otherVel.x, otherVel.y) || 1;
    const dirX = otherVel.x / dirLen;
    const dirY = otherVel.y / dirLen;
    const hard = mat === 'stone' || mat === 'metal';
    const count = (hard ? 2 : 3) + Math.round(k * 4);
    for (let i = 0; i < count; i += 1) {
      const a = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 2.4;
      const sp = 1.4 + Math.random() * (2.6 + k * 3.4);
      const ttl = 90 + Math.random() * 110;
      this.sparks.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 0.4,
        len: hard ? 4 + Math.random() * 4 : 6 + Math.random() * 7,
        rot: a,
        mat,
        life: ttl,
        ttl,
      });
    }
    if (this.sparks.length > 120) this.sparks.splice(0, this.sparks.length - 120);

    // 硬材质再补一圈小白环，撞击点更"实"
    if (hard && speed > 6) {
      const max = 18 + speed * 1.5;
      this.rings.push({ x: pos.x, y: pos.y, r: 5, max, life: 190, ttl: 190 });
    }
    // 木/玻璃带一点材质尘，石/铁几乎不掉粉（它们硬，碎屑阶段才有）
    if (!hard) {
      const ttl = 200 + Math.random() * 140;
      this.puffs.push({
        x: pos.x,
        y: pos.y,
        vx: dirX * 0.9 + (Math.random() - 0.5) * 0.8,
        vy: dirY * 0.6 - Math.random() * 0.5,
        r: 4 + Math.random() * 4,
        grow: 0.22,
        life: ttl,
        ttl,
        mat,
      });
    }

    this.addShake(hard ? 0.3 + k * 0.8 : 0.12 + k * 0.42);
  }

  /**
   * 受伤掉屑：方块没碎但累计了伤害时，从撞击侧崩几颗小碎屑 + 一撮粉尘。
   * 纯视觉粒子（有 ttl、不参与物理），避免"打了一拳没反应"的钝感。
   */
  private spawnChips(
    pos: { x: number; y: number },
    angle: number,
    meta: BlockDef,
    harm: number,
    otherVel: { x: number; y: number },
  ): void {
    const profile = MATERIALS[meta.mat];
    const count = harm >= CRACK_HEAVY ? 4 : profile.debris === 'shard' ? 3 : 2;
    for (let i = 0; i < count; i += 1) {
      const hw = 2.4 + Math.random() * 3.2;
      const hh = 1.8 + Math.random() * 2.6;
      const ttl = 380 + Math.random() * 280;
      const jx = (): number => (Math.random() - 0.5) * hw * 0.7;
      const jy = (): number => (Math.random() - 0.5) * hh * 0.7;
      this.shards.push({
        x: pos.x + (Math.random() - 0.5) * meta.w * 0.7,
        y: pos.y + (Math.random() - 0.5) * meta.h * 0.7,
        vx: otherVel.x * 0.14 + (Math.random() - 0.5) * 3.2,
        vy: otherVel.y * 0.12 - Math.random() * 2.2 - 0.4,
        rot: angle + (Math.random() - 0.5) * 0.8,
        spin: (Math.random() - 0.5) * 0.5,
        hw,
        hh,
        pts: [-hw + jx(), -hh + jy(), hw + jx(), -hh + jy(), hw + jx(), hh + jy(), -hw + jx(), hh + jy()],
        mat: meta.mat,
        life: ttl,
        ttl,
      });
    }
    const ttl = 220 + Math.random() * 140;
    this.puffs.push({
      x: pos.x + (Math.random() - 0.5) * meta.w * 0.5,
      y: pos.y + (Math.random() - 0.5) * meta.h * 0.5,
      vx: otherVel.x * 0.06 + (Math.random() - 0.5) * 0.9,
      vy: -Math.random() * 0.7 - 0.1,
      r: 5 + Math.random() * 5,
      grow: 0.3,
      life: ttl,
      ttl,
      mat: meta.mat,
    });
    this.addShake(0.1 + harm * 0.3);
    if (this.shards.length > 220) this.shards.splice(0, this.shards.length - 220);
    if (this.puffs.length > 160) this.puffs.splice(0, this.puffs.length - 160);
  }

  /* ---------------- 机关：炸药箱引信 / 弹簧板 ---------------- */

  /** 点着炸药箱的引信：延迟一点点再炸，让"沙—轰"和补爆的先后看得见 */
  private lightFuse(body: Matter.Body, delay = TNT.fuseMs): void {
    if (!this.blockMeta.has(body.id)) return;
    if (this.tntFuses.has(body.id)) return;
    this.tntFuses.set(body.id, this.time + delay);
    this.cbs.onSfx('fuse');
    // 引信火星：从箱顶往上跳几颗亮黄小碎屑
    for (let i = 0; i < 6; i += 1) {
      const ttl = 200 + Math.random() * 160;
      const hw = 1.4 + Math.random() * 1.8;
      const hh = 1.2 + Math.random() * 1.4;
      this.shards.push({
        x: body.position.x + (Math.random() - 0.5) * 10,
        y: body.position.y - 6,
        vx: (Math.random() - 0.5) * 2.6,
        vy: -Math.random() * 2.4 - 0.6,
        rot: Math.random() * 6.28,
        spin: (Math.random() - 0.5) * 0.6,
        hw,
        hh,
        pts: [-hw, -hh, hw, -hh, hw, hh, -hw, hh],
        mat: 'wood',
        life: ttl,
        ttl,
      });
    }
  }

  /** 引信到期就把箱子推进破块队列，剩下的交给 drainBreaks（含爆炸与连锁计数） */
  private updateFuses(): void {
    if (this.tntFuses.size === 0) return;
    const due: number[] = [];
    this.tntFuses.forEach((at, id) => {
      if (this.time >= at) due.push(id);
    });
    due.forEach((id) => {
      this.tntFuses.delete(id);
      const body = this.blockBodies.find((b) => b.id === id);
      if (!body) return;
      if (!this.breakQueue.includes(body)) this.breakQueue.push(body);
    });
  }

  /**
   * 弹簧板弹射：物体砸在板正面（法向速度够快）就被沿法线甩出去，
   * 切向速度保留一部分，所以斜着砸上去会斜着飞。木箱、石块、小猪都能被弹，
   * 于是"弹簧板 → 撞塌墙 → 墙砸到炸药箱"这类连锁能自然发生。
   */
  private trySpring(spring: SpringRuntime, other: Matter.Body): void {
    if (other.isStatic) return;
    if (this.time < spring.readyAt) return;
    if (this.time < this.armedAt) return;
    const nx = spring.nx;
    const ny = spring.ny;
    const v = other.velocity;
    const along = v.x * nx + v.y * ny;
    // along < 0 = 正在砸向板面，这是主要触发方式
    const approach = -along;
    // 板面法线是竖直方向，纯横向冲过来的猪法向速度几乎为 0，光看 along 永远弹不起来；
    // 所以补一条「踩在正面 + 有速度」的判定，让滚/擦上板子的物件也能被弹
    const side =
      (other.position.x - spring.body.position.x) * nx +
      (other.position.y - spring.body.position.y) * ny;
    const runSpeed = Math.hypot(v.x, v.y);
    const impact = approach >= SPRING.minSpeed ? approach : side > 0 ? runSpeed * SPRING.grazeKeep : 0;
    if (impact < SPRING.minSpeed) return;

    spring.readyAt = this.time + SPRING.cooldownMs;
    spring.firedAt = this.time;

    const bonus = Math.min(SPRING.maxBonus, impact * 0.55);
    const speed = Math.min(SPRING.maxSpeed, (SPRING.power + bonus) * (spring.def.power ?? 1));
    const tx = v.x - nx * along;
    const ty = v.y - ny * along;
    Body.setVelocity(other, {
      x: nx * speed + tx * SPRING.tangentKeep,
      y: ny * speed + ty * SPRING.tangentKeep,
    });
    Body.setAngularVelocity(other, other.angularVelocity * 0.35 + (Math.random() - 0.5) * 0.14);

    const p = spring.body.position;
    const intensity = Math.min(1, impact / 14);
    this.addShake(0.35 + intensity * 0.7);
    this.cbs.onSfx('spring', intensity);
    // 金色冲击环 + 一圈尘土：让"被弹起来"有明确的受力方向
    this.rings.push({
      x: p.x,
      y: p.y,
      r: Math.min(spring.def.w, spring.def.h) * 0.3,
      max: spring.def.w * 0.8,
      life: 300,
      ttl: 300,
    });
    for (let i = 0; i < 4; i += 1) {
      const ttl = 240 + Math.random() * 160;
      this.puffs.push({
        x: p.x + (Math.random() - 0.5) * spring.def.w,
        y: p.y + ny * 6 + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 2 + nx * 1.6,
        vy: -Math.random() * 0.8 + ny * 1.2,
        r: 6 + Math.random() * 6,
        grow: 0.34,
        life: ttl,
        ttl,
        mat: 'wood',
      });
    }
    if (this.puffs.length > 160) this.puffs.splice(0, this.puffs.length - 160);
  }

  private onBirdHit(bird: BirdRuntime): void {
    const pig = this.pigBody;
    if (!pig) return;

    // 钢盔猪顶鸟：不减速，直接把鸟撞飞，还白拿一份捕捉分
    if (this.pigType !== 'helmet') {
      if (this.time < this.immuneUntil) {
        this.cbs.onSfx('click');
        return;
      }
      const v = pig.velocity;
      Body.setVelocity(pig, { x: -v.x * 0.4, y: -v.y * 0.25 - 2 });
      Body.setAngularVelocity(pig, (Math.random() - 0.5) * 0.4);
    }
    this.captureBird(bird);
    this.cbs.onSfx('bonk');
  }

  /**
   * 撞飞一只鸟：+150 分，剪断脚本轨迹让它变成自由刚体翻着飞出去。
   * 受击瞬间给闪白、一蓬羽毛、一圈白环和 `+150` 飘字，900ms 后淡出离场。
   */
  private captureBird(bird: BirdRuntime): void {
    if (bird.captured) return;
    bird.captured = true;
    bird.hitAt = this.time;
    // 通关后（pendingWin 已冻结结算分数）撞到的鸟只留表现、不再计分，
    // 否则 HUD 会比结算面板多出 150 分，同样属于"分数跳变"。
    const scored = !this.pendingWin;
    if (scored) {
      this.birdScore += BIRD_SCORE;
      this.birdsCaptured += 1;
      this.score += BIRD_SCORE;
    }
    const pos = bird.body.position;
    const pig = this.pigBody;
    const dir = pig
      ? Vector.normalise(Vector.sub(pos, pig.position))
      : { x: 0.4, y: -1 };
    Body.setStatic(bird.body, false);
    Body.setVelocity(bird.body, { x: dir.x * 11, y: dir.y * 8 - 4 });
    Body.setAngularVelocity(bird.body, (Math.random() - 0.5) * 1.6);
    // 被撞飞的方向决定朝向：从左边被撞就往右翻着飞，看起来才像"被推走"
    bird.face = dir.x >= 0 ? 1 : -1;
    this.puffs.push({
      x: pos.x,
      y: pos.y,
      r: 10,
      grow: 1.5,
      life: 1,
      ttl: 0.42,
      vx: 0,
      vy: -0.4,
      mat: 'wood',
    });
    // 羽毛：暖白小短线，飘得慢、活得久
    for (let i = 0; i < 9; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.6 + Math.random() * 3.4;
      const ttl = 420 + Math.random() * 320;
      this.sparks.push({
        x: pos.x + Math.cos(a) * 6,
        y: pos.y + Math.sin(a) * 6,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.1,
        len: 7 + Math.random() * 7,
        rot: a,
        mat: 'wood',
        life: ttl,
        ttl,
        feather: true,
      });
    }
    if (this.sparks.length > 120) this.sparks.splice(0, this.sparks.length - 120);
    this.rings.push({ x: pos.x, y: pos.y, r: 8, max: 52, life: 200, ttl: 200 });
    if (scored) this.pushText(pos.x, pos.y - 34, `+${BIRD_SCORE}`, '#fff3ad', 17);
    this.addShake(0.5);
    this.emit();
  }

  /* ---------------- 流程 ---------------- */

  private win(): void {
    if (this.state === 'won' || this.state === 'lost') return;
    this.state = 'won';
    const used = Math.max(1, this.level.pigs.length - this.pigQueue.length);
    const unused = this.pigQueue.length;
    const pigBonus = unused * PIG_LEFT_BONUS;
    const eggBonus = EGG_BONUS;
    this.score = totalScore({
      breakScore: this.breakScore,
      chainBonus: this.chainBonus,
      birdScore: this.birdScore,
      pigBonus,
      eggBonus,
    });
    const rating = rateStars({
      breakScore: this.breakScore,
      chainBonus: this.chainBonus,
      birdScore: this.birdScore,
      pigBonus,
      eggBonus,
      usedPigs: used,
      maxChain: this.maxChain,
      birdsCaptured: this.birdsCaptured,
      levelWorth: this.levelWorth,
    });
    this.cbs.onSfx('win');

    // 鸟蛋到手的高光：蛋鼓起来、晃两下、浮起来，两圈白环 + 金色星芒 + 飘字
    const egg = this.level.egg;
    this.eggPickAt = this.time;
    this.rings.push({ x: egg.x, y: egg.y, r: egg.r * 0.7, max: egg.r * 3.2, life: 380, ttl: 380 });
    this.rings.push({ x: egg.x, y: egg.y, r: egg.r * 0.4, max: egg.r * 5, life: 560, ttl: 560 });
    for (let i = 0; i < 12; i += 1) {
      const a = (Math.PI * 2 * i) / 12 + Math.random() * 0.3;
      const sp = 2.4 + Math.random() * 2.6;
      const ttl = 420 + Math.random() * 260;
      this.sparks.push({
        x: egg.x,
        y: egg.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 0.8,
        len: 9 + Math.random() * 8,
        rot: a,
        mat: 'glass',
        life: ttl,
        ttl,
        feather: true,
      });
    }
    this.pushText(egg.x, egg.y - egg.r * 2.6, '抢到鸟蛋！', '#ffeaa0', 24);
    this.addShake(1.2);
    // 抢到蛋的镜头反馈：轻微推近（低动态模式下 camPunch 恒为 0，见 setReduceMotion）
    this.camPunch = Math.max(this.camPunch, 0.85);

    // 结算面板延后弹出：先让玩家看完这 760ms 的动画
    this.pendingWin = {
      levelIndex: this.level.index,
      score: this.score,
      stars: rating.stars,
      usedPigs: used,
      maxChain: this.maxChain,
      breakScore: this.breakScore,
      chainBonus: this.chainBonus,
      birdScore: this.birdScore,
      pigBonus,
      eggBonus,
      brokenBlocks: this.brokenBlocks,
      birdsCaptured: this.birdsCaptured,
      goals: rating.goals,
    };
    this.pendingWinAt = this.time + EGG_PICK_MS;
    this.emit();
  }

  private lose(): void {
    if (this.state === 'won' || this.state === 'lost') return;
    this.state = 'lost';
    // 失败镜头：一次"沉下去"的轻微震动，不推近也不拉远，避免玩家还要晕一次
    this.addShake(0.9);
    this.cbs.onSfx('lose');
    this.cbs.onLose({
      // 猪根本没飞起来（理论上不会发生）时用一个明确的"很远"值兜底
      closest: Number.isFinite(this.shotClosest) ? Math.round(this.shotClosest) : 9999,
      contacts: this.shotContacts,
      far: Number.isFinite(this.shotFar) ? Math.round(this.shotFar) : 0,
      tntLeft: [...this.blockMeta.values()].filter((d) => d.tnt).length,
      springLeft: this.springs.filter((sp) => sp.firedAt < 0).length,
    });
    this.emit();
  }

  private nextPig(): void {
    if (this.state === 'won' || this.state === 'lost') return;
    if (this.pigBody) {
      Composite.remove(this.world, this.pigBody);
      this.pigBody = null;
    }
    if (this.pigQueue.length > 0) {
      this.selected = Math.min(this.selected, this.pigQueue.length - 1);
      this.spawnPig();
    } else {
      this.lose();
    }
  }

  /**
   * 切换动画强度（标准 / 低动态）。只影响渲染层：震动幅度、粒子上限、装饰性摆动，
   * 物理、弹道、命中判定与计分一行都不变。
   */
  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
    if (on) this.camPunch = 0;
  }

  retry(): void {
    Events.off(this.engine, 'collisionStart', this.onCollision);
    this.buildWorld();
    this.camInit = false;
    this.camFollow = 0;
    this.camPunch = 0;
    this.emit();
  }

  /* ---------------- 循环 ---------------- */

  start(): void {
    if (this.raf) return;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.detachInput();
    Events.off(this.engine, 'collisionStart', this.onCollision);
    Composite.clear(this.world, false, true);
    Engine.clear(this.engine);
  }

  private loop = (t: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(50, t - this.lastT);
    this.lastT = t;
    this.time = t;
    // 建世界时挂起的开场保护，在第一帧拿到真实时间戳后落定；
    // 之后的物理步进都在 armedAt 之前，落位抖动不会引爆 TNT / 踩响弹簧板
    if (this.armPending) {
      this.armedAt = this.time + ARM_DELAY_MS;
      this.armPending = false;
    }

    const flightSpeed =
      this.state === 'flying' && this.pigBody
        ? Math.hypot(this.pigBody.velocity.x, this.pigBody.velocity.y)
        : 0;
    const slowmo = flightSpeed > FLIGHT_SLOWMO_SPEED ? FLIGHT_SLOWMO : 1;
    const sdt = dt * slowmo;
    this.simClock += sdt;

    const active = this.state === 'aiming' || this.state === 'flying';
    if (active) {
      this.acc = Math.min(this.acc + sdt, STEP * 4);
      let guard = 0;
      while (this.acc >= STEP && guard < 4) {
        Engine.update(this.engine, STEP);
        this.updateBirds();
        this.updatePig();
        this.updateFuses();
        this.drainBreaks();
        // 每 8 步收敛一次静止刚体，压掉残余抖动又不影响正在滚动的物件
        this.calmTick = (this.calmTick + 1) % 8;
        if (this.calmTick === 0) this.calmResting();
        this.acc -= STEP;
        guard += 1;
        if (this.state !== 'aiming' && this.state !== 'flying') break;
      }
    } else {
      this.acc = 0;
    }
    this.updatePigAnim(sdt);
    this.updateBirdAnims(sdt);
    if (this.fireT >= 0) {
      this.fireT += dt;
      const fireMs =
        this.launcher === 'sling'
          ? SLING_RELEASE_MS
          : launcherFireMs(this.launcher === 'cannon' ? CANNON : TREBUCHET);
      if (this.fireT > fireMs) this.fireT = -1;
    }
    this.updateFx(dt);
    if (this.pendingWinAt > 0 && this.time >= this.pendingWinAt && this.pendingWin) {
      const result = this.pendingWin;
      this.pendingWin = null;
      this.pendingWinAt = -1;
      this.cbs.onWin(result);
    }
    this.camPunch = Math.max(0, this.camPunch - dt / 260);
    this.updateCamera(dt);
    this.render();
  };

  private updateBirds(): void {
    const tSec = this.simClock / 1000;
    this.birds.forEach((bird) => {
      if (bird.captured) {
        // 受击的鸟：闪白一下、翻着飞出画面，900ms 后彻底离场（不做无限掉落的背景杂物）
        if (!bird.dead && this.time - bird.hitAt > 900) {
          bird.dead = true;
          Composite.remove(this.world, bird.body);
        }
        return;
      }
      const def = bird.def;
      if (def.kind === 'red') return;
      if (def.kind === 'blue') {
        const a = tSec * def.speed + bird.offset;
        Body.setPosition(bird.body, {
          x: def.cx + Math.cos(a) * def.rx,
          y: def.cy + Math.sin(a) * def.ry,
        });
        bird.dash = false;
        return;
      }
      const total = def.restTime * 2 + def.dashTime * 2;
      const phase = tSec % total;
      const startX = def.x;
      const startY = def.y;
      const smooth = (k: number): number => k * k * (3 - 2 * k);
      let k = 0;
      let moving = false;
      if (phase < def.restTime) {
        k = 0;
      } else if (phase < def.restTime + def.dashTime) {
        k = smooth((phase - def.restTime) / def.dashTime);
        moving = true;
      } else if (phase < def.restTime * 2 + def.dashTime) {
        k = 1;
      } else {
        k = 1 - smooth((phase - def.restTime * 2 - def.dashTime) / def.dashTime);
        moving = true;
      }
      Body.setPosition(bird.body, {
        x: startX + (def.dashToX - startX) * k,
        y: startY + (def.dashToY - startY) * k,
      });
      bird.dash = moving;
    });
    if (this.birds.some((b) => b.dead)) this.birds = this.birds.filter((b) => !b.dead);
  }

  /**
   * 鸟的帧动画：红鸟定点守卫一直待机，黄鸟俯冲时切飞行帧，蓝鸟永远在绕圈飞行。
   * 用真实 dt 推进（不是物理步长），和猪的动画同一个节奏来源。
   */
  private updateBirdAnims(dt: number): void {
    this.birds.forEach((bird) => {
      const kind = bird.def.kind;

      // 朝向按真实位移算：蓝鸟绕圈回到右半边时翻面，红鸟站桩时保持原朝向不乱翻
      const dx = bird.lastX === -1e9 ? 0 : bird.body.position.x - bird.lastX;
      bird.lastX = bird.body.position.x;
      if (Math.abs(dx) > 0.08) {
        bird.face = dx > 0 ? 1 : -1;
        bird.faceHold = 0;
      } else {
        bird.faceHold += 1;
      }

      // 被撞：先受击挤压 200ms，然后进入坠落姿态（引擎已给真实自转，这里只补轻微摇摆）
      if (bird.captured) {
        bird.anim.playState(this.time - bird.hitAt < 200 ? 'hit' : 'fall');
        bird.anim.update(dt, 12);
        return;
      }

      // 红鸟不再是静态贴纸：被撞飞/失重下落时按速度切成飞行帧，落地站稳后再回待机
      const falling = kind === 'red' && Math.hypot(bird.body.velocity.x, bird.body.velocity.y) > 1.4;
      const flying = kind === 'blue' ? true : kind === 'yellow' ? bird.dash : falling;
      bird.anim.playState(flying ? 'fly' : 'idle');
      bird.anim.update(dt, flying ? (kind === 'blue' ? 18 : 22) : 0);
    });
  }

  private updatePig(): void {
    if (this.state !== 'flying' || !this.pigBody) return;
    const p = this.pigBody.position;
    const egg = this.level.egg;
    const distToEgg = Math.hypot(p.x - egg.x, p.y - egg.y);
    if (distToEgg < this.shotClosest) this.shotClosest = distToEgg;
    if (p.x > this.shotFar) this.shotFar = p.x;
    if (distToEgg < egg.r + PIG_RADIUS * 0.92) {
      this.win();
      return;
    }
    // 飞行拖尾：速度越快越密越大，慢速时和原来一样淡，别糊成一条白带
    const v = this.pigBody.velocity;
    const fast = Math.min(1, Math.hypot(v.x, v.y) / 16);
    if (this.time - this.trailAt > 128 - fast * 26) {
      this.trailAt = this.time;
      const ttl = 150 + fast * 60 + Math.random() * 60;
      const jitter = (Math.random() - 0.5) * (1.2 + fast * 2.4);
      this.puffs.push({
        x: p.x - v.x * 0.45 + jitter,
        y: p.y - v.y * 0.45 + jitter * 0.7,
        vx: (Math.random() - 0.5) * 0.3 - v.x * 0.012,
        vy: (Math.random() - 0.5) * 0.3 - v.y * 0.012 - 0.18,
        r: 3.8 + fast * 3.2 + Math.random() * 2.4,
        grow: 0.1 + fast * 0.06 + Math.random() * 0.07,
        life: ttl,
        ttl,
        mat: 'glass',
      });
      if (this.puffs.length > 160) this.puffs.splice(0, this.puffs.length - 160);
    }
    const out = p.y > 1050 || p.x > 2500 || p.x < -250;
    const speed = Vector.magnitude(this.pigBody.velocity);
    if (out) {
      this.nextPig();
      return;
    }
    if (speed < 0.4 && !this.dragging) {
      this.settleFrames += 1;
      if (this.settleFrames > 42) this.nextPig();
    } else {
      this.settleFrames = 0;
    }
  }

  /**
   * 帧动画状态机：
   *   aiming → aim（随拉力压低身体）
   *   flying → launch / hit / skill 这些一次性动作播完自动回落；平时按速度在 fly / idle 之间切，
   *            从飞行真正落地那一下补一个 land 压扁
   *   won / lost → win / defeat（循环，直到面板出现）
   * 双阈值（>2.2 起飞 / <0.8 落地）避免停在斜坡上反复闪烁。
   */
  private updatePigAnim(dt: number): void {
    if (!this.pigBody || !this.pigType) {
      this.pigAnim.reset();
      return;
    }
    const anim = this.pigAnim;
    const v = this.pigBody.velocity;
    const speed = Math.hypot(v.x, v.y);

    if (this.state === 'aiming') {
      anim.playState('aim');
      anim.update(dt, speed, this.pullPower());
      return;
    }
    if (this.state === 'won') {
      anim.playState('win');
      anim.update(dt, 0);
      return;
    }
    if (this.state === 'lost') {
      anim.playState('defeat');
      anim.update(dt, 0);
      return;
    }

    // 飞行中：正在播的一次性动作（launch/hit/skill）不许被顶掉
    if (!anim.busy) {
      const moving = speed > (anim.state === 'fly' ? 0.8 : 2.2);
      if (moving) {
        anim.playState('fly');
        this.pigWasAirborne = true;
      } else if (anim.state === 'fly' && this.pigWasAirborne) {
        anim.playState('land', { after: 'idle' });
        this.pigWasAirborne = false;
      } else {
        anim.playState('idle');
      }
    }
    anim.update(dt, speed);
  }

  /**
   * 镜头震动：所有事件都从这里走。
   * - 低于 0.05 的小冲击直接忽略（碎一粒渣、轻蹭一下不该晃屏）；
   * - 叠加后最多到 SHAKE_MAX，整座楼塌下来也只会晃一个固定幅度。
   */
  private addShake(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0.05) return;
    // 低动态模式：震动幅度压到 35%，保留"撞到了"的信息，但不再晃眼
    const scaled = this.reduceMotion ? amount * 0.35 : amount;
    this.shake = Math.min(SHAKE_MAX, this.shake + scaled);
  }

  /** 世界内飘字（连锁层数、抢到鸟蛋），同屏最多 14 条 */
  private pushText(x: number, y: number, text: string, color: string, size: number): void {
    this.texts.push({ x, y, text, color, size, life: FLOAT_TEXT_TTL, ttl: FLOAT_TEXT_TTL });
    if (this.texts.length > 14) this.texts.splice(0, this.texts.length - 14);
  }

  private updateFx(dt: number): void {
    const k = dt / 16.666;

    // 低动态模式：粒子上限压到一半，塌楼时不会满屏碎屑（保留"碎了"的信息量）
    if (this.reduceMotion) {
      if (this.shards.length > 110) this.shards.splice(0, this.shards.length - 110);
      if (this.puffs.length > 80) this.puffs.splice(0, this.puffs.length - 80);
      if (this.sparks.length > 60) this.sparks.splice(0, this.sparks.length - 60);
    }

    this.shards = this.shards.filter((s) => {
      const grav = s.grav ?? 0.62;
      const bounce = s.bounce ?? 0.3;
      s.vy += grav * k;
      if (s.drag !== undefined && s.drag < 1) {
        const d = Math.pow(s.drag, k);
        s.vx *= d;
        s.vy *= d;
      }
      s.x += s.vx * k;
      s.y += s.vy * k;
      s.rot += s.spin * k;
      s.life -= dt;
      // 落地：弹一下再躺住，比直接穿地有分量
      const floor = GROUND_Y - s.hh * 0.7;
      if (s.y > floor) {
        s.y = floor;
        if (Math.abs(s.vy) > 1.2) {
          s.vy = -s.vy * bounce;
          s.vx *= 0.62;
          s.spin *= 0.5;
        } else {
          s.vy = 0;
          s.vx *= 0.82;
          s.spin *= 0.7;
        }
      }
      return s.life > 0;
    });

    this.puffs = this.puffs.filter((p) => {
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.vx *= 0.94;
      p.r += p.grow * k * 2.4;
      p.life -= dt;
      return p.life > 0;
    });

    this.flashes = this.flashes.filter((f) => {
      f.life -= dt;
      return f.life > 0;
    });

    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      return r.life > 0;
    });

    this.blasts = this.blasts.filter((b) => {
      b.life -= dt;
      return b.life > 0;
    });

    this.sparks = this.sparks.filter((sp) => {
      sp.vx *= 0.93;
      sp.vy = sp.vy * 0.95 + (sp.feather ? 0.05 : 0.16) * k;
      sp.x += sp.vx * k;
      sp.y += sp.vy * k;
      sp.rot += (sp.feather ? 0.012 : 0.05) * k;
      sp.life -= dt;
      return sp.life > 0;
    });

    this.texts = this.texts.filter((f) => {
      // 前 40% 生命上浮得快，后面慢慢停住，看起来像"蹦出来的字"
      f.y -= dt * (f.life / f.ttl > 0.6 ? 0.05 : 0.016);
      f.life -= dt;
      return f.life > 0;
    });

    this.shake = Math.max(0, this.shake - dt * 0.055);
  }

  private updateCamera(dt: number): void {
    const fitScale = Math.min(this.cssW / WORLD_WIDTH, this.cssH / WORLD_HEIGHT);
    const followScale = Math.min(this.cssW / 1250, this.cssH / 760);
    const anchor = this.level.launchPoint;
    const flyingPig = this.state === 'flying' ? this.pigBody : null;
    // 只有真的"飞出去了"才推近：还在炮口附近就切特写，画面会整个跳一下
    const dist = flyingPig
      ? Math.hypot(flyingPig.position.x - anchor.x, flyingPig.position.y - anchor.y)
      : 0;
    const want = flyingPig && dist > CAM_FOLLOW_AFTER ? 1 : 0;
    // 推近慢（约 0.4s 才到位）、退回快（下一发马上要看到全景）
    const tau = want > this.camFollow ? 300 : 150;
    this.camFollow += (want - this.camFollow) * (1 - Math.exp(-dt / tau));

    const targetScale =
      (fitScale + (followScale - fitScale) * this.camFollow) *
      this.camZoom *
      (1 + this.camPunch * 0.05);
    const limitX = this.cssW / (2 * targetScale);
    const limitY = this.cssH / (2 * targetScale);
    // 视口比世界还大时别硬夹（否则瞄准态的中心会被推走 130px，拖拽点全部错位）
    const clampX = (v: number) =>
      limitX * 2 >= WORLD_WIDTH ? WORLD_WIDTH / 2 : Math.max(limitX, Math.min(WORLD_WIDTH - limitX, v));
    const clampY = (v: number) =>
      limitY * 2 >= WORLD_HEIGHT ? v : Math.max(limitY, Math.min(WORLD_HEIGHT - limitY, v));
    const rest = { x: clampX(WORLD_WIDTH / 2), y: clampY(WORLD_HEIGHT / 2 - 20) };
    let tx = rest.x;
    let ty = rest.y;
    if (flyingPig) {
      // 中心按同一个权重混合：缩放和位移同步推进，才不会出现"先拉近再飘过去"
      tx = rest.x + (clampX(flyingPig.position.x) - rest.x) * this.camFollow;
      ty = rest.y + (clampY(flyingPig.position.y) - rest.y) * this.camFollow;
    }

    if (!this.camInit) {
      this.cam = { x: tx, y: ty, scale: targetScale };
      this.camInit = true;
      return;
    }
    const k = 1 - Math.exp(-dt / (flyingPig ? 90 : 140));
    this.cam.scale += (targetScale - this.cam.scale) * k;
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  }

  /* ---------------- 渲染 ---------------- */

  private render(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    // 世界矩形之外的兜底色（相机缩到最小时才看得见）
    drawBackdropScreen(ctx, this.cssW, this.cssH);

    ctx.save();
    ctx.translate(this.cssW / 2, this.cssH / 2);
    if (this.shake > 0.2) {
      const s = this.shake;
      ctx.translate(
        Math.sin(this.time * 0.09) * s * 0.6 + (Math.random() - 0.5) * s * 0.4,
        Math.cos(this.time * 0.13) * s * 0.5 + (Math.random() - 0.5) * s * 0.4,
      );
      ctx.rotate(Math.sin(this.time * 0.07) * s * 0.0006);
    }
    ctx.scale(this.cam.scale, this.cam.scale);
    ctx.translate(-this.cam.x, -this.cam.y);

    drawBackdrop(ctx, this.cssW / 2 / this.cam.scale);
    // 远坡树丛随风轻摆（低动态模式只停摆、不消失）
    drawWindTrees(ctx, this.reduceMotion ? 0 : this.time / 1000, this.reduceMotion);
    drawClouds(ctx, this.time);
    // 环境动态（草摆 + 浮尘）：低动态模式直接归零，其余情况只是绘制层，不进物理
    const sway = this.reduceMotion ? 0 : this.time / 1000;
    drawAmbient(ctx, WORLD_WIDTH, GROUND_Y, sway, this.reduceMotion ? 0 : 1);
    drawTerrain(ctx, GROUND_Y, sway);

    this.wheelBodies.forEach((body) => {
      const r = this.wheelRadii.get(body.id);
      if (!r) return;
      drawWheel(ctx, body.position.x, body.position.y, r, body.angle);
    });

    // 弹簧板画在方块之前：放在板上的箱子会自然地盖住板面
    this.springs.forEach((sp) => {
      const elapsed = sp.firedAt < 0 ? 1e9 : this.time - sp.firedAt;
      const press =
        elapsed > SPRING.squashMs + SPRING.reboundMs
          ? 0
          : elapsed < SPRING.squashMs
            ? 1
            : 1 - (elapsed - SPRING.squashMs) / SPRING.reboundMs;
      drawSpring(
        ctx,
        sp.body.position.x,
        sp.body.position.y,
        sp.def.w,
        sp.def.h,
        sp.def.angle ?? 0,
        press,
        this.time,
        GROUND_Y,
      );
    });

    this.blockBodies.forEach((body) => {
      const meta = this.blockMeta.get(body.id);
      if (!meta) return;
      const dmgState = this.blockDamage.get(body.id);
      const fuseAt = this.tntFuses.get(body.id);
      const fuse = fuseAt === undefined ? 0 : Math.max(0, Math.min(1, 1 - (fuseAt - this.time) / TNT.fuseMs));
      drawBlock(
        ctx,
        body.position.x,
        body.position.y,
        meta.w,
        meta.h,
        body.angle,
        meta.mat,
        1,
        meta.tnt === true,
        dmgState ? dmgState.dmg : 0,
        dmgState ? dmgState.seed : body.id,
        fuse,
        this.time,
        dmgState && (dmgState.hx !== 0 || dmgState.hy !== 0)
          ? { x: dmgState.hx, y: dmgState.hy }
          : undefined,
      );
    });
    drawFlashes(ctx, this.flashes);

    if (this.eggBody) {
      const pick = this.eggPickAt < 0 ? 0 : Math.min(1, (this.time - this.eggPickAt) / EGG_PICK_MS);
      drawEgg(ctx, this.eggBody.position.x, this.eggBody.position.y, this.level.egg.r, this.time, pick);
    }

    this.birds.forEach((bird) => {
      const kind = bird.def.kind;
      // 红鸟被撞飞/掉下去时按横向速度前倾一点，落地站稳就回正；黄/蓝鸟保持脚本摆位不加旋转
      let spin = 0;
      if (kind === 'red') {
        const v = bird.body.velocity;
        if (Math.hypot(v.x, v.y) > 1.4) spin = Math.max(-0.55, Math.min(0.55, v.x * 0.05));
      }
      // 受击的鸟：闪白 220ms，520ms 后开始淡出，配合羽毛一起消失
      let flash = 0;
      let alpha = 1;
      if (bird.captured) {
        const since = this.time - bird.hitAt;
        flash = Math.max(0, 1 - since / 220);
        if (since > 520) alpha = Math.max(0, 1 - (since - 520) / 340);
      }
      drawBird(
        ctx,
        bird.body.position.x,
        bird.body.position.y,
        kind,
        this.time,
        bird.anim.snapshot(),
        spin,
        flash,
        alpha,
        bird.face,
      );
    });

    const anchor = this.level.launchPoint;
    const showLoaded = this.state === 'aiming' && this.pigType !== null;
    if (this.launcher === 'sling') {
      drawSling(
        ctx,
        anchor.x,
        anchor.y,
        GROUND_Y,
        this.fireT >= 0 ? this.fireT / SLING_RELEASE_MS : -1,
      );
    } else {
      const sheet = this.launcher === 'cannon' ? CANNON : TREBUCHET;
      const fireFrame = this.fireT >= 0 ? launcherFireFrame(sheet, this.fireT) : null;
      if (this.launcher === 'cannon') drawCannon(ctx, anchor.x, anchor.y, GROUND_Y, fireFrame);
      else drawTrebuchet(ctx, anchor.x, anchor.y, fireFrame);
    }
    // 瞄准中的拉杆：先画最大拉伸圈，再画被拉长的皮筋，最后贴小猪
    const dragPos = this.dragPos;
    const pulling = this.dragging && dragPos !== null;
    const pullPower = pulling ? this.pullPower() : 0;
    if (pulling && dragPos) {
      drawPullLimit(ctx, anchor, pullPower);
      drawPullBand(ctx, anchor, dragPos, pullPower);
    }
    // 发射器不做"皮兜拉拽"：小猪直接坐在炮口/抛兜里，瞄准靠弹道预览看角度
    if (showLoaded && this.pigType) {
      const tilt = this.dragging ? 0.08 : 0;
      drawPig(ctx, anchor.x, anchor.y, tilt, PIG_RADIUS, this.pigType, this.pigAnim.snapshot());
    }

    const plan = this.buildAimPlan();
    if (plan) drawAimPlan(ctx, plan, this.level.egg, this.time);

    if (this.pigFlying && this.pigBody && this.pigType) {
      const v = this.pigBody.velocity;
      drawSpeedLines(
        ctx,
        this.pigBody.position.x,
        this.pigBody.position.y,
        v.x,
        v.y,
        Math.hypot(v.x, v.y),
        PIG_RADIUS,
      );
      drawPig(
        ctx,
        this.pigBody.position.x,
        this.pigBody.position.y,
        this.pigBody.angle,
        PIG_RADIUS,
        this.pigType,
        this.pigAnim.snapshot(),
      );
      this.drawSkillFx(ctx, this.pigBody.position.x, this.pigBody.position.y, v.x, v.y);
    }

    // 破碎表现压在小猪之上：碎块是从方块里"崩"出来的，盖住飞行的猪更符合直觉
    drawPuffs(ctx, this.puffs);
    drawShards(ctx, this.shards);
    drawShockwaves(ctx, this.rings);
    drawSparks(ctx, this.sparks);
    drawBlasts(ctx, this.blasts);

    drawForeground(ctx, GROUND_Y, WORLD_WIDTH, sway);
    // 飘字压在最后：连锁层数、抢到鸟蛋这些提示必须盖住一切
    drawFloatTexts(ctx, this.texts);
    ctx.restore();

    // 力度/角度读数画在屏幕空间（底边居中，不随相机缩放糊掉）
    if (plan && dragPos) {
      const dx = anchor.x - dragPos.x;
      const dy = anchor.y - dragPos.y;
      drawAimReadout(
        ctx,
        this.cssW,
        this.cssH,
        (Math.atan2(-dy, dx) * 180) / Math.PI,
        pullPower,
        this.aimStatus(plan),
      );
    }
  }

  /** 当前拉力占满拉的比例（0~1） */
  private pullPower(): number {
    if (!this.dragPos) return 0;
    const anchor = this.level.launchPoint;
    const d = Math.hypot(anchor.x - this.dragPos.x, anchor.y - this.dragPos.y);
    return Math.max(0, Math.min(1, d / MAX_PULL));
  }

  /**
   * 瞄准期的完整预测：与物理同一套离散步进（含空气阻力），分段推进 ——
   * 第一段弹道 → 撞穿可碎方块后带着 0.72 冲量续飞 → 撞到弹簧板按机关参数折向 → 落地后估算滚行。
   * 小鸟按脚本外推（与 updateBirds 同构），顺带判断拦截与鸟蛋可达性。
   */
  private buildAimPlan(): AimPlan | null {
    if (!this.dragging || !this.dragPos) return null;
    const anchor = this.level.launchPoint;
    const dx = anchor.x - this.dragPos.x;
    const dy = anchor.y - this.dragPos.y;
    if (Math.hypot(dx, dy) < 12) return null;
    // 拉伸向量没变且离上次不到 1/30 秒，直接用上一帧的结果（小鸟会动，所以不能无限缓存）
    if (this.aimPlanAt >= 0 && this.time - this.aimPlanAt < AIM_REFRESH_MS && dx === this.aimPlanDx && dy === this.aimPlanDy) {
      return this.aimPlan;
    }
    this.aimPlanAt = this.time;
    this.aimPlanDx = dx;
    this.aimPlanDy = dy;
    this.syncAimScene();
    return predictAim(
      {
        start: { x: anchor.x, y: anchor.y },
        vx: dx * LAUNCH_FACTOR,
        vy: dy * LAUNCH_FACTOR,
        frictionAir: PIG_AIR_FRICTION,
        gravityStep: GRAVITY_STEP,
        radius: AIM_RADIUS,
        groundRadius: PIG_RADIUS,
        stepMs: STEP,
        now: this.simClock / 1000,
        pigPower: PIG_POWER[this.pigType ?? 'normal'],
        groundY: GROUND_Y,
        boxes: this.aimBoxes,
        springs: this.aimSprings,
        circles: this.aimCircles,
        birds: this.aimBirds,
        egg: this.level.egg,
      },
      this.aimPlan,
    );
  }

  /** 把当前局面同步进预测场景：数组与对象全部复用，拖动时不产生新对象 */
  private syncAimScene(): void {
    let n = 0;
    this.blockBodies.forEach((body) => {
      const meta = this.blockMeta.get(body.id);
      if (!meta) return;
      const pool = this.aimBoxPool;
      const box: AimBox = pool[n] ?? (pool[n] = { minX: 0, minY: 0, maxX: 0, maxY: 0, mat: 'wood', tnt: false });
      const b = body.bounds;
      box.minX = b.min.x;
      box.minY = b.min.y;
      box.maxX = b.max.x;
      box.maxY = b.max.y;
      box.mat = meta.mat;
      box.tnt = meta.tnt === true;
      this.aimBoxes[n] = box;
      n += 1;
    });
    this.aimBoxes.length = n;

    n = 0;
    this.springs.forEach((spring) => {
      // 冷却中的弹簧板不会弹，预测里也不该画成弹射
      if (this.time < spring.readyAt) return;
      const pool = this.aimSpringPool;
      const item: AimSpring = pool[n] ??
        (pool[n] = { minX: 0, minY: 0, maxX: 0, maxY: 0, x: 0, y: 0, nx: 0, ny: -1, power: 1 });
      const b = spring.body.bounds;
      item.minX = b.min.x;
      item.minY = b.min.y;
      item.maxX = b.max.x;
      item.maxY = b.max.y;
      item.x = spring.body.position.x;
      item.y = spring.body.position.y;
      item.nx = spring.nx;
      item.ny = spring.ny;
      item.power = spring.def.power ?? 1;
      this.aimSprings[n] = item;
      n += 1;
    });
    this.aimSprings.length = n;

    n = 0;
    this.wheelBodies.forEach((body) => {
      const r = this.wheelRadii.get(body.id);
      if (!r) return;
      const pool = this.aimCirclePool;
      const item: AimCircle = pool[n] ?? (pool[n] = { x: 0, y: 0, r: 0 });
      item.x = body.position.x;
      item.y = body.position.y;
      item.r = r;
      this.aimCircles[n] = item;
      n += 1;
    });
    this.aimCircles.length = n;

    n = 0;
    this.birds.forEach((bird) => {
      if (bird.captured || bird.dead) return;
      const def = bird.def;
      const pool = this.aimBirdPool;
      const item: AimBird = pool[n] ?? (pool[n] = {
        kind: 'red',
        r: 26,
        x: 0,
        y: 0,
        phase: 0,
        reach: 0,
        motion: {
          type: 'static',
          toX: 0,
          toY: 0,
          restMs: 0,
          dashMs: 0,
          cx: 0,
          cy: 0,
          rx: 0,
          ry: 0,
          speed: 0,
        },
      });
      item.kind = def.kind;
      item.r = def.kind === 'yellow' ? 24 : def.kind === 'blue' ? 18 : 26;
      const m = item.motion;
      if (def.kind === 'yellow') {
        // 冲刺脚本的基准点是关卡里配的停歇位，不是"当前所在位置"（否则中途外推会整体偏移）
        item.x = def.x;
        item.y = def.y;
        m.type = 'dash';
        m.toX = def.dashToX;
        m.toY = def.dashToY;
        m.restMs = def.restTime * 1000;
        m.dashMs = def.dashTime * 1000;
        item.reach = Math.hypot(m.toX - def.x, m.toY - def.y);
      } else if (def.kind === 'blue') {
        item.x = def.cx;
        item.y = def.cy;
        m.type = 'orbit';
        m.cx = def.cx;
        m.cy = def.cy;
        m.rx = def.rx;
        m.ry = def.ry;
        m.speed = def.speed;
        item.phase = bird.offset;
        item.reach = Math.max(def.rx, def.ry);
      } else {
        item.x = bird.body.position.x;
        item.y = bird.body.position.y;
        m.type = 'static';
        item.reach = 0;
      }
      this.aimBirds[n] = item;
      n += 1;
    });
    this.aimBirds.length = n;
  }

  /** 预测结论翻成一句人话（画在力度条上方，玩家不用自己猜） */
  private aimStatus(plan: AimPlan): AimStatus {
    if (plan.egg === 'direct') return { text: '直击鸟蛋', tone: 'green' };
    if (plan.egg === 'roll') return { text: '慢速滑进鸟窝', tone: 'gold' };
    if (plan.intercept.on) {
      const name = plan.intercept.kind === 'yellow' ? '黄鸟' : plan.intercept.kind === 'blue' ? '蓝鸟' : '红鸟';
      return { text: `${name}会拦下这一发`, tone: 'alarm' };
    }
    if (plan.egg === 'uncertain') return { text: '擦着蛋边，可能进', tone: 'gold' };
    if (plan.egg === 'blocked') return { text: '被挡住，打不到蛋', tone: 'muted' };
    return { text: '这一发够不着鸟蛋', tone: 'muted' };
  }

  /* ---------------- 外部控制 ---------------- */

  resize(): void {
    const parent = this.canvas.parentElement;
    const rect = parent?.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect?.width ?? 960));
    const h = Math.max(240, Math.round(rect?.height ?? 540));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = w;
    this.cssH = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camInit = false;
  }

  zoom(dir: number): void {
    this.camZoom = Math.max(0.85, Math.min(1.8, this.camZoom + dir * 0.15));
    this.camInit = false;
  }

  private emit(): void {
    this.cbs.onSnapshot({
      levelIndex: this.level.index,
      levelId: this.level.id,
      levelName: this.level.name,
      score: this.score,
      pigs: this.pigQueue,
      currentIndex: this.selected,
      activePig: this.pigType,
      state: this.state,
      skillUsed: this.skillUsed,
      canUseSkill: this.state === 'flying' && !this.skillUsed && this.pigType !== null,
      chain: this.time < this.chainUntil ? this.chain : 0,
      maxChain: this.maxChain,
    });
  }
}
