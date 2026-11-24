/**
 * 关卡机关参数表（第三阶段）。
 *
 * 机关与材质分离：材质决定"被撞会怎样"（`materials.ts`），
 * 机关决定"被碰到会触发什么"（这里）。两个机关都只在这里留一份参数，
 * 引擎/绘制/音效全部读它，改手感不用翻代码。
 */

/** 炸药箱：比木质方块敏感得多，几乎一碰就炸，并会点燃旁边的炸药箱 */
export interface TntConfig {
  /** 引信延迟（ms）：被点着后先冒出火星、箱体闪白，再炸 */
  fuseMs: number;
  /** 记伤阈值（px/步）：低于木质方块的 2.6，任何真实撞击都会立刻点火（静置落位抖动在 1.6 以下） */
  minImpact: number;
  /** 主爆炸半径（px） */
  radius: number;
  /** 主爆炸冲击倍率（喂给 explodeAt 的 power） */
  power: number;
  /** 连带点火半径（px）：这个范围内的其它炸药箱会被引信带炸 */
  chainRadius: number;
  /** 连锁点火的引信抖动（ms）：让补爆有先后，看得出"一串炸开" */
  chainJitterMs: number;
  /** 被爆炸波及时的推飞倍率（相对于主爆炸 power） */
  kick: number;
}

export const TNT: TntConfig = {
  fuseMs: 240,
  minImpact: 2.2,
  radius: 210,
  power: 1.35,
  chainRadius: 420,
  chainJitterMs: 110,
  kick: 0.75,
};

/** 弹簧板：踩上去把物体沿板面法线弹出去，木箱/石头/小猪都会被弹 */
export interface SpringConfig {
  /** 弹射初速（px/步）；满拉发射是 34.5，这里 0.7 倍左右 */
  power: number;
  /** 触发所需的最小法向撞击速度（px/步）：静置/轻放不会弹 */
  minSpeed: number;
  /** 撞击越快弹得越高：速度加成上限（px/步） */
  maxBonus: number;
  /** 弹射初速上限（px/步）：防止高速砸下来时被弹飞出世界 */
  maxSpeed: number;
  /** 每次弹射后的冷却（ms），防止贴着板子被连弹 */
  cooldownMs: number;
  /** 压到底的用时（ms） */
  squashMs: number;
  /** 回弹复原的用时（ms） */
  reboundMs: number;
  /** 保留的切向速度比例（让斜着撞上去的物体继续斜飞） */
  tangentKeep: number;
  /** 横向冲上板面时，把总速度折算成"撞击强度"的比例（0.55 ≈ 速度 6 就够触发） */
  grazeKeep: number;
  /** 板面下压行程（占板厚的比例） */
  travel: number;
}

export const SPRING: SpringConfig = {
  power: 14,
  minSpeed: 3,
  maxBonus: 6,
  maxSpeed: 21,
  cooldownMs: 180,
  squashMs: 70,
  reboundMs: 190,
  tangentKeep: 0.68,
  grazeKeep: 0.55,
  travel: 0.5,
};
