/**
 * 关卡平衡测试工具（第三轮）：把**真引擎**跑在 Node 里，批量发射并记录结果。
 *
 * 设计约束（对齐需求文档的第二阶段）：
 * - 物理/判定/评分全部来自 src/game，不另写一套模拟；
 * - 关卡数据 `structuredClone` 一份再用，绝不改动 LEVELS 原件；
 * - 不接 onWin 入档：只把结果塞进内存，不写 localStorage、不做成就、不碰累计统计；
 * - 不改正式游戏运行时（引擎只被实例化在测试进程里，render 直接置空）；
 * - 随机数用固定种子（mulberry32）覆盖 Math.random，保证同参数可复现，另跑多组种子看稳定性。
 *
 * 用法：见 scripts/balance/sweep.mjs（CLI）与 scripts/balance/analyze.mjs（汇总）。
 */

import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const bundlePath = path.join(tmpdir(), 'pig-balance-bundle.cjs');

const noop = () => undefined;

/* ---------------- 浏览器环境替身（引擎构造需要 canvas/window） ---------------- */

function fakeCtx() {
  const gradient = { addColorStop: noop };
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => {
          if (prop === 'measureText') return { width: 0 };
          if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return gradient;
          return undefined;
        };
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    },
  );
}

function fakeCanvas(width = 1280, height = 720) {
  const ctx = fakeCtx();
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ x: 0, y: 0, width, height, left: 0, top: 0 }),
    addEventListener: noop,
    removeEventListener: noop,
    parentElement: null,
    setAttribute: noop,
  };
}

/** 把浏览器 API 的最小替身挂到 globalThis；必须在 import bundle 之前调用 */
function installEnv() {
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = noop;
  globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
  globalThis.Image = class {
    set src(_value) {}
    get width() {
      return 0;
    }
    get height() {
      return 0;
    }
  };
  globalThis.fetch = () => Promise.reject(new Error('offline test env'));
  globalThis.location = { protocol: 'file:' };
  const storage = { getItem: () => null, setItem: noop, removeItem: noop };
  globalThis.localStorage = storage;
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener: noop,
    removeEventListener: noop,
    location: { protocol: 'file:' },
    localStorage: storage,
  };
  globalThis.document = {
    createElement: () => fakeCanvas(),
    addEventListener: noop,
    removeEventListener: noop,
    getElementById: () => null,
  };
}

/* ---------------- 打包 + 载入 ---------------- */

let gamePromise = null;

/** esbuild 打包 scripts/balance/entry.ts → /tmp/pig-balance-bundle.cjs，然后 import */
export function loadGame() {
  if (!gamePromise) {
    gamePromise = (async () => {
      await esbuild.build({
        entryPoints: [path.join(here, 'entry.ts')],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        outfile: bundlePath,
        logLevel: 'error',
      });
      installEnv();
      return import(`file://${bundlePath}?v=${Date.now()}`);
    })();
  }
  return gamePromise;
}

/* ---------------- 随机数：固定种子，保证同参数可复现 ---------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REAL_RANDOM = Math.random;

export function seedRandom(seed) {
  Math.random = mulberry32(seed);
}

export function restoreRandom() {
  Math.random = REAL_RANDOM;
}

/* ---------------- 单次运行（一关一局，可含多次发射） ---------------- */

const STEP = 16.666;
/** 每帧最多推进的物理步数（与引擎主循环的 acc 上限一致） */
const MAX_FRAMES_PER_SHOT = 900;
/** 发射前的静置时间：让开场保护（340ms）过期，同时观察开局有没有自毁 */
const SETTLE_MS = 2400;

/**
 * 建立一局：克隆关卡 → 建引擎 → 静置 SETTLE_MS，记录开局状态。
 * @returns {Promise<{eng: object, level: object, settle: object}>}
 */
export async function createRun(levelId, options = {}) {
  const game = await loadGame();
  const source = game.LEVELS.find((lv) => lv.id === levelId);
  if (!source) throw new Error(`没有这一关：${levelId}`);
  return createRunFromLevel(structuredClone(source), options);
}

/**
 * 用一份「已经在内存里改过」的关卡数据建一局（lab.mjs 试改动用）。
 * 传入对象不会被克隆，调用方自己负责别动 LEVELS 原件。
 */
export async function createRunFromLevel(level, options = {}) {
  const game = await loadGame();
  const { GameEngine } = game;

  const sink = { win: null, lose: null, snapshots: 0 };
  const eng = new GameEngine(fakeCanvas(), level, {
    onSnapshot: () => {
      sink.snapshots += 1;
    },
    onWin: (result) => {
      sink.win = result;
    },
    onLose: () => {
      sink.lose = true;
    },
    onSfx: noop,
  });
  // 测试只跑物理与判定，不画一帧
  eng.render = noop;

  let clock = 10_000;
  const frame = () => {
    clock += STEP;
    eng.loop(clock);
  };
  frame();
  frame();
  const settleStart = { score: eng.score, broken: eng.brokenBlocks };
  const settleFrames = Math.ceil(SETTLE_MS / STEP);
  for (let i = 0; i < settleFrames; i += 1) frame();

  return {
    game,
    eng,
    level,
    sink,
    frame,
    settle: {
      /** 静置期间白送的分数（>0 说明开局自毁，关卡不合格） */
      score: eng.score - settleStart.score,
      broken: eng.brokenBlocks - settleStart.broken,
      maxChain: eng.maxChain,
      /** 静置结束时方块位移（检查"慢慢滑开"） */
      drift: blockDrift(eng),
    },
  };
}

function blockDrift(eng) {
  let worst = 0;
  eng.blockBodies.forEach((body) => {
    const def = eng.blockMeta.get(body.id);
    if (!def) return;
    const d = Math.hypot(body.position.x - def.x, body.position.y - def.y);
    if (d > worst) worst = d;
  });
  return Math.round(worst * 10) / 10;
}

/**
 * 打一发。
 * @param {object} run createRun 的返回值
 * @param {{angleDeg:number, pull:number, pigIndex?:number, skillAtStep?:number, skillAtX?:number}} shot
 */
export function shoot(run, shot) {
  const { eng, frame } = run;
  const angleDeg = shot.angleDeg;
  const pull = shot.pull;
  if (eng.state !== 'aiming') {
    return { skipped: true, state: eng.state };
  }
  if (shot.pigIndex && shot.pigIndex > 0) eng.selectPig(shot.pigIndex);
  const pigType = eng.pigType;
  const anchor = eng.level.launchPoint;
  const rad = (angleDeg * Math.PI) / 180;
  const scoreBefore = eng.score;
  const brokenBefore = eng.brokenBlocks;
  const birdsBefore = eng.birdsCaptured;

  eng.dragging = true;
  eng.dragPos = { x: anchor.x - Math.cos(rad) * pull, y: anchor.y + Math.sin(rad) * pull };
  eng.onPointerUp();

  const egg = eng.level.egg;
  let minEggDist = Infinity;
  let lastPos = null;
  let steps = 0;
  let frames = 0;
  let skillFired = false;
  let winAtFrame = -1;

  while (frames < MAX_FRAMES_PER_SHOT) {
    if (eng.state === 'flying' && eng.pigBody) {
      steps += 1;
      const p = eng.pigBody.position;
      lastPos = { x: Math.round(p.x), y: Math.round(p.y) };
      const d = Math.hypot(p.x - egg.x, p.y - egg.y);
      if (d < minEggDist) minEggDist = d;
      if (!skillFired && shot.skillAtStep && steps >= shot.skillAtStep) {
        skillFired = true;
        eng.triggerSkill();
      }
      if (!skillFired && shot.skillAtX && p.x >= shot.skillAtX) {
        skillFired = true;
        eng.triggerSkill();
      }
    }
    frame();
    frames += 1;
    if (eng.state === 'won') {
      if (winAtFrame < 0) winAtFrame = frames;
      // 通关动画 760ms 后才回调，这里等它把 WinResult 交出来
      if (run.sink.win) break;
    }
    if (eng.state === 'lost') break;
    // 回到瞄准态 = 这一发结束了（猪停下/掉出世界，下一只已装填）
    if (frames > 4 && eng.state === 'aiming') break;
  }

  const win = run.sink.win && run.sink.win.usedPigs === countUsed(eng, run) ? run.sink.win : null;
  return {
    pigType,
    angleDeg,
    pull,
    skillFired,
    minEggDist: Number.isFinite(minEggDist) ? Math.round(minEggDist) : null,
    lastPos,
    frames,
    state: eng.state,
    win,
    scoreDelta: eng.score - scoreBefore,
    brokenDelta: eng.brokenBlocks - brokenBefore,
    birdsDelta: eng.birdsCaptured - birdsBefore,
    alpha: !!win,
  };
}

function countUsed(eng, run) {
  return Math.max(1, run.level.pigs.length - eng.pigQueue.length);
}

/**
 * 连续打多发的完整一局。每发之间自动装填下一只猪（引擎的 nextPig）。
 * @param {string} levelId
 * @param {Array<{angleDeg:number,pull:number,pigIndex?:number,skillAtStep?:number,skillAtX?:number}>} shots
 */
export async function playSequence(levelId, shots, options = {}) {
  seedRandom(options.seed ?? 1);
  const run = await createRun(levelId);
  const perShot = [];
  for (const shot of shots) {
    if (run.eng.state !== 'aiming' && run.eng.state !== 'flying') break;
    perShot.push(shoot(run, shot));
    if (run.sink.win) break;
    if (run.eng.state === 'lost') break;
  }
  const win = run.sink.win;
  const result = {
    levelId,
    seed: options.seed ?? 1,
    won: !!win,
    shots: perShot.length,
    plan: shots,
    perShot,
    settle: run.settle,
    score: win?.score ?? run.eng.score,
    stars: win?.stars ?? 0,
    usedPigs: win?.usedPigs ?? null,
    breakScore: win?.breakScore ?? run.eng.breakScore,
    chainBonus: win?.chainBonus ?? run.eng.chainBonus,
    birdScore: win?.birdScore ?? run.eng.birdScore,
    pigBonus: win?.pigBonus ?? 0,
    eggBonus: win?.eggBonus ?? 0,
    maxChain: win?.maxChain ?? run.eng.maxChain,
    birdsCaptured: win?.birdsCaptured ?? run.eng.birdsCaptured,
    brokenBlocks: win?.brokenBlocks ?? run.eng.brokenBlocks,
    goals: win?.goals ?? [],
    levelWorth: run.eng.levelWorth,
    /** 最后一次发射后猪停在哪、离蛋多远（失败原因的原始数据） */
    tail: perShot.length ? perShot[perShot.length - 1] : null,
    lose: !!run.sink.lose,
  };
  // 显式销毁：Composite.clear + Engine.clear，避免批量跑时残留刚体
  run.eng.destroy();
  return result;
}

export const LIMITS = {
  step: STEP,
  maxFramesPerShot: MAX_FRAMES_PER_SHOT,
  settleMs: SETTLE_MS,
};
