/** 分数构成 / 星级目标来自 rating.ts（唯一定义处） */
import type { ScoreBreakdown, StarGoal } from './rating';

/** 障碍物材质：橙木 / 浅石 / 冰玻璃 / 铁皮，对应鸟村里的木架、石墙、冰屋与铁笼 */
export type Material = 'wood' | 'stone' | 'glass' | 'metal';

export type PigType = 'normal' | 'prof' | 'chef' | 'helmet' | 'king' | 'spy';

export type BirdType = 'red' | 'yellow' | 'blue';

/**
 * 发射器：投石车（1-1 ~ 1-4，也是缺省值）/ 大炮（1-5、1-10）/ 弹弓（已实现绘制与撒放，
 * 目前没有关卡启用）。
 * 三者共用同一个 `launchPoint` 与 `LAUNCH_FACTOR`，换的只是外观与撒放表演。
 */
export type Launcher = 'sling' | 'trebuchet' | 'cannon';

export interface BlockDef {
  x: number;
  y: number;
  w: number;
  h: number;
  mat: Material;
  /** 炸药箱：被打碎时原地爆炸，把周围的结构一起掀掉 */
  tnt?: boolean;
}

/** 弹簧板：钉在地上的弹射机关，物体砸上去会被沿板面法线弹开 */
export interface SpringDef {
  x: number;
  y: number;
  /** 板面尺寸 */
  w: number;
  h: number;
  /** 板面倾角（弧度），0 = 水平朝上 */
  angle?: number;
  /** 弹射力度倍率，缺省 1 */
  power?: number;
}

/** 散落的木车轮：纯装饰刚体，被撞到会滚出去 */
export interface WheelDef {
  x: number;
  y: number;
  r: number;
}

export type BirdDef =
  | { kind: 'red'; x: number; y: number }
  | {
      kind: 'yellow';
      x: number;
      y: number;
      dashToX: number;
      dashToY: number;
      restTime: number;
      dashTime: number;
    }
  | {
      kind: 'blue';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      speed: number;
    };

export interface LevelDef {
  id: string;
  index: number;
  name: string;
  hint: string;
  pigs: PigType[];
  /** 发射器造型，不填就是投石车 */
  launcher?: Launcher;
  /** 发射点：投石车是抛兜、大炮是炮口，小猪和弹道都从这里出发 */
  launchPoint: { x: number; y: number };
  egg: { x: number; y: number; r: number };
  blocks: BlockDef[];
  birds: BirdDef[];
  /** 散落的车轮（可选） */
  wheels?: WheelDef[];
  /** 弹簧板（可选，可重复放多块） */
  springs?: SpringDef[];
}

export interface PigInfo {
  type: PigType;
  name: string;
  skill: string;
  desc: string;
  active: boolean;
}

export const PIG_INFO: Record<PigType, PigInfo> = {
  normal: {
    type: 'normal',
    name: '普通猪',
    skill: '无技能',
    desc: '标准体重与弹性，靠角度和力度说话。',
    active: false,
  },
  prof: {
    type: 'prof',
    name: '教授猪',
    skill: '爆破',
    desc: '飞行中点击，在当前位置引爆，炸开周围木石。',
    active: true,
  },
  chef: {
    type: 'chef',
    name: '厨师猪',
    skill: '冲刺',
    desc: '飞行中点击，速度骤增，可撞穿木板。',
    active: true,
  },
  helmet: {
    type: 'helmet',
    name: '钢盔猪',
    skill: '装甲',
    desc: '被动：被小鸟撞击也不会被弹开减速。',
    active: false,
  },
  king: {
    type: 'king',
    name: '国王猪',
    skill: '重量级',
    desc: '被动：体重更大，撞击破坏力显著提升。',
    active: false,
  },
  spy: {
    type: 'spy',
    name: '间谍猪',
    skill: '伪装',
    desc: '飞行中点击，2 秒内小鸟无法拦截。',
    active: true,
  },
};

export type GameState = 'aiming' | 'flying' | 'won' | 'lost';

export interface Snapshot {
  levelIndex: number;
  levelId: string;
  levelName: string;
  score: number;
  /** 还没上场的猪队列（第 0 位之外都可以被玩家点选换手） */
  pigs: PigType[];
  /** 当前选中的队列下标 */
  currentIndex: number;
  /** 已经装在发射器上 / 正在飞的那只猪 */
  activePig: PigType | null;
  state: GameState;
  skillUsed: boolean;
  canUseSkill: boolean;
  /** 当前连锁坍塌数（窗口期内连续破块），0 表示没有正在进行的连锁 */
  chain: number;
  /** 本关最高连锁数，结算时展示 */
  maxChain: number;
}

/** 通关结算：分数明细 + 星级目标 + 成就判定要用的统计 */
export interface WinResult extends ScoreBreakdown {
  levelIndex: number;
  score: number;
  stars: number;
  usedPigs: number;
  /** 本关最高连锁坍塌数 */
  maxChain: number;
  /** 本关拆掉的方块数（成就用） */
  brokenBlocks: number;
  /** 本关撞飞的小鸟数（成就用） */
  birdsCaptured: number;
  /** 三颗星各自的达成情况，结算面板直接拿来提示 */
  goals: StarGoal[];
}

/**
 * 失败的客观事实（引擎只负责采集，措辞交给 `feedback.ts` 的纯函数）。
 * 这里全部是"已经发生的事实"，不含推测，所以失败提示不会胡说。
 */
export interface LoseInfo {
  /** 最后一发在整段飞行里离鸟蛋最近的距离（px） */
  closest: number;
  /** 最后一发撞到场景物件（方块 / 弹簧板 / 小车）的次数，0 表示根本没碰到东西 */
  contacts: number;
  /** 最后一发在整段飞行里到达过的最右位置（x），用来区分"射程不够"和"飞过头" */
  far: number;
  /** 场上还剩几个没被引燃的炸药箱 */
  tntLeft: number;
  /** 有几块弹簧板从头到尾没被踩到 */
  springLeft: number;
}

export type SfxName =
  | 'pull'
  | 'launch'
  | 'bonk'
  /** 破碎音（方块碎掉那一刻） */
  | 'wood'
  | 'stone'
  | 'glass'
  | 'metal'
  /** 撞击音（撞到了但还没碎），比破碎音更短更钝 */
  | 'hitWood'
  | 'hitStone'
  | 'hitGlass'
  | 'hitMetal'
  /** 建筑倒塌：连续破块时的一串低频闷响 */
  | 'collapse'
  /** 连锁数上台阶的提示音 */
  | 'chain'
  | 'booster'
  | 'boom'
  | 'win'
  | 'lose'
  | 'click'
  | 'oink'
  | 'fuse'
  | 'spring'
  /** 结算星星逐个弹出来的小叮 */
  | 'star';
