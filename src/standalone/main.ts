/* ============================================================
 * 《贪吃的绿皮猪》离线单文件版入口
 * ------------------------------------------------------------
 * 纯 JS/DOM，不依赖任何框架；游戏本体复用 src/game 下的引擎/绘制/关卡模块，
 * 由 scripts/build-standalone.mjs 用 esbuild 打成单个 game.js（Matter.js 一起打进包），
 * 因此 public/standalone/index.html 双击（file://）就能玩，不需要开发服务器。
 * ============================================================ */

import { SoundKit } from '../game/audio';
import { GameEngine } from '../game/engine';
import { LEVELS } from '../game/levels';
import { PIG_SHEETS, setSpriteBase, spriteUrl } from '../game/sprite';
import {
  applyWin,
  loadProgress,
  resetProgress,
  saveProgress,
  type Progress,
} from '../game/storage';
import { ACHIEVEMENTS, ACHIEVEMENT_MAP, SNIPER_GOAL, type AchievementId } from '../game/achievements';
import { describeLose } from '../game/feedback';
import { PIG_INFO } from '../game/types';
import type { LoseInfo, PigType, Snapshot, WinResult } from '../game/types';

// file:// 下 `/sprites/...` 会指到磁盘根目录，这里统一切成相对路径
setSpriteBase('.');

const STAR_PATH =
  'M12 2.4l2.95 5.98 6.6.96-4.77 4.65 1.12 6.57L12 17.5l-5.9 3.06 1.12-6.57L2.45 9.34l6.6-.96z';
const CARD_ACCENT = ['#e2811e', '#5aa32f', '#2e8ec4', '#c9932b', '#c0392b'];

type Screen = 'menu' | 'levels' | 'help' | 'achievements' | 'reset' | 'play';

interface AppState {
  screen: Screen;
  levelIndex: number;
  snapshot: Snapshot | null;
  progress: Progress;
  result: WinResult | null;
  failed: boolean;
  /** 失败原因素材（引擎给的客观事实，措辞走 feedback.ts） */
  loseInfo: LoseInfo | null;
  /** 本次结算新解锁的成就（结算面板用金色横幅提示） */
  unlocked: AchievementId[];
}

function must<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`缺少节点：${selector}`);
  return el;
}

const canvas = must<HTMLCanvasElement>('#game');
const hud = must<HTMLDivElement>('#hud');
const overlay = must<HTMLDivElement>('#overlay');
const pigbar = must<HTMLDivElement>('#pigbar');
const hintEl = must<HTMLParagraphElement>('#hint');
const levelIdEl = must<HTMLSpanElement>('#levelId');
const levelNameEl = must<HTMLSpanElement>('#levelName');
const scoreEl = must<HTMLSpanElement>('#score');
const chainBadgeEl = must<HTMLDivElement>('#chainBadge');
const chainNumEl = must<HTMLSpanElement>('#chainNum');
/** 连锁数字上一次显示的值：只有真正变大时才重播弹一下 */
let lastChain = 0;

const sound = new SoundKit();
const app: AppState = {
  screen: 'menu',
  levelIndex: 0,
  snapshot: null,
  progress: loadProgress(),
  result: null,
  failed: false,
  loseInfo: null,
  unlocked: [],
};

let engine: GameEngine | null = null;

sound.setMuted(!app.progress.soundOn);

/* ---------------- 小工具 ---------------- */

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function starSvg(filled: boolean, size: number, pop: boolean, delay: number): string {
  const gold = filled ? 'var(--gd-gold)' : '#dcd5c4';
  const base = filled ? 'var(--gd-gold-2)' : '#b7ae9b';
  const anim = pop && filled;
  const cls = anim ? ' class="gd-star-pop"' : '';
  const style = anim ? ` style="animation-delay:${delay}ms"` : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"${cls}${style}>
    <path d="${STAR_PATH}" transform="translate(0 0.9)" fill="${base}" stroke="var(--gd-ink)" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="${STAR_PATH}" fill="${gold}" stroke="var(--gd-ink)" stroke-width="1.7" stroke-linejoin="round"/>
    ${
      filled
        ? `<path d="M12 6.6 13.6 10.4 17.7 10.7 14.6 13.2 15.6 17.2 12 15 8.4 17.2 9.4 13.2 6.3 10.7 10.4 10.4Z" fill="#fff3ad" opacity="0.8"/>`
        : ''
    }
  </svg>`;
}

const STAR_STEP_MS = 180;

function starsRow(count: number, size: number, pop = false): string {
  const stage = pop && count > 0 ? 'gd-star-stage' : '';
  let html = `<span class="stars ${stage}">`;
  for (let i = 0; i < 3; i += 1) html += starSvg(i < count, size, pop, i * STAR_STEP_MS);
  return `${html}</span>`;
}

function pigPortraitStyle(type: PigType): string {
  return `background-image:url('${spriteUrl(PIG_SHEETS[type].src)}')`;
}

let starChimeTimers: number[] = [];

/** 结算星星逐颗弹出来时配脆响，和 180ms 的动画节奏对齐 */
function playStarChimes(count: number): void {
  starChimeTimers.forEach((t) => window.clearTimeout(t));
  starChimeTimers = [];
  for (let i = 0; i < count; i += 1) {
    starChimeTimers.push(
      window.setTimeout(() => {
        sound.play('star');
      }, i * STAR_STEP_MS + 60),
    );
  }
}

function totalStars(progress: Progress): number {
  return Object.values(progress.levels).reduce((sum, rec) => sum + rec.stars, 0);
}

/* ---------------- 关卡生命周期 ---------------- */

function startLevel(index: number): void {
  const level = LEVELS[index];
  if (!level) return;
  sound.unlock();
  sound.play('click');
  engine?.destroy();
  engine = null;

  app.screen = 'play';
  app.levelIndex = index;
  app.result = null;
  app.failed = false;
  app.loseInfo = null;
  app.snapshot = null;
  starChimeTimers.forEach((t) => window.clearTimeout(t));
  starChimeTimers = [];
  lastChain = 0;
  scoreShown = 0;

  engine = new GameEngine(canvas, level, {
    onSnapshot: (snapshot) => {
      app.snapshot = snapshot;
      renderHud();
    },
    onWin: (result) => {
      const lv = LEVELS[result.levelIndex];
      if (lv) {
        const { progress, unlocked } = applyWin(app.progress, lv.id, result, LEVELS.length);
        app.progress = progress;
        app.unlocked = unlocked;
        saveProgress(progress);
        if (unlocked.length > 0) {
          window.setTimeout(() => sound.play('star', 1), 700);
        }
      }
      app.result = result;
      renderOverlay();
      playStarChimes(result.stars);
    },
    onLose: (info) => {
      app.loseInfo = info;
      app.failed = true;
      renderOverlay();
    },
    onSfx: (name, power) => sound.play(name, power),
  });
  engine.start();
  engine.setReduceMotion(app.progress.motion === 'low');

  hud.hidden = false;
  // 场景淡入：新关卡不要"啪"地一下跳出来（低动态模式下由 CSS 缩短到 120ms）
  canvas.classList.remove('is-in');
  void canvas.offsetWidth;
  canvas.classList.add('is-in');
  renderHud();
  renderOverlay();
  window.setTimeout(() => engine?.resize(), 60);
}

function retryLevel(): void {
  sound.play('click');
  app.result = null;
  app.failed = false;
  app.loseInfo = null;
  app.unlocked = [];
  engine?.retry();
  lastChain = 0;
  scoreShown = 0;
  renderOverlay();
  renderHud();
}

function backToMenu(): void {
  sound.play('click');
  engine?.destroy();
  engine = null;
  app.snapshot = null;
  app.result = null;
  app.failed = false;
  app.loseInfo = null;
  app.unlocked = [];
  app.screen = 'menu';
  hud.hidden = true;
  renderOverlay();
}

function nextLevel(): void {
  const next = app.levelIndex + 1;
  if (next < LEVELS.length) {
    startLevel(next);
    return;
  }
  app.result = null;
  app.unlocked = [];
  app.screen = 'levels';
  hud.hidden = true;
  renderOverlay();
}

function toggleSound(): void {
  app.progress = { ...app.progress, soundOn: !app.progress.soundOn };
  saveProgress(app.progress);
  sound.setMuted(!app.progress.soundOn);
  if (app.progress.soundOn) sound.play('click');
  renderOverlay();
}

/** 动画档位：标准 / 低动态。只改渲染层的强度，物理与判定完全不变。 */
function toggleMotion(): void {
  const low = app.progress.motion === 'low';
  app.progress = { ...app.progress, motion: low ? 'standard' : 'low' };
  saveProgress(app.progress);
  engine?.setReduceMotion(!low);
  document.documentElement.classList.toggle('gd-low-motion', !low);
  sound.play('click');
  renderOverlay();
}

const MOTION_LABEL = (m: Progress['motion']): string =>
  m === 'low' ? '动画 低动态' : '动画 标准';

/* ---------------- HUD ---------------- */

/** 分数滚动：只在涨分时补间，掉分（重开）直接落到目标值。 */
let scoreShown = 0;
let scoreRaf = 0;
function setScoreValue(target: number): void {
  if (app.progress.motion === 'low') {
    scoreShown = target;
    scoreEl.textContent = String(target);
    return;
  }
  if (target <= scoreShown) {
    scoreShown = target;
    scoreEl.textContent = String(target);
    return;
  }
  const from = scoreShown;
  const start = performance.now();
  const dur = 320;
  if (scoreRaf) cancelAnimationFrame(scoreRaf);
  const step = (now: number): void => {
    const k = Math.min(1, (now - start) / dur);
    const eased = 1 - (1 - k) * (1 - k);
    scoreShown = Math.round(from + (target - from) * eased);
    scoreEl.textContent = String(scoreShown);
    if (k < 1) scoreRaf = requestAnimationFrame(step);
    else scoreRaf = 0;
  };
  scoreRaf = requestAnimationFrame(step);
}

function renderHud(): void {
  const snap = app.snapshot;
  const level = LEVELS[app.levelIndex];
  if (!level) return;
  levelIdEl.textContent = level.id;
  levelNameEl.textContent = level.name;
  setScoreValue(snap?.score ?? 0);
  const chain = snap?.chain ?? 0;
  chainNumEl.textContent = String(chain);
  chainBadgeEl.hidden = chain < 2;
  if (chain >= 2 && lastChain !== chain) {
    lastChain = chain;
    chainBadgeEl.classList.remove('is-pop');
    void chainBadgeEl.offsetWidth;
    chainBadgeEl.classList.add('is-pop');
  }

  if (!snap) {
    pigbar.innerHTML = '';
    hintEl.innerHTML = '';
    return;
  }

  const aiming = snap.state === 'aiming';
  pigbar.innerHTML = snap.pigs
    .map((type, i) => {
      const info = PIG_INFO[type];
      const sel = aiming && i === snap.currentIndex;
      return `<button type="button" class="pig ${sel ? 'is-sel' : ''}" data-act="pick" data-i="${i}"
        style="${pigPortraitStyle(type)}" aria-pressed="${sel}" aria-label="换上${esc(info.name)}"
        title="${esc(info.name)} · ${esc(info.skill)}"><span class="tag">${esc(info.name)}</span></button>`;
    })
    .join('');

  const active = snap.activePig ? PIG_INFO[snap.activePig] : null;
  let text: string;
  if (snap.state === 'flying') {
    if (snap.canUseSkill && active) {
      text =
        active.type === 'prof'
          ? '<b>点击画面引爆</b> 教授猪在空中炸开一片'
          : `<b>点击画面</b> 释放「${esc(active.skill)}」`;
    } else {
      text = '飞行中……等它落稳，再看下一发。';
    }
  } else if (snap.state === 'aiming') {
    text = active
      ? `拖着猪往后拉，松手发射 · 当前 <b>${esc(active.name)}</b>（${esc(active.skill)}）· 左下角头像可以换猪`
      : '拖着猪往后拉，松手发射';
  } else {
    text = snap.state === 'won' ? '偷到蛋了！' : '这关没偷到蛋。';
  }
  hintEl.innerHTML = text;
}

/* ---------------- 遮罩界面 ---------------- */

function menuHtml(): string {
  const firstUncleared = LEVELS.findIndex((lv) => (app.progress.levels[lv.id]?.stars ?? 0) === 0);
  const resumeIndex = firstUncleared === -1 ? 0 : firstUncleared;
  return `<div class="gd-panel gd-float-in sheet">
    <p class="subtitle">物理弹射 · 休闲小游戏</p>
    <h1 class="title">贪吃的绿皮猪</h1>
    <p class="note">10 关 · 弹射偷蛋</p>
    <p class="body-text">这次换猪来做主角。拖住投石车往后拉，把自己甩进小鸟看守的鸟巢堡垒，抢回鸟蛋就通关。共 10 关，越往后墙体越厚、守卫越多。</p>
    <div class="btn-col">
      <button type="button" class="gd-btn gd-btn--green big" data-act="play">${
        firstUncleared === -1 ? '再玩一次' : '开始游戏'
      }</button>
      <div class="btn-row">
        <button type="button" class="gd-btn gd-btn--gold" data-act="levels">关卡选择</button>
        <button type="button" class="gd-btn gd-btn--blue" data-act="help">玩法说明</button>
      </div>
      <div class="btn-row">
        <button type="button" class="gd-btn" data-act="achievements">成就 ${Object.keys(
          app.progress.achievements,
        ).length}/${ACHIEVEMENTS.length}</button>
        <button type="button" class="gd-btn" data-act="sound">${
          app.progress.soundOn ? '音效：开' : '音效：关'
        }</button>
        <button type="button" class="gd-btn" data-act="motion">${MOTION_LABEL(
          app.progress.motion,
        )}</button>
      </div>
    </div>
    <div class="foot"><span>总星 ${totalStars(app.progress)} / ${LEVELS.length * 3}</span><span>拖拽发射</span></div>
    <span hidden data-resume="${resumeIndex}"></span>
  </div>`;
}

function levelsHtml(): string {
  const cards = LEVELS.map((lv, i) => {
    const rec = app.progress.levels[lv.id];
    const accent = CARD_ACCENT[i % CARD_ACCENT.length];
    return `<button type="button" class="card" data-act="level" data-i="${i}" style="--accent:${accent}">
      <div class="head"><span class="id">${esc(lv.id)}</span><span class="name">${esc(lv.name)}</span></div>
      <div class="meta">
        <p>${esc(lv.hint)}</p>
        <div class="row">${starsRow(rec?.stars ?? 0, 14)}<span>分数 ${rec?.bestScore ?? 0}</span></div>
      </div>
    </button>`;
  }).join('');
  return `<div class="gd-panel gd-float-in sheet">
    <h2 class="section-title">关卡选择</h2>
    <p class="note">共 10 关：木巢 → 石墙 → 玻璃 → 三层塔 → 堡垒。打中炸药箱能连带掀塌一片。</p>
    <div class="cards">${cards}</div>
    <div class="foot">
      <button type="button" class="link-btn" data-act="achievements">成就 ${Object.keys(
        app.progress.achievements,
      ).length}/${ACHIEVEMENTS.length}</button>
      <span>总星数 ${totalStars(app.progress)} / ${LEVELS.length * 3}</span>
      <button type="button" class="link-btn" data-act="reset">重置进度</button>
    </div>
    <div class="btn-col">
      <button type="button" class="gd-btn" data-act="menu">返回主菜单</button>
    </div>
  </div>`;
}

function achievementsHtml(): string {
  const got = Object.keys(app.progress.achievements).length;
  const rows = ACHIEVEMENTS.map((a) => {
    const unlocked = Boolean(app.progress.achievements[a.id]);
    const birdProgress =
      a.id === 'sniper' ? `<span class="ach-progress">${Math.min(app.progress.totals.birds, SNIPER_GOAL)}/${SNIPER_GOAL}</span>` : '';
    return `<div class="ach-row ${unlocked ? 'is-on' : ''}">
      <span class="ach-badge">${unlocked ? '★' : '✗'}</span>
      <div class="ach-info">
        <div class="ach-name">${esc(a.name)}${birdProgress}${unlocked ? '<span class="ach-done">已达成</span>' : ''}</div>
        <p class="ach-desc">${esc(a.desc)}</p>
      </div>
    </div>`;
  }).join('');
  return `<div class="gd-panel gd-float-in sheet">
    <h2 class="section-title">成就</h2>
    <p class="note">已解锁 ${got} / ${ACHIEVEMENTS.length} · 进度与星级都存在本地浏览器</p>
    <div class="ach-list">${rows}</div>
    <div class="foot">
      <span>累计撞鸟 ${app.progress.totals.birds} 只</span>
      <span>累计拆块 ${app.progress.totals.blocks} 个</span>
      <span>通关 ${app.progress.totals.wins} 次</span>
    </div>
    <div class="btn-col">
      <button type="button" class="gd-btn" data-act="menu">返回主菜单</button>
    </div>
  </div>`;
}

function helpHtml(): string {
  return `<div class="gd-panel gd-float-in sheet">
    <h2 class="section-title">玩法说明</h2>
    <ul class="help-list">
      <li>按住画面里的猪，<b>往后（左下）拖</b>，拉得越远力度越大，松手弹出。</li>
      <li>拖动时会画出<b>完整弹道和落点圈</b>（与真实飞行同一套参数，含空气阻力），底部显示<b>力度与角度</b>，拉满时圆圈变金色。</li>
      <li>左下角头像可以<b>点选换猪</b>：厨师猪更重更能撞，钢盔猪能顶着石头走，教授猪飞行中<b>点击画面</b>就能原地引爆。</li>
      <li>第 5 关和第 10 关换成大炮，发射点更高、角度更平，弹道逻辑不变。</li>
      <li>猪碰到鸟蛋就通关；本关的小猪全部用完还没碰到蛋就失败，可以重来。</li>
      <li><b>TNT 炸药箱</b>一碰就着：引信先冒火星、箱体闪白，随即炸开，还会点燃附近的炸药箱。</li>
      <li><b>弹簧板</b>踩上去会把猪（或箱子）沿板面弹出去，撞得越狠弹得越高，板上的金箭头就是弹出方向。</li>
      <li>撞飞小鸟有额外加分，但<b>不是通关条件</b>；打碎木、石、玻璃、铁皮分数不同，炸药箱会连环引爆。</li>
      <li><b>三星评价</b>：抢到鸟蛋 ★ · 2 发以内通关 ★ · 破坏表现（打出连锁 ×3、撞飞小鸟或拆掉四成建筑，任一即可）★。</li>
      <li>分数构成：破坏建筑 + 连锁奖励 + 撞飞小鸟 + 剩余小猪（每只 +200）+ 抢到鸟蛋（+1000）；关卡星级与最高分都存在本地。</li>
    </ul>
    <div class="btn-col">
      <button type="button" class="gd-btn gd-btn--gold" data-act="menu">知道了</button>
    </div>
  </div>`;
}

function winHtml(result: WinResult): string {
  const level = LEVELS[result.levelIndex];
  const rec = level ? app.progress.levels[level.id] : undefined;
  const isLast = result.levelIndex + 1 >= LEVELS.length;
  return `<div class="gd-panel gd-float-in sheet">
    <h2 class="section-title">偷蛋成功！</h2>
    <p class="note">${esc(level?.id ?? '')} · ${esc(level?.name ?? '')}</p>
    <div class="result-stars">${starsRow(result.stars, 44, true)}</div>
    <div class="result-score">${result.score}</div>
    <div class="kv">
      <span>剩余猪 ${Math.max(0, (level?.pigs.length ?? 0) - result.usedPigs)} 只</span>
      <span>${result.maxChain >= 3 ? `最高连锁 ×${result.maxChain}` : '没打出连锁'}</span>
      <span>最高分 ${rec?.bestScore ?? result.score}</span>
    </div>
    <div class="breakdown">
      <span><i>破坏建筑</i><b>+${result.breakScore}</b></span>
      <span><i>连锁奖励</i><b>+${result.chainBonus}</b></span>
      <span><i>撞飞小鸟</i><b>+${result.birdScore}</b></span>
      <span><i>剩余小猪</i><b>+${result.pigBonus}</b></span>
      <span><i>抢到鸟蛋</i><b>+${result.eggBonus}</b></span>
    </div>
    <div class="goals">
      ${result.goals
        .map(
          (g) =>
            `<div class="goal-row ${g.reached ? 'is-on' : ''}"><span class="mark">${
              g.reached ? '✓' : '✗'
            }</span><span class="goal-label">${esc(g.label)}</span><span class="goal-hint">${esc(g.hint)}</span></div>`,
        )
        .join('')}
    </div>
    ${
      app.unlocked.length > 0
        ? `<div class="ach-toast"><span class="ach-toast-title">解锁成就</span><span class="ach-toast-names">${app.unlocked
            .map(
              (id, i) =>
                `<span class="ach-chip" style="animation-delay:${i * 160}ms">${esc(
                  ACHIEVEMENT_MAP[id]?.name ?? id,
                )}</span>`,
            )
            .join('')}</span></div>`
        : ''
    }
    <div class="btn-col">
      <button type="button" class="gd-btn gd-btn--green big" data-act="next">${
        isLast ? '看看全部关卡' : '下一关'
      }</button>
      <div class="btn-row">
        <button type="button" class="gd-btn gd-btn--gold" data-act="retry">再打一次</button>
        <button type="button" class="gd-btn" data-act="levels">关卡选择</button>
      </div>
    </div>
  </div>`;
}

function resetHtml(): string {
  return `<div class="gd-panel gd-float-in sheet">
    <h2 class="section-title">要重置全部进度吗？</h2>
    <p class="note">会清空 ${LEVELS.length} 关的星级与最高分、${ACHIEVEMENTS.length} 个成就，以及累计撞鸟 / 拆块 / 通关统计。这个操作没法撤销。</p>
    <div class="btn-col">
      <button type="button" class="gd-btn gd-btn--blue big" data-act="levels">再想想</button>
      <button type="button" class="gd-btn gd-btn--red big" data-act="reset-confirm">确认清空</button>
    </div>
  </div>`;
}

function loseText(): { reason: string; tip: string } {
  const level = LEVELS[app.levelIndex];
  if (level && app.loseInfo) return describeLose(app.loseInfo, level);
  return { reason: level?.hint ?? '鸟蛋还在房子里。', tip: '换个角度，或者先用 TNT 把外墙炸开。' };
}

function loseHtml(): string {
  const level = LEVELS[app.levelIndex];
  return `<div class="gd-panel gd-panel-shake sheet">
    <div class="sad-pig" aria-hidden="true" style="${pigPortraitStyle('normal')}"></div>
    <h2 class="section-title">猪掉光了……</h2>
    <p class="note">${esc(level?.id ?? '')} · ${esc(level?.name ?? '')}</p>
    <p class="body-text">${esc(loseText().reason)}</p>
    <p class="note">${esc(loseText().tip)}</p>
    <div class="btn-col">
      <button type="button" class="gd-btn gd-btn--green big" data-act="retry">重新开始</button>
      <div class="btn-row">
        <button type="button" class="gd-btn gd-btn--gold" data-act="levels">关卡选择</button>
        <button type="button" class="gd-btn" data-act="menu">返回主菜单</button>
      </div>
    </div>
  </div>`;
}

function renderOverlay(): void {
  if (app.result) {
    overlay.innerHTML = winHtml(app.result);
    overlay.hidden = false;
    return;
  }
  if (app.failed) {
    overlay.innerHTML = loseHtml();
    overlay.hidden = false;
    return;
  }
  if (app.screen === 'menu') {
    overlay.innerHTML = menuHtml();
    overlay.hidden = false;
    return;
  }
  if (app.screen === 'levels') {
    overlay.innerHTML = levelsHtml();
    overlay.hidden = false;
    return;
  }
  if (app.screen === 'help') {
    overlay.innerHTML = helpHtml();
    overlay.hidden = false;
    return;
  }
  if (app.screen === 'achievements') {
    overlay.innerHTML = achievementsHtml();
    overlay.hidden = false;
    return;
  }
  if (app.screen === 'reset') {
    overlay.innerHTML = resetHtml();
    overlay.hidden = false;
    return;
  }
  overlay.innerHTML = '';
  overlay.hidden = true;
}

/* ---------------- 交互 ---------------- */

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  const el = target?.closest<HTMLElement>('[data-act]');
  if (!el) return;
  const act = el.dataset.act ?? '';
  if (act === 'play') {
    const resume = overlay.querySelector<HTMLElement>('[data-resume]');
    const index = Number(resume?.dataset.resume ?? '0');
    startLevel(Number.isFinite(index) ? index : 0);
    return;
  }
  if (act === 'level') {
    const index = Number(el.dataset.i ?? '0');
    startLevel(Number.isFinite(index) ? index : 0);
    return;
  }
  if (act === 'pick') {
    const index = Number(el.dataset.i ?? '0');
    if (Number.isFinite(index)) engine?.selectPig(index);
    return;
  }
  if (act === 'levels') {
    app.screen = 'levels';
    renderOverlay();
    return;
  }
  if (act === 'help') {
    app.screen = 'help';
    renderOverlay();
    return;
  }
  if (act === 'achievements') {
    sound.play('click');
    app.screen = 'achievements';
    renderOverlay();
    return;
  }
  if (act === 'menu') {
    backToMenu();
    return;
  }
  if (act === 'retry') {
    retryLevel();
    return;
  }
  if (act === 'next') {
    nextLevel();
    return;
  }
  if (act === 'sound') {
    toggleSound();
    return;
  }
  if (act === 'motion') {
    toggleMotion();
    return;
  }
  if (act === 'reset') {
    // 先给确认面板，避免一键抹掉全部星级 / 成就
    sound.play('click');
    app.screen = 'reset';
    renderOverlay();
    return;
  }
  if (act === 'reset-confirm') {
    sound.play('click');
    app.progress = { ...resetProgress(), soundOn: app.progress.soundOn };
    saveProgress(app.progress);
    app.unlocked = [];
    app.result = null;
    app.screen = 'levels';
    renderOverlay();
    return;
  }
  if (act === 'zoom-in') {
    engine?.zoom(1);
    return;
  }
  if (act === 'zoom-out') {
    engine?.zoom(-1);
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'r' || event.key === 'R') {
    if (app.screen === 'play') retryLevel();
  }
  if (event.key === 'Escape') {
    if (app.screen === 'play') backToMenu();
  }
});

window.addEventListener('resize', () => engine?.resize());

/* ---------------- 启动 ---------------- */

document.documentElement.classList.toggle('gd-low-motion', app.progress.motion === 'low');
renderOverlay();
renderHud();
