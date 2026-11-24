import type { Material, SfxName } from './types';

/**
 * 碎屑风格：决定"被打掉一块"时飞出来的是什么。
 * - splinter 木屑：细长条，飞得远、落得快
 * - chunk 石屑：块状小石子，重、飞不远
 * - shard 玻璃碎片：小而多，半透明，会闪
 * - plate 铁皮碎片：薄片，少而硬
 */
export type DebrisStyle = 'splinter' | 'chunk' | 'shard' | 'plate';

export interface MaterialProfile {
  /** 密度：越大越难推动，砸下来越疼 */
  density: number;
  friction: number;
  frictionStatic: number;
  restitution: number;
  /** 耐久：等于"一击必碎"的冲击强度，也是累积伤害上限 */
  hp: number;
  /**
   * 记伤害所需的最小相对速度（px/步）：低于它的碰撞（堆叠自重、静置轻蹭、慢速蠕动）
   * 一律不计伤害。单步重力增量约 0.83，因此阈值必须明显高于 1，
   * 否则开局静置就会自己掉血。
   */
  minImpact: number;
  /** 冲刺猪能否直接撞穿（木、玻璃可以，石、铁不行） */
  pierce: boolean;
  /**
   * 切向敏感度：撞击里"擦着表面滑过去"的那一部分，还算多少分伤害（0~1）。
   * 伤害主项是碰撞法线方向的接近速度，切向分量按这个系数折算：
   * - 玻璃 0.75 脆性大，斜着刮过去也会炸裂（1-9 低平射擦着冰玻璃上沿正是靠这个）；
   * - 木头 0.45 顺纹易裂；
   * - 石头 0.25 / 铁皮 0.2 只认正面硬砸，蹭一下最多留道划痕。
   */
  shear: number;
  score: number;
  debris: DebrisStyle;
  /** 破碎音（方块碎掉那一刻） */
  sfx: SfxName;
  /** 撞击音（撞到了但还没碎），短促的一记敲击 */
  hitSfx: SfxName;
  /** 底色 / 暗部 / 亮部 / 粉尘，与 DESIGN.md 的材质配色表一一对应 */
  palette: { face: string; dark: string; light: string; dust: string };
}

/**
 * 四种材质的唯一属性表：物理手感、耐久、分值、碎屑与音效都从这里取，
 * 引擎（物理 / 伤害 / 计分）与绘制（配色 / 裂纹 / 碎片）共用同一份数据。
 */
export const MATERIALS: Record<Material, MaterialProfile> = {
  wood: {
    density: 0.0014,
    friction: 0.5,
    frictionStatic: 0.9,
    restitution: 0.08,
    hp: 8,
    minImpact: 2.6,
    pierce: true,
    shear: 0.45,
    score: 50,
    debris: 'splinter',
    sfx: 'wood',
    hitSfx: 'hitWood',
    palette: { face: '#e08838', dark: '#a85c1c', light: '#f8c982', dust: '#f6dcae' },
  },
  glass: {
    density: 0.0011,
    friction: 0.42,
    frictionStatic: 0.8,
    restitution: 0.14,
    hp: 7,
    minImpact: 2.2,
    pierce: true,
    shear: 0.75,
    score: 50,
    debris: 'shard',
    sfx: 'glass',
    hitSfx: 'hitGlass',
    palette: { face: '#a9d8e2', dark: '#6d9aa6', light: '#f4fdff', dust: '#ddf3fa' },
  },
  stone: {
    density: 0.0032,
    friction: 0.75,
    frictionStatic: 0.9,
    restitution: 0.03,
    hp: 22,
    minImpact: 3.2,
    pierce: false,
    shear: 0.25,
    score: 80,
    debris: 'chunk',
    sfx: 'stone',
    hitSfx: 'hitStone',
    palette: { face: '#b6b2a8', dark: '#87837a', light: '#e8e4da', dust: '#e9e6dd' },
  },
  metal: {
    density: 0.004,
    friction: 0.6,
    frictionStatic: 0.95,
    restitution: 0.05,
    hp: 34,
    minImpact: 3.6,
    pierce: false,
    shear: 0.2,
    score: 120,
    debris: 'plate',
    sfx: 'metal',
    hitSfx: 'hitMetal',
    palette: { face: '#a9bda2', dark: '#74896c', light: '#e2ecdb', dust: '#e6ede2' },
  },
};

/** 材质初始耐久：方块被打掉多少血由 applyImpact 累积，跨过 hp 才碎 */
export function materialHp(mat: Material): number {
  return MATERIALS[mat].hp;
}

/** 是否进入"有裂纹"阶段（损伤 ≥ 18% 就开始画第一道裂） */
export const CRACK_HIT = 0.18;
/** 重伤阈值：裂纹加粗、块面压暗 */
export const CRACK_HEAVY = 0.62;
