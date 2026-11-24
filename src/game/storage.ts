import { findNewAchievements, type AchievementId } from './achievements';
import type { WinResult } from './types';

export interface LevelRecord {
  /** 历史最好星级（0~3） */
  stars: number;
  /** 历史最高分 */
  bestScore: number;
  /** 通关次数 */
  clears: number;
}

/** 跨局累计统计（累计型成就用） */
export interface ProgressTotals {
  /** 累计撞飞的小鸟 */
  birds: number;
  /** 累计拆掉的方块 */
  blocks: number;
  /** 累计通关次数 */
  wins: number;
}

/** 动画强度：standard = 全部动效；low = 低动态（减震、减粒子、关掉装饰摆动） */
export type MotionMode = 'standard' | 'low';

export interface Progress {
  levels: Record<string, LevelRecord>;
  soundOn: boolean;
  /** 成就 id → 解锁时间戳 */
  achievements: Record<string, number>;
  totals: ProgressTotals;
  /** 动画设置（旧存档缺这一项时按 standard 处理） */
  motion: MotionMode;
}

const KEY = 'pig-revenge-progress-v1';

const EMPTY_TOTALS: ProgressTotals = { birds: 0, blocks: 0, wins: 0 };

export function createEmptyProgress(): Progress {
  return {
    levels: {},
    soundOn: true,
    achievements: {},
    totals: { ...EMPTY_TOTALS },
    motion: 'standard',
  };
}

export function loadProgress(): Progress {
  if (typeof window === 'undefined') return createEmptyProgress();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return createEmptyProgress();
    const parsed = JSON.parse(raw) as Partial<Progress>;
    const levels: Record<string, LevelRecord> = {};
    Object.entries(parsed.levels ?? {}).forEach(([id, rec]) => {
      if (!rec) return;
      levels[id] = {
        stars: Math.max(0, Math.min(3, rec.stars ?? 0)),
        bestScore: Math.max(0, rec.bestScore ?? 0),
        clears: Math.max(0, rec.clears ?? 0),
      };
    });
    return {
      levels,
      soundOn: parsed.soundOn !== false,
      achievements: parsed.achievements ?? {},
      totals: {
        birds: Math.max(0, parsed.totals?.birds ?? 0),
        blocks: Math.max(0, parsed.totals?.blocks ?? 0),
        wins: Math.max(0, parsed.totals?.wins ?? 0),
      },
      motion: parsed.motion === 'low' ? 'low' : 'standard',
    };
  } catch {
    return createEmptyProgress();
  }
}

export function saveProgress(progress: Progress): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    /* 存储不可用（隐私模式/配额满）时静默失败，游戏照常进行 */
  }
}

/**
 * 结算入档：更新本关星级/最高分/通关次数、累计统计，并判定新成就。
 * 返回新进度与本次新解锁的成就 id（UI 用它播解锁提示）。
 */
export function applyWin(
  progress: Progress,
  levelId: string,
  result: WinResult,
  levelCount: number,
): { progress: Progress; unlocked: AchievementId[] } {
  const prev = progress.levels[levelId];
  const nextLevel: LevelRecord = {
    stars: Math.max(prev?.stars ?? 0, result.stars),
    bestScore: Math.max(prev?.bestScore ?? 0, result.score),
    clears: (prev?.clears ?? 0) + 1,
  };
  const levels = { ...progress.levels, [levelId]: nextLevel };
  const totals: ProgressTotals = {
    birds: progress.totals.birds + result.birdsCaptured,
    blocks: progress.totals.blocks + result.brokenBlocks,
    wins: progress.totals.wins + 1,
  };
  const clearedLevels = Object.values(levels).filter((r) => r.stars > 0).length;

  const unlocked = findNewAchievements({
    clearedLevels,
    levelCount,
    usedPigs: result.usedPigs,
    maxChain: result.maxChain,
    brokenBlocks: result.brokenBlocks,
    totalBirds: totals.birds,
    unlocked: progress.achievements,
  });

  const achievements = { ...progress.achievements };
  unlocked.forEach((id, i) => {
    achievements[id] = Date.now() + i;
  });

  return {
    progress: { ...progress, levels, totals, achievements },
    unlocked,
  };
}

export function resetProgress(): Progress {
  return createEmptyProgress();
}
