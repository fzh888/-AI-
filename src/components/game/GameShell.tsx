'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Award,
  Check,
  HelpCircle,
  LayoutGrid,
  Play,
  RotateCcw,
  Sparkles,
  Star,
  Trophy,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { GameCanvas } from './GameCanvas';
import { SoundKit } from '@/game/audio';
import { drawPig } from '@/game/draw';
import { PIG_PHASE, PigAnimator, spriteClock, whenPigSpritesReady, type AnimState } from '@/game/sprite';
import type { GameEngine } from '@/game/engine';
import { LEVELS } from '@/game/levels';
import {
  applyWin,
  createEmptyProgress,
  loadProgress,
  resetProgress,
  saveProgress,
  type Progress,
} from '@/game/storage';
import { ACHIEVEMENTS, ACHIEVEMENT_MAP, SNIPER_GOAL, type AchievementId } from '@/game/achievements';
import { PIG_INFO } from '@/game/types';
import type { LevelDef, LoseInfo, PigType, SfxName, Snapshot, WinResult } from '@/game/types';
import { describeLose } from '@/game/feedback';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/* ---------------- 卡通 UI 原子组件 ---------------- */

const STAR_PATH = 'M12 2.4l2.95 5.98 6.6.96-4.77 4.65 1.12 6.57L12 17.5l-5.9 3.06 1.12-6.57L2.45 9.34l6.6-.96z';
const STAR_STEP_MS = 180;

/** 金色五角星：底下一层深金当厚度，上面一层亮金，四周统一深描边 */
function StarIcon({
  size = 22,
  filled = true,
  pop = false,
  delay = 0,
}: {
  size?: number;
  filled?: boolean;
  pop?: boolean;
  delay?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn(pop && filled && 'gd-star-pop')}
      style={pop ? { animationDelay: `${delay}ms` } : undefined}
    >
      <path
        d={STAR_PATH}
        transform="translate(0 0.9)"
        fill={filled ? 'var(--gd-gold-2)' : '#b7ae9b'}
        stroke="var(--gd-ink)"
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <path
        d={STAR_PATH}
        fill={filled ? 'var(--gd-gold)' : '#dcd5c4'}
        stroke="var(--gd-ink)"
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      {filled && (
        <path
          d="M12 6.6 13.6 10.4 17.7 10.7 14.6 13.2 15.6 17.2 12 15 8.4 17.2 9.4 13.2 6.3 10.7 10.4 10.4Z"
          fill="#fff3ad"
          opacity={0.8}
        />
      )}
    </svg>
  );
}

function Stars({
  count,
  size = 22,
  pop = false,
  onSfx,
}: {
  count: number;
  size?: number;
  pop?: boolean;
  onSfx?: (name: SfxName) => void;
}) {
  /* 星星一颗颗弹出来时配一声脆响，和 150ms 的逐颗延迟对齐 */
  useEffect(() => {
    if (!pop || count <= 0 || !onSfx) return;
    const timers = Array.from({ length: count }, (_, i) =>
      window.setTimeout(() => onSfx('star'), i * STAR_STEP_MS + 40),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [pop, count, onSfx]);

  return (
    <div className={cn('flex items-center gap-1', pop && count > 0 && 'gd-star-stage')}>
      {[0, 1, 2].map((i) => (
        <StarIcon key={i} size={size} filled={i < count} pop={pop && i < count} delay={i * STAR_STEP_MS} />
      ))}
    </div>
  );
}

/**
 * 分数滚动：数字从旧值追到新值（约 450ms，ease-out）。
 * 只是"显示"在追，真实的 snapshot.score 一直是权威值——不会造出假分数。
 * motion = 'low' 时直接跳到位。
 */
function useRollScore(target: number, instant = false): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    if (instant) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    const from = shownRef.current;
    if (from === target) return;
    const t0 = performance.now();
    const dur = 450;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = Math.round(from + (target - from) * eased);
      shownRef.current = value;
      setShown(value);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, instant]);

  return shown;
}

/**
 * 成就排队展示：一次只显示一条，1.3s 换下一条。
 * 多个成就同时解锁时不会互相覆盖（旧版是把名字用 · 拼成一行，长名字会被挤没）。
 */
function AchievementQueue({ ids }: { ids: AchievementId[] }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    if (ids.length <= 1) return;
    const timer = window.setInterval(() => {
      setIdx((i) => {
        if (i + 1 >= ids.length) {
          window.clearInterval(timer);
          return i;
        }
        return i + 1;
      });
    }, 1300);
    return () => window.clearInterval(timer);
  }, [ids]);

  const id = ids[Math.min(idx, ids.length - 1)];
  if (!id) return null;
  const def = ACHIEVEMENT_MAP[id];
  return (
    <div
      key={id}
      className="gd-float-in mt-2.5 flex items-start gap-2 rounded-xl px-3 py-2"
      style={{
        background: 'linear-gradient(180deg, #ffe08a, #f0a92f)',
        boxShadow: '0 0 0 3px var(--gd-ink), 0 4px 0 2px rgba(58, 42, 24, 0.35)',
      }}
    >
      <Award className="mt-0.5 size-4 shrink-0" strokeWidth={3} color="#6b3d05" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-black" style={{ color: '#6b3d05' }}>
          解锁成就
          {ids.length > 1 ? ` ${idx + 1}/${ids.length}` : ''}
        </p>
        <p className="text-[11px] font-black leading-snug" style={{ color: '#4a2a03' }}>
          {def?.name ?? id}
        </p>
        {def?.desc && (
          <p className="mt-0.5 text-[10px] font-bold leading-snug" style={{ color: '#6b3d05' }}>
            {def.desc}
          </p>
        )}
      </div>
    </div>
  );
}

type Tone = 'wood' | 'gold' | 'blue' | 'green' | 'red';
const TONE_CLASS: Record<Tone, string> = {
  wood: '',
  gold: 'gd-btn--gold',
  blue: 'gd-btn--blue',
  green: 'gd-btn--green',
  red: 'gd-btn--red',
};

function GdButton({
  children,
  onClick,
  tone = 'wood',
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: Tone;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'gd-btn inline-flex select-none items-center justify-center gap-2 px-5 py-2.5 text-base',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

function RoundButton({
  label,
  onClick,
  children,
  tone = 'wood',
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn('gd-btn gd-round grid size-11 place-items-center sm:size-12', TONE_CLASS[tone])}
    >
      {children}
    </button>
  );
}

/** 奶油色小木牌：计分、提示都用它，保证和 canvas 里的木箱同源 */
function CreamPlate({
  children,
  className,
  active = false,
}: {
  children: React.ReactNode;
  className?: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn('rounded-2xl px-2.5 py-1', className)}
      style={{
        background: active ? 'var(--gd-cream)' : 'rgba(255, 247, 226, 0.66)',
        boxShadow: active
          ? '0 0 0 3px var(--gd-ink), 0 5px 0 2px var(--gd-wood-3)'
          : '0 0 0 3px rgba(58, 42, 24, 0.45)',
      }}
    >
      {children}
    </div>
  );
}

function PigPortrait({
  type,
  size = 44,
  dim = false,
  state = 'idle',
}: {
  type: PigType;
  size?: number;
  dim?: boolean;
  /** 与本关当前小猪的动画状态同步：发射器上/落地后 idle，飞行中 fly */
  state?: AnimState;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<PigAnimator | null>(null);
  const [spriteVersion, setSpriteVersion] = useState(0);

  // 精灵图加载完成后重绘（否则会一直停在空白头像）
  useEffect(() => {
    let alive = true;
    whenPigSpritesReady().then(() => {
      if (alive) setSpriteVersion((v) => v + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 每个角色用不同的待机相位：六只并排时不会像一支合唱团同时吸气
    const anim = new PigAnimator(PIG_PHASE[type]);
    animRef.current = anim;
    anim.setState(state);

    const draw = (): void => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      drawPig(ctx, size / 2, size / 2 + size * 0.1, 0, size * 0.33, type, anim.snapshot());
    };
    draw();

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced) return;

    // 与场上小猪共用 spriteClock，呼吸节奏一致
    return spriteClock.subscribe((dt) => {
      anim.update(dt, 0);
      draw();
    });
  }, [type, size, spriteVersion]);

  useEffect(() => {
    animRef.current?.setState(state);
  }, [state]);

  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size }}
      className={cn('relative z-10', dim && 'opacity-30 grayscale')}
    />
  );
}

/** 卡片色带：木/草/天/金/红，和关卡材质呼应 */
const CARD_ACCENT = ['#e2811e', '#5aa32f', '#2e8ec4', '#c9932b', '#c0392b'];

/* ---------------- 主组件 ---------------- */

export function GameShell() {
  const [mode, setMode] = useState<'menu' | 'play'>('menu');
  const [levelIndex, setLevelIndex] = useState(0);
  const [runId, setRunId] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [progress, setProgress] = useState<Progress>(createEmptyProgress);
  const [result, setResult] = useState<WinResult | null>(null);
  const [failed, setFailed] = useState(false);
  /** 失败原因（引擎给的客观事实 → feedback.ts 翻译成一句话），重开时清空 */
  const [loseInfo, setLoseInfo] = useState<LoseInfo | null>(null);
  const [showLevels, setShowLevels] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [unlocked, setUnlocked] = useState<AchievementId[]>([]);
  const [portrait, setPortrait] = useState(false);

  const engineRef = useRef<GameEngine | null>(null);
  const soundRef = useRef<SoundKit | null>(null);
  const progressRef = useRef<Progress>(createEmptyProgress());

  useEffect(() => {
    const loaded = loadProgress();
    setProgress(loaded);
    progressRef.current = loaded;
    soundRef.current = new SoundKit(!loaded.soundOn);
  }, []);

  useEffect(() => {
    const check = () => {
      const isPortrait = window.matchMedia('(orientation: portrait)').matches;
      setPortrait(isPortrait && window.innerWidth < 900);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  const onSfx = useCallback((name: SfxName, power?: number) => {
    soundRef.current?.play(name, power);
  }, []);

  const onSnapshot = useCallback((s: Snapshot) => {
    setSnapshot(s);
  }, []);

  const onWin = useCallback((r: WinResult) => {
    setResult(r);
    setFailed(false);
    const levelId = LEVELS[r.levelIndex]?.id ?? '1-1';
    const { progress: next, unlocked: fresh } = applyWin(
      progressRef.current,
      levelId,
      r,
      LEVELS.length,
    );
    progressRef.current = next;
    setProgress(next);
    saveProgress(next);
    setUnlocked(fresh);
    // 解锁提示的音效比面板更晚一点，别和星星音撞在一起
    if (fresh.length > 0) {
      window.setTimeout(() => soundRef.current?.play('star', 1), 700);
    }
  }, []);

  const onLose = useCallback((info: LoseInfo) => {
    setLoseInfo(info);
    setFailed(true);
  }, []);

  const callbacks = { onSnapshot, onWin, onLose, onSfx };

  const level: LevelDef = LEVELS[levelIndex];
  const best = progress.levels[level.id]?.bestScore ?? 0;
  const soundOn = progress.soundOn;
  const lowMotion = progress.motion === 'low';
  const rollScore = useRollScore(snapshot?.score ?? 0, lowMotion);

  const toggleSound = () => {
    const next = { ...progressRef.current, soundOn: !progressRef.current.soundOn };
    progressRef.current = next;
    setProgress(next);
    saveProgress(next);
    soundRef.current?.setMuted(!next.soundOn);
    if (next.soundOn) soundRef.current?.play('click');
  };

  /** 动画设置：标准 / 低动态。只影响渲染层，物理与判定完全不变 */
  const toggleMotion = () => {
    const next: Progress = {
      ...progressRef.current,
      motion: progressRef.current.motion === 'low' ? 'standard' : 'low',
    };
    progressRef.current = next;
    setProgress(next);
    saveProgress(next);
    engineRef.current?.setReduceMotion(next.motion === 'low');
    soundRef.current?.play('click');
  };

  // 关卡（重新）创建后把当前设置灌进引擎：GameCanvas 用 key 重建引擎，所以跟着 runId 再同步一次
  useEffect(() => {
    engineRef.current?.setReduceMotion(progressRef.current.motion === 'low');
  }, [runId, mode]);

  // 低动态开关通过根 div 的类下发（不要写 document.documentElement：会在流式水合期间改 <html>，触发 hydration 报错）

  const startLevel = (index: number) => {
    soundRef.current?.unlock();
    soundRef.current?.play('click');
    setLevelIndex(index);
    setRunId((v) => v + 1);
    setMode('play');
    setSnapshot(null);
    setResult(null);
    setFailed(false);
    setLoseInfo(null);
    setUnlocked([]);
    setShowLevels(false);
  };

  const retry = () => {
    soundRef.current?.play('click');
    engineRef.current?.retry();
    setResult(null);
    setFailed(false);
    setLoseInfo(null);
    // 上一局的成就横幅不能跟到新一局
    setUnlocked([]);
  };

  const nextLevel = () => {
    const next = levelIndex + 1;
    setResult(null);
    setFailed(false);
    setLoseInfo(null);
    setUnlocked([]);
    if (next < LEVELS.length) {
      setLevelIndex(next);
      setRunId((v) => v + 1);
    } else {
      setMode('menu');
      setShowLevels(true);
    }
  };

  /** 重置会清空全部存档，先问一次；取消时不动任何数据 */
  const askReset = () => {
    soundRef.current?.play('click');
    setShowLevels(false);
    setConfirmReset(true);
  };

  const cancelReset = () => {
    soundRef.current?.play('click');
    setConfirmReset(false);
    setShowLevels(true);
  };

  const confirmResetAll = () => {
    soundRef.current?.play('click');
    // 只清进度，音效开关是玩家偏好，跟着保留（与离线版行为一致）
    const blank = { ...resetProgress(), soundOn: progressRef.current.soundOn };
    progressRef.current = blank;
    setProgress(blank);
    saveProgress(blank);
    setUnlocked([]);
    setResult(null);
    setConfirmReset(false);
    setShowLevels(true);
  };

  const currentPig = snapshot?.activePig ?? null;
  const pigInfo = currentPig ? PIG_INFO[currentPig] : null;
  const firstUncleared = LEVELS.findIndex((lv) => (progress.levels[lv.id]?.stars ?? 0) === 0);
  const resumeIndex = firstUncleared === -1 ? 0 : firstUncleared;
  const totalStars = Object.values(progress.levels).reduce((s, r) => s + r.stars, 0);

  return (
    <div
      className={`relative h-dvh w-full overflow-hidden${lowMotion ? ' gd-low-motion' : ''}`}
      style={{ background: 'var(--gd-sky-2)' }}
    >
      {mode === 'play' && (
        <div className="absolute inset-0">
          <GameCanvas key={`${levelIndex}-${runId}`} level={level} callbacks={callbacks} engineRef={engineRef} />
        </div>
      )}

      {mode === 'play' && snapshot && (
        <div className="pointer-events-none absolute inset-0">
          {/* 左侧功能列：关卡号木牌 + 圆形木按钮 */}
          <div className="pointer-events-auto absolute left-2 top-2 flex flex-col items-center gap-2 sm:left-4 sm:top-4 sm:gap-3">
            <div className="gd-plank px-2.5 pb-1 pt-0.5 text-center">
              <div
                className="text-lg font-black leading-tight tracking-tight tabular-nums"
                style={{ color: '#fff7e2', textShadow: '0 2px 0 #6f3f12' }}
              >
                {level.id}
              </div>
            </div>
            <RoundButton label="重玩本关" onClick={retry} tone="gold">
              <RotateCcw className="size-5" strokeWidth={3} color="#6b3d05" />
            </RoundButton>
            <RoundButton label="关卡列表" onClick={() => setShowLevels(true)}>
              <LayoutGrid className="size-5" strokeWidth={3} />
            </RoundButton>
            <RoundButton label={soundOn ? '关闭音效' : '开启音效'} onClick={toggleSound}>
              {soundOn ? (
                <Volume2 className="size-5" strokeWidth={3} />
              ) : (
                <VolumeX className="size-5" strokeWidth={3} />
              )}
            </RoundButton>
            <RoundButton label="玩法说明" onClick={() => setShowHelp(true)} tone="blue">
              <HelpCircle className="size-5" strokeWidth={3} />
            </RoundButton>
            <RoundButton label="成就" onClick={() => setShowAchievements(true)} tone="green">
              <Award className="size-5" strokeWidth={3} color="#2f5a12" />
            </RoundButton>
          </div>

          {/* 右上计分板 */}
          <div className="absolute right-2 top-2 flex flex-col items-end gap-2 sm:right-4 sm:top-4">
            <div className="gd-plank min-w-24 px-3 py-1 text-right">
              <div className="text-[10px] font-black leading-none tracking-[0.2em]" style={{ color: '#ffe6bd' }}>
                分数
              </div>
              <div
                className="text-2xl font-black leading-tight tabular-nums"
                style={{ color: '#fff7e2', textShadow: '0 2px 0 #6f3f12' }}
              >
                {rollScore}
              </div>
            </div>
            <div
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black"
              style={{
                background: 'rgba(255, 247, 226, 0.94)',
                color: '#8a3f08',
                boxShadow: '0 0 0 3px var(--gd-ink), 0 4px 0 2px rgba(58, 42, 24, 0.35)',
              }}
            >
              <Trophy className="size-3.5" strokeWidth={3} />
              <span>最高</span>
              <span className="tabular-nums">{Math.max(best, snapshot.score)}</span>
            </div>
            {snapshot.chain >= 2 && (
              <div
                // key 跟着层数变：每加一层就重新挂载，弹跳动画才会再播一次
                key={snapshot.chain}
                className="gd-chain-pop flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black"
                style={{
                  background: 'linear-gradient(180deg, #ffd75e, #f0921f)',
                  color: '#6b3d05',
                  textShadow: '0 1px 0 rgba(255, 255, 255, 0.55)',
                  boxShadow: '0 0 0 3px var(--gd-ink), 0 4px 0 2px rgba(58, 42, 24, 0.35)',
                }}
              >
                <span>连锁</span>
                <span className="tabular-nums">×{snapshot.chain}</span>
              </div>
            )}
          </div>

          {/* 顶部提示 */}
          <div className="absolute left-1/2 top-3 -translate-x-1/2 text-center sm:top-4">
            {snapshot.state === 'aiming' && (
              <p
                className="inline-block rounded-full px-4 py-1 text-xs font-black sm:text-sm"
                style={{
                  background: 'rgba(255, 247, 226, 0.94)',
                  color: '#8a3f08',
                  boxShadow: '0 0 0 3px var(--gd-ink), 0 5px 0 2px rgba(58, 42, 24, 0.32)',
                }}
              >
                {pigInfo && pigInfo.active
                  ? `拖动瞄准 · ${pigInfo.name}：${pigInfo.skill}技能 · 左下角头像可换猪`
                  : '按住画面拖动瞄准，松手发射'}
              </p>
            )}
            {snapshot.state === 'flying' && pigInfo && (
              <p
                className="inline-block rounded-full px-4 py-1 text-xs font-black sm:text-sm"
                style={{
                  background: 'linear-gradient(180deg, #b6e86a, #5aa32f)',
                  color: '#fff7e2',
                  textShadow: '0 2px 0 #3f6a18',
                  boxShadow: '0 0 0 3px var(--gd-ink), 0 5px 0 2px rgba(42, 74, 12, 0.55)',
                }}
              >
                {pigInfo.active && !snapshot.skillUsed
                  ? `点击屏幕 · 释放「${pigInfo.skill}」`
                  : `${pigInfo.name} · 飞行中`}
              </p>
            )}
          </div>

          {/* 待发射小猪队列：点谁就换谁上场 */}
          <div className="pointer-events-auto absolute bottom-2 left-2 flex items-end gap-1.5 sm:bottom-4 sm:left-4 sm:gap-2">
            {snapshot.pigs.map((type, i) => {
              const active = i === snapshot.currentIndex && snapshot.state === 'aiming';
              const canPick = snapshot.state === 'aiming' && !active;
              return (
                <button
                  key={`${type}-${i}`}
                  type="button"
                  disabled={!canPick}
                  aria-label={`选择${PIG_INFO[type].name}`}
                  aria-pressed={active}
                  title={`${PIG_INFO[type].name}：${PIG_INFO[type].skill}`}
                  onClick={() => engineRef.current?.selectPig(i)}
                  className={`rounded-xl transition-transform ${
                    canPick ? 'cursor-pointer hover:-translate-y-1 active:translate-y-0.5' : ''
                  }`}
                >
                  <CreamPlate active={active} className="flex flex-col items-center pb-0.5 pt-1">
                    <PigPortrait
                      type={type}
                      size={40}
                      dim={false}
                      state={active && snapshot.state === 'flying' ? 'fly' : 'idle'}
                    />
                    <span
                      className="text-[9px] font-black leading-tight"
                      style={{ color: active ? '#8a3f08' : '#a9702c' }}
                    >
                      {PIG_INFO[type].name.replace('猪', '')}
                    </span>
                  </CreamPlate>
                </button>
              );
            })}
          </div>

          {/* 相机缩放 */}
          <div className="pointer-events-auto absolute bottom-2 right-2 flex flex-col gap-2 sm:bottom-4 sm:right-4">
            <RoundButton label="放大" onClick={() => engineRef.current?.zoom(1)}>
              <ZoomIn className="size-5" strokeWidth={3} />
            </RoundButton>
            <RoundButton label="缩小" onClick={() => engineRef.current?.zoom(-1)}>
              <ZoomOut className="size-5" strokeWidth={3} />
            </RoundButton>
          </div>
        </div>
      )}

      {/* 开始界面：晴天 + 云 + 远山 + 木牌标题 */}
      {mode === 'menu' && (
        <div className="absolute inset-0 overflow-y-auto">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(180deg, #6fc0ee 0%, #a9e0f9 46%, #eafaff 100%)' }}
            />
            <div className="absolute left-[6%] top-[10%] h-9 w-28 rounded-full bg-white/85" />
            <div className="absolute left-[13%] top-[7%] h-7 w-16 rounded-full bg-white/85" />
            <div className="absolute right-[9%] top-[15%] h-8 w-24 rounded-full bg-white/80" />
            <div className="absolute right-[21%] top-[12%] h-6 w-14 rounded-full bg-white/80" />
            <svg
              className="absolute inset-x-0 bottom-0 h-[48%] w-full"
              viewBox="0 0 100 40"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M0 27 18 12 34 24 52 8 70 22 86 13 100 24V40H0Z" fill="#9ad6b0" opacity="0.75" />
              <path d="M0 34 14 25 30 32 48 22 66 31 84 24 100 32V40H0Z" fill="#62b072" />
            </svg>
            <div
              className="absolute inset-x-0 bottom-0 h-[20%]"
              style={{ background: 'linear-gradient(180deg, #86c93f 0%, #4c8b26 100%)' }}
            />
          </div>

          <div className="relative flex min-h-full items-center justify-center px-5 py-10">
            <div className="w-full max-w-[23rem]">
              <div className="gd-plank gd-float-in px-6 py-4 text-center">
                <p className="text-[11px] font-black tracking-[0.32em]" style={{ color: '#ffe6bd' }}>
                  网页弹射 · 物理小游戏
                </p>
                <h1
                  className="mt-1 text-4xl font-black leading-none sm:text-5xl"
                  style={{ color: '#fff7e2', textShadow: '0 3px 0 var(--gd-ink), 0 8px 14px rgba(40, 20, 4, 0.35)' }}
                >
                  贪吃的绿皮猪
                </h1>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                {LEVELS.map((lv, i) => (
                  <div
                    key={lv.id}
                    className="flex items-center gap-1 rounded-full px-2.5 py-1"
                    style={{
                      background: 'rgba(255, 247, 226, 0.92)',
                      boxShadow: `0 0 0 3px var(--gd-ink), 0 4px 0 2px ${CARD_ACCENT[i % CARD_ACCENT.length]}`,
                    }}
                  >
                    <span className="text-[11px] font-black" style={{ color: '#8a3f08' }}>
                      {lv.id}
                    </span>
                    <Stars count={progress.levels[lv.id]?.stars ?? 0} size={11} />
                  </div>
                ))}
                <div
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black"
                  style={{
                    background: 'rgba(255, 247, 226, 0.92)',
                    color: '#8a3f08',
                    boxShadow: '0 0 0 3px var(--gd-ink), 0 4px 0 2px var(--gd-wood-3)',
                  }}
                >
                  <Trophy className="size-3.5" strokeWidth={3} />
                  总星 {totalStars}/{LEVELS.length * 3}
                </div>
              </div>

              <p
                className="mx-auto mt-4 max-w-md text-center text-sm font-bold leading-relaxed"
                style={{ color: '#0f3a4a', textShadow: '0 1px 0 rgba(255, 255, 255, 0.6)' }}
              >
                这次换猪来做主角。拖住投石车往后拉，把自己甩进小鸟看守的鸟巢堡垒，抢回鸟蛋就通关。共 10 关，越往后墙体越厚、守卫越多。
              </p>

              <div className="mt-6 flex flex-col gap-3">
                <GdButton
                  tone="green"
                  onClick={() => startLevel(resumeIndex)}
                  className="py-3.5 text-xl tracking-[0.1em]"
                >
                  <Play className="size-6" strokeWidth={3} fill="currentColor" />
                  {firstUncleared === -1 ? '再玩一次' : '开始游戏'}
                </GdButton>
                <div className="flex gap-3">
                  <GdButton tone="gold" onClick={() => setShowLevels(true)} className="flex-1 py-3">
                    <LayoutGrid className="size-5" strokeWidth={3} />
                    关卡选择
                  </GdButton>
                  <GdButton tone="blue" onClick={() => setShowHelp(true)} className="flex-1 py-3">
                    <HelpCircle className="size-5" strokeWidth={3} />
                    玩法说明
                  </GdButton>
                </div>
                <div className="flex justify-center gap-3">
                  <GdButton onClick={() => setShowAchievements(true)} className="px-4 py-2 text-sm">
                    <Award className="size-4" strokeWidth={3} />
                    成就 {Object.keys(progress.achievements).length}/{ACHIEVEMENTS.length}
                  </GdButton>
                  <GdButton onClick={toggleSound} className="px-4 py-2 text-sm">
                    {soundOn ? <Volume2 className="size-4" strokeWidth={3} /> : <VolumeX className="size-4" strokeWidth={3} />}
                    {soundOn ? '音效开' : '音效关'}
                  </GdButton>
                  <GdButton onClick={toggleMotion} className="px-4 py-2 text-sm">
                    <Sparkles className="size-4" strokeWidth={3} />
                    {lowMotion ? '低动态' : '标准动效'}
                  </GdButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 结算：通关 */}
      <Dialog
        open={result !== null}
        onOpenChange={(open) => {
          if (!open) {
            setResult(null);
            setUnlocked([]);
          }
        }}
      >
        <DialogContent className="max-w-sm border-0 bg-transparent p-0 shadow-none">
          <div className="gd-panel gd-float-in max-h-[86dvh] overflow-y-auto p-5">
            <DialogHeader className="items-center text-center">
              <DialogTitle
                className="text-3xl font-black"
                style={{ color: '#8a3f08', textShadow: '0 2px 0 rgba(255, 255, 255, 0.8)' }}
              >
                抢到鸟蛋！
              </DialogTitle>
              <DialogDescription className="text-center text-xs font-black" style={{ color: '#7b7261' }}>
                第 {level.id} 关 · 用了 {result?.usedPigs ?? 0} 只小猪
                {(result?.maxChain ?? 0) >= 3 ? ` · 连锁 ×${result?.maxChain}` : ''}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex flex-col items-center gap-3">
              <Stars count={result?.stars ?? 0} size={40} pop onSfx={onSfx} />
              <div className="gd-plank px-5 py-1.5">
                <span
                  className="text-3xl font-black tabular-nums"
                  style={{ color: '#fff7e2', textShadow: '0 2px 0 #6f3f12' }}
                >
                  {result?.score ?? 0}
                </span>
              </div>
              <p className="text-[11px] font-black" style={{ color: '#7b7261' }}>
                本关最高分 {best}
              </p>
            </div>

            {/* 分数构成：让玩家看清这一局的分数是怎么来的 */}
            <div className="mt-3 grid grid-cols-2 gap-1">
              {(
                [
                  ['破坏建筑', result?.breakScore ?? 0, '#c26a12'],
                  ['连锁奖励', result?.chainBonus ?? 0, '#b8791b'],
                  ['撞飞小鸟', result?.birdScore ?? 0, '#2e8ec4'],
                  ['剩余小猪', result?.pigBonus ?? 0, '#4c8b26'],
                  ['抢到鸟蛋', result?.eggBonus ?? 0, '#8a3f08'],
                ] as const
              ).map(([label, value, color]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1"
                  style={{ background: 'rgba(255, 247, 226, 0.9)', boxShadow: '0 0 0 2px rgba(58, 42, 24, 0.16)' }}
                >
                  <span className="text-[10px] font-black" style={{ color: '#7b7261' }}>
                    {label}
                  </span>
                  <span className="text-[11px] font-black tabular-nums" style={{ color }}>
                    +{value}
                  </span>
                </div>
              ))}
            </div>

            {/* 星级条件：差哪一项一眼就能看见 */}
            <div className="mt-2.5 space-y-1">
              {(result?.goals ?? []).map((goal) => (
                <div
                  key={goal.id}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1"
                  style={{
                    background: goal.reached ? 'rgba(154, 217, 85, 0.3)' : 'rgba(58, 42, 24, 0.07)',
                  }}
                >
                  {goal.reached ? (
                    <Check className="size-3.5 shrink-0" strokeWidth={4} color="#3f6a18" />
                  ) : (
                    <X className="size-3.5 shrink-0" strokeWidth={4} color="#a09a8c" />
                  )}
                  <span
                    className="shrink-0 text-[10px] font-black"
                    style={{ color: goal.reached ? '#3f6a18' : '#8b8578' }}
                  >
                    {goal.label}
                  </span>
                  <span className="ml-auto truncate text-[10px] font-bold" style={{ color: '#8b8578' }}>
                    {goal.hint}
                  </span>
                </div>
              ))}
            </div>

            {unlocked.length > 0 && <AchievementQueue ids={unlocked} />}

            <div className="mt-4 flex gap-2.5">
              <GdButton onClick={retry} tone="gold" className="flex-1">
                再玩一次
              </GdButton>
              <GdButton onClick={nextLevel} tone="green" className="flex-1">
                {levelIndex + 1 < LEVELS.length ? '下一关' : '完成全部'}
              </GdButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 结算：失败 */}
      <Dialog open={failed} onOpenChange={(open) => (!open ? setFailed(false) : null)}>
        <DialogContent className="max-w-sm border-0 bg-transparent p-0 shadow-none">
          <div className="gd-panel gd-panel-shake p-5">
            <DialogHeader className="items-center text-center">
              <div className="gd-sad-wobble mb-1" aria-hidden="true">
                <PigPortrait type="normal" size={54} />
              </div>
              <DialogTitle
                className="text-2xl font-black"
                style={{ color: '#8a3f08', textShadow: '0 2px 0 rgba(255, 255, 255, 0.8)' }}
              >
                {level.pigs.length} 只小猪都用完了
              </DialogTitle>
              <DialogDescription className="text-center text-xs font-black" style={{ color: '#7b7261' }}>
                {loseInfo ? describeLose(loseInfo, level).reason : '鸟蛋还在房子里。'}
              </DialogDescription>
            </DialogHeader>
            <p
              className="mx-auto mt-2 max-w-[19rem] text-center text-[11px] font-bold leading-relaxed"
              style={{ color: '#8b7a58' }}
            >
              {loseInfo ? describeLose(loseInfo, level).tip : '换个角度，或者先用 TNT 把外墙炸开。'}
            </p>
            <div className="mt-5 flex gap-2.5">
              <GdButton
                onClick={() => {
                  setFailed(false);
                  setMode('menu');
                }}
                tone="blue"
                className="flex-1"
              >
                返回首页
              </GdButton>
              <GdButton onClick={retry} tone="green" className="flex-1">
                再来一次
              </GdButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 关卡选择 */}
      <Dialog open={showLevels} onOpenChange={setShowLevels}>
        <DialogContent className="max-w-xl border-0 bg-transparent p-0 shadow-none">
          <div className="gd-panel gd-float-in max-h-[86dvh] overflow-y-auto p-5">
            <DialogHeader className="items-center text-center">
              <DialogTitle
                className="text-2xl font-black"
                style={{ color: '#8a3f08', textShadow: '0 2px 0 rgba(255, 255, 255, 0.8)' }}
              >
                关卡选择
              </DialogTitle>
              <DialogDescription className="text-center text-[11px] font-black" style={{ color: '#7b7261' }}>
                共 10 关：木巢 → 石墙 → 玻璃 → 三层塔 → 堡垒。打中炸药箱能连带掀塌一片。
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {LEVELS.map((lv, i) => {
                const rec = progress.levels[lv.id];
                const accent = CARD_ACCENT[i % CARD_ACCENT.length];
                return (
                  <button
                    key={lv.id}
                    type="button"
                    onClick={() => startLevel(i)}
                    className="overflow-hidden rounded-2xl text-left transition active:translate-y-0.5"
                    style={{
                      background: 'var(--gd-cream)',
                      boxShadow: `0 0 0 3px var(--gd-ink), 0 6px 0 3px ${accent}`,
                    }}
                  >
                    <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: accent }}>
                      <span
                        className="text-sm font-black leading-tight tabular-nums"
                        style={{ color: '#fff7e2', textShadow: '0 2px 0 rgba(0, 0, 0, 0.35)' }}
                      >
                        {lv.id}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-xs font-black"
                        style={{ color: '#fff7e2', textShadow: '0 2px 0 rgba(0, 0, 0, 0.3)' }}
                      >
                        {lv.name}
                      </span>
                    </div>
                    <div className="px-3 py-1.5">
                      <p className="line-clamp-2 text-[11px] font-bold leading-snug" style={{ color: '#7b7261' }}>
                        {lv.hint}
                      </p>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <Stars count={rec?.stars ?? 0} size={16} />
                        <span className="text-[11px] font-black tabular-nums" style={{ color: '#8a3f08' }}>
                          分数 {rec?.bestScore ?? 0}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowLevels(false);
                  setShowAchievements(true);
                }}
                className="flex items-center gap-1 text-[11px] font-black underline underline-offset-2"
                style={{ color: '#8a3f08' }}
              >
                <Award className="size-3.5" strokeWidth={3} />
                成就 {Object.keys(progress.achievements).length}/{ACHIEVEMENTS.length}
              </button>
              <span className="text-[11px] font-black" style={{ color: '#7b7261' }}>
                总星数 {totalStars} / {LEVELS.length * 3}
              </span>
              <button
                type="button"
                onClick={askReset}
                className="text-[11px] font-black underline underline-offset-2"
                style={{ color: '#7b7261' }}
              >
                重置进度
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 重置进度二次确认：会清空星级/最高分/成就/累计统计，取消不动任何存档 */}
      <Dialog open={confirmReset} onOpenChange={(open) => (!open ? cancelReset() : null)}>
        <DialogContent className="max-w-sm border-0 bg-transparent p-0 shadow-none">
          <div className="gd-panel gd-float-in p-5">
            <DialogHeader className="items-center text-center">
              <DialogTitle
                className="text-xl font-black"
                style={{ color: '#8a3f08', textShadow: '0 2px 0 rgba(255, 255, 255, 0.8)' }}
              >
                要重置全部进度吗？
              </DialogTitle>
              <DialogDescription
                className="text-center text-xs font-bold leading-relaxed"
                style={{ color: '#7b7261' }}
              >
                会清空 {LEVELS.length} 关的星级与最高分、{ACHIEVEMENTS.length} 个成就，以及累计撞鸟 / 拆块 / 通关统计。
                <br />
                这个操作没法撤销。
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 flex gap-2.5">
              <GdButton onClick={cancelReset} tone="blue" className="flex-1">
                再想想
              </GdButton>
              <GdButton onClick={confirmResetAll} tone="red" className="flex-1">
                确认清空
              </GdButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 成就 */}
      <Dialog open={showAchievements} onOpenChange={setShowAchievements}>
        <DialogContent className="max-w-md border-0 bg-transparent p-0 shadow-none">
          <div className="gd-panel gd-float-in max-h-[86dvh] overflow-y-auto p-5">
            <DialogHeader className="items-center text-center">
              <DialogTitle
                className="text-2xl font-black"
                style={{ color: '#8a3f08', textShadow: '0 2px 0 rgba(255, 255, 255, 0.8)' }}
              >
                成就
              </DialogTitle>
              <DialogDescription className="text-center text-[11px] font-black" style={{ color: '#7b7261' }}>
                已解锁 {Object.keys(progress.achievements).length} / {ACHIEVEMENTS.length} · 进度与星级都存在本地
              </DialogDescription>
            </DialogHeader>
            <div className="mt-3 space-y-1.5">
              {ACHIEVEMENTS.map((a) => {
                const got = Boolean(progress.achievements[a.id]);
                const birdProgress =
                  a.id === 'sniper' ? `${Math.min(progress.totals.birds, SNIPER_GOAL)}/${SNIPER_GOAL}` : null;
                return (
                  <div
                    key={a.id}
                    className="flex items-start gap-2 rounded-xl px-2.5 py-2"
                    style={{
                      background: got ? 'rgba(255, 214, 90, 0.32)' : 'rgba(255, 247, 226, 0.78)',
                      boxShadow: got
                        ? '0 0 0 2px #c9932b, 0 3px 0 1px rgba(58, 42, 24, 0.25)'
                        : '0 0 0 2px rgba(58, 42, 24, 0.16)',
                    }}
                  >
                    <div
                      className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full"
                      style={{
                        background: got ? 'linear-gradient(180deg, #ffd75e, #f0921f)' : '#ded7c6',
                        boxShadow: '0 0 0 2px rgba(58, 42, 24, 0.3)',
                      }}
                    >
                      {got ? (
                        <Star className="size-4" strokeWidth={3} color="#6b3d05" fill="#fff3ad" />
                      ) : (
                        <X className="size-4" strokeWidth={3} color="#a09a8c" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[11px] font-black"
                          style={{ color: got ? '#8a3f08' : '#8b8578' }}
                        >
                          {a.name}
                        </span>
                        {birdProgress && (
                          <span className="text-[10px] font-black tabular-nums" style={{ color: '#a9702c' }}>
                            {birdProgress}
                          </span>
                        )}
                        {got && (
                          <span className="ml-auto text-[9px] font-black" style={{ color: '#3f6a18' }}>
                            已达成
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-bold leading-snug" style={{ color: '#7b7261' }}>
                        {a.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-center text-[10px] font-bold" style={{ color: '#7b7261' }}>
              累计撞飞小鸟 {progress.totals.birds} 只 · 累计拆掉方块 {progress.totals.blocks} 个 · 通关{' '}
              {progress.totals.wins} 次
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* 玩法说明 */}
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="max-w-md border-0 bg-transparent p-0 shadow-none">
          <div className="gd-panel gd-float-in max-h-[86dvh] overflow-y-auto p-5">
            <DialogHeader className="items-center text-center">
              <DialogTitle
                className="text-2xl font-black"
                style={{ color: '#8a3f08', textShadow: '0 2px 0 rgba(255, 255, 255, 0.8)' }}
              >
                玩法说明
              </DialogTitle>
              <DialogDescription className="text-center text-[11px] font-black" style={{ color: '#7b7261' }}>
                把自己射进去，别被小鸟拦下来。
              </DialogDescription>
            </DialogHeader>
            <div className="mt-3 space-y-2.5 text-xs">
              <div>
                <p className="mb-1 text-sm font-black" style={{ color: '#8a3f08' }}>
                  操作
                </p>
                <ul className="list-disc space-y-1 pl-5 font-bold" style={{ color: '#6f6757' }}>
                  <li>
                    按住画面往后拖瞄准，松手发射：拖动时会画出完整弹道与落点圈（和真实飞行同一套参数），
                    底部显示力度与角度，拉满时圆圈变金色。
                  </li>
                  <li>左下角的小猪头像可以点选：选哪只就装哪只上场，发射前随时能换。</li>
                  <li>1-1 ~ 1-4 用投石车，第 5 关和第 10 关换成大炮（猪卡在炮口，开炮会先爆焰冒烟）。</li>
                  <li>飞行中点击屏幕，释放当前小猪的技能。</li>
                  <li>每关配几只不同的小猪（左下角可切换），全部用完还没拿到鸟蛋就算失败；剩的猪越多星星越多。</li>
                </ul>
              </div>
              <div>
                <p className="mb-1 text-sm font-black" style={{ color: '#8a3f08' }}>
                  我方小猪
                </p>
                <div className="space-y-1.5">
                  {(Object.keys(PIG_INFO) as PigType[]).map((type) => (
                    <div
                      key={type}
                      className="flex items-start gap-2 rounded-xl px-2 py-1.5"
                      style={{
                        background: 'rgba(255, 247, 226, 0.85)',
                        boxShadow: '0 0 0 2px rgba(58, 42, 24, 0.28)',
                      }}
                    >
                      <PigPortrait type={type} size={34} />
                      <div className="min-w-0">
                        <div className="text-[11px] font-black" style={{ color: '#8a3f08' }}>
                          {PIG_INFO[type].name}
                          <span
                            className="ml-1 rounded px-1 text-[9px] font-black"
                            style={{ background: '#9ad955', color: '#2f5a12' }}
                          >
                            {PIG_INFO[type].skill}
                          </span>
                        </div>
                        <div className="text-[10px] font-bold leading-snug" style={{ color: '#7b7261' }}>
                          {PIG_INFO[type].desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-sm font-black" style={{ color: '#8a3f08' }}>
                  敌方小鸟
                </p>
                <ul className="list-disc space-y-1 pl-5 font-bold" style={{ color: '#6f6757' }}>
                  <li>红鸟站桩守卫，撞到会被弹开减速。</li>
                  <li>黄鸟会沿固定方向间歇冲刺，抓间隔穿过去。</li>
                  <li>蓝鸟三只一队绕圈巡逻，找队形缝隙钻。</li>
                </ul>
              </div>
              <div>
                <p className="mb-1 text-sm font-black" style={{ color: '#8a3f08' }}>
                  材质与道具
                </p>
                <ul className="list-disc space-y-1 pl-5 font-bold" style={{ color: '#6f6757' }}>
                  <li>木板最脆、玻璃一撞就碎、石块要冲得够狠、铁板得靠技能或爆炸。</li>
                  <li>TNT 炸药箱一碰就着：引信先嘶嘶冒火星、箱体闪白，半秒内炸开，还会点燃附近的炸药箱。</li>
                  <li>弹簧板踩上去会把人/箱子沿板面弹出去，撞得越狠弹得越高，板上的金箭头就是弹出方向。</li>
                  <li>木轮是活的，轰掉垫块后房子会顺着坡滚下去。</li>
                </ul>
              </div>
              <div>
                <p className="mb-1 text-sm font-black" style={{ color: '#8a3f08' }}>
                  计分
                </p>
                <ul className="list-disc space-y-1 pl-5 font-bold" style={{ color: '#6f6757' }}>
                  <li>分数 = 破坏建筑 + 连锁奖励 + 撞飞小鸟 + 剩余小猪 + 抢到鸟蛋。</li>
                  <li>抢到鸟蛋 +1000，每剩一只小猪 +200，撞飞一只小鸟 +150。</li>
                  <li>木板 / 玻璃 +50、石块 +80、铁板 +120，连锁第 3 块起每块再 +10。</li>
                  <li>三星：抢到鸟蛋 ★、2 发以内通关 ★、破坏表现（连锁 ×3 / 撞飞小鸟 / 拆掉四成建筑，任一）★。</li>
                  <li>关卡星级、最高分和成就都存在本地，刷新页面不会丢。</li>
                </ul>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 横屏提示 */}
      {portrait && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 px-8 text-center" style={{ background: 'rgba(24, 40, 52, 0.94)' }}>
          <div className="gd-panel gd-float-in flex flex-col items-center gap-2 px-8 py-6">
            <RotateCcw className="size-10 animate-pulse" style={{ color: '#8a3f08' }} strokeWidth={2.8} />
            <p className="text-lg font-black" style={{ color: '#8a3f08' }}>
              请横屏游玩
            </p>
            <p className="text-[11px] font-black" style={{ color: '#7b7261' }}>
              横屏能看到完整关卡，瞄准也更准
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
