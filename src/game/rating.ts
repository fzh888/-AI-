/**
 * 三星评价：唯一定义处。
 *
 * 三颗星分别对应三个独立目标（"偷到蛋"是必得的第一颗），
 * 这样玩家在结算面板上能直接看懂"还差哪一项"，而不是面对一个神秘分数阈值。
 *
 * - 蛋：抢到鸟蛋（通关就给）
 * - 效率：2 发以内通关（剩至少 1 只小猪）
 * - 表现：单局打出连锁 ×3 / 撞飞小鸟 / 拆掉相当一部分建筑（三者任一）
 */

export interface ScoreBreakdown {
  /** 破坏建筑得分（方块按材质计分） */
  breakScore: number;
  /** 连锁破坏奖励（第 3 块起的分包） */
  chainBonus: number;
  /** 捕捉小鸟得分 */
  birdScore: number;
  /** 剩余小猪奖励 */
  pigBonus: number;
  /** 偷蛋奖励 */
  eggBonus: number;
}

export interface StarInput extends ScoreBreakdown {
  usedPigs: number;
  maxChain: number;
  birdsCaptured: number;
  /** 本关所有方块的满分（破坏得分上限，用于判断"拆掉多少"） */
  levelWorth: number;
}

export type StarGoalId = 'egg' | 'efficient' | 'flourish';

export interface StarGoal {
  id: StarGoalId;
  label: string;
  /** 结算面板上的补充说明 */
  hint: string;
  reached: boolean;
}

export interface StarResult {
  stars: number;
  goals: StarGoal[];
}

/** 效率星：最多用 2 只小猪 */
export const STAR_PIG_LIMIT = 2;
/** 表现星：连锁至少到 ×3 */
export const STAR_CHAIN_GOAL = 3;
/** 表现星：破坏得分达到本关所有方块总分的 40%（再低就只是"蹭进去"了） */
export const STAR_DEMOLISH_RATIO = 0.4;

export function rateStars(input: StarInput): StarResult {
  const efficient = input.usedPigs <= STAR_PIG_LIMIT;
  const demolish = input.breakScore >= input.levelWorth * STAR_DEMOLISH_RATIO;
  const flourish =
    input.maxChain >= STAR_CHAIN_GOAL || input.birdsCaptured >= 1 || demolish;

  const goals: StarGoal[] = [
    { id: 'egg', label: '抢到鸟蛋', hint: '把蛋抱走就通关', reached: true },
    {
      id: 'efficient',
      label: `${STAR_PIG_LIMIT} 发以内通关`,
      hint: `本局用了 ${input.usedPigs} 只小猪`,
      reached: efficient,
    },
    {
      id: 'flourish',
      label: '破坏表现',
      // 顺便把达标线写出来，玩家才知道"还差多少"（三项任一即可）
      hint: `连锁 ×${input.maxChain} · 撞鸟 ${input.birdsCaptured} · 拆迁 ${Math.round(
        (input.breakScore / Math.max(1, input.levelWorth)) * 100,
      )}%（需 ×${STAR_CHAIN_GOAL} / 1 只 / ${Math.round(STAR_DEMOLISH_RATIO * 100)}%）`,
      reached: flourish,
    },
  ];

  return { stars: goals.filter((g) => g.reached).length, goals };
}

/** 分数构成 → 总分（结算与存档都用这一份） */
export function totalScore(b: ScoreBreakdown): number {
  return b.breakScore + b.chainBonus + b.birdScore + b.pigBonus + b.eggBonus;
}
