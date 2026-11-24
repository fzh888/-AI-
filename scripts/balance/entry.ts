/**
 * 关卡平衡测试工具的唯一入口（**只给 scripts/balance 用，正式游戏不引用**）。
 *
 * 目的：把「真引擎 + 真关卡数据 + 真评分函数」原封不动地交给 Node 端的批量测试脚本，
 * 让测试跑的就是玩家实际会遇到的物理与判定，而不是另写一套近似模拟。
 *
 * 用法：scripts/balance/harness.mjs 用 esbuild 把这个文件打成 CJS 再 import，
 * 因此这里只做 re-export，不写任何逻辑。
 */

export { GameEngine } from '../../src/game/engine';
export { LEVELS, GROUND_Y, MAX_PULL, LAUNCH_FACTOR, PIG_RADIUS, WORLD_HEIGHT, WORLD_WIDTH } from '../../src/game/levels';
export { MATERIALS } from '../../src/game/materials';
export { SPRING, TNT } from '../../src/game/mechanisms';
export { PIG_INFO } from '../../src/game/types';
export type { BirdDef, LevelDef, PigType, WinResult } from '../../src/game/types';
export {
  rateStars,
  totalScore,
  STAR_CHAIN_GOAL,
  STAR_DEMOLISH_RATIO,
  STAR_PIG_LIMIT,
} from '../../src/game/rating';
