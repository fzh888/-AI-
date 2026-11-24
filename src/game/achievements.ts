/**
 * 成就：唯一定义处。
 *
 * 所有条件都来自真实的游戏结果（WinResult / 存档累计），没有"点一下就给"的空成就。
 * 判定是纯函数，React 版与离线单文件版共用同一套。
 */

export type AchievementId =
  | 'firstEgg'
  | 'oneShot'
  | 'sniper'
  | 'chainMaster'
  | 'demolition'
  | 'allClear';

export interface AchievementDef {
  id: AchievementId;
  name: string;
  desc: string;
  /** 累计型成就的目标值（用于成就面板显示 x/y），一次性成就为 undefined */
  goal?: number;
}

/** 神射手：累计撞飞的小鸟数 */
export const SNIPER_GOAL = 5;
/** 连锁破坏：单局最高连锁 */
export const CHAIN_ACHIEVEMENT = 5;
/** 拆迁专家：单局拆掉的方块数 */
export const DEMOLITION_GOAL = 12;

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'firstEgg', name: '首次偷蛋', desc: '第一次从鸟巢里把鸟蛋抢走' },
  { id: 'oneShot', name: '一发入魂', desc: '只用一只小猪就通关' },
  { id: 'sniper', name: '神射手', desc: `累计撞飞 ${SNIPER_GOAL} 只小鸟`, goal: SNIPER_GOAL },
  { id: 'chainMaster', name: '连锁破坏', desc: `单局打出连锁 ×${CHAIN_ACHIEVEMENT}`, goal: CHAIN_ACHIEVEMENT },
  { id: 'demolition', name: '拆迁专家', desc: `单局拆掉 ${DEMOLITION_GOAL} 个方块`, goal: DEMOLITION_GOAL },
  { id: 'allClear', name: '全关卡完成', desc: '通关全部关卡' },
];

export const ACHIEVEMENT_MAP: Record<AchievementId, AchievementDef> = ACHIEVEMENTS.reduce(
  (acc, a) => {
    acc[a.id] = a;
    return acc;
  },
  {} as Record<AchievementId, AchievementDef>,
);

/** 成就判定需要的输入（全部是真实数据） */
export interface AchievementInput {
  /** 已通关的关卡数（含本局） */
  clearedLevels: number;
  levelCount: number;
  usedPigs: number;
  maxChain: number;
  brokenBlocks: number;
  /** 累计撞飞小鸟数（含本局） */
  totalBirds: number;
  /** 已解锁的成就 id */
  unlocked: Record<string, number>;
}

/** 返回本次新达成的成就 id（不含已解锁过的） */
export function findNewAchievements(input: AchievementInput): AchievementId[] {
  const reached: AchievementId[] = [];
  const push = (id: AchievementId, ok: boolean): void => {
    if (ok && !input.unlocked[id]) reached.push(id);
  };

  push('firstEgg', input.clearedLevels >= 1);
  push('oneShot', input.usedPigs === 1);
  push('sniper', input.totalBirds >= SNIPER_GOAL);
  push('chainMaster', input.maxChain >= CHAIN_ACHIEVEMENT);
  push('demolition', input.brokenBlocks >= DEMOLITION_GOAL);
  push('allClear', input.levelCount > 0 && input.clearedLevels >= input.levelCount);

  return reached;
}
