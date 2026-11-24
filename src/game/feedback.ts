/**
 * 失败反馈：把引擎采集到的客观事实翻译成一句"为什么没进去" + 一条可执行的建议。
 *
 * 只在 `LoseInfo` 里已有的事实上措辞（最近距离 / 撞到几次 / 还剩几个炸药箱和弹簧板），
 * 不做任何"你应该是……"的推测，也不带羞辱性文案。React 与 standalone 共用这一份纯函数。
 */
import type { LevelDef, LoseInfo } from './types';

export interface LoseFeedback {
  /** 直接说明这次差在哪（贴着一句具体数字，玩家能立刻对上画面） */
  reason: string;
  /** 下一把可以怎么改 */
  tip: string;
}

/** 判定"就差一点点"的距离阈值（px）：猪半径 26 + 蛋半径约 24，超过 90 基本是两个身位之外 */
const NEAR_EGG = 90;

export function describeLose(info: LoseInfo, level: LevelDef): LoseFeedback {
  const hasTnt = level.blocks.some((b) => b.tnt);
  const hasSpring = (level.springs ?? []).length > 0;

  if (info.contacts === 0) {
    const short = info.far < level.egg.x;
    const gap = Math.abs(level.egg.x - info.far);
    return {
      reason: short
        ? `最后一发没飞到鸟蛋就落地了（最远到 x=${info.far}，鸟蛋在 x=${level.egg.x}）。`
        : `最后一发越过鸟蛋飞过去了（最远到 x=${info.far}，鸟蛋在 x=${level.egg.x}）。`,
      tip: short
        ? `加 ${Math.min(30, Math.max(8, Math.round(gap / 12)))} 点力度，或者把角度再抬 1~2 度。`
        : `力度收 ${Math.min(30, Math.max(8, Math.round(gap / 12)))} 点，或者把角度压低 1~2 度。`,
    };
  }

  if (info.closest <= NEAR_EGG) {
    return {
      reason: `最后一发离鸟蛋只差 ${info.closest}px，就差一点点。`,
      tip: '角度再抬 1~2 度、力度加几格，或者换一只带技能的小猪补上这一下。',
    };
  }

  const tips: string[] = [];
  if (hasTnt && info.tntLeft > 0) {
    tips.push(`还剩 ${info.tntLeft} 个炸药箱没点着，打爆它能连带掀塌一片`);
  }
  if (hasSpring && info.springLeft > 0) {
    tips.push('门口的弹簧板一次都没踩到，射低一点让它把猪弹上去');
  }
  tips.push('也可以换个角度先打支柱或屋顶，让房子塌一块再补一发');

  return {
    reason: `最后一发撞在建筑上，最近只到离鸟蛋 ${info.closest}px 的地方。`,
    tip: `${tips[0]}。`,
  };
}
