/**
 * 通关密度采样（第三轮第二阶段的核心指标）：
 * 在「玩家能拖出的参数空间」里均匀撒点，每点跑 3 个种子，统计
 *   - reach：至少 1 次通关的比例（能不能通）
 *   - stable：3 次都通关的比例（稳不稳）
 *   - star3：3 次都通关且都是 3 星的比例（三星稳不稳）
 * 这样避免固定网格与关卡"甜点"别名（1-10 用 6px 步长会误判成 96% 通关）。
 *
 *   node scripts/balance/density.mjs [--level 1-10] [--step 4] [--seeds 3]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { playSequence, restoreRandom } from './harness.mjs';

const OUT_DIR = '/tmp/pig-balance';
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const only = arg('level', null);
const STEP = Number(arg('step', '4'));
const SEEDS = Number(arg('seeds', '3'));
const ANGLE_MIN = 4;
const ANGLE_MAX = 72;
const PULL_MIN = 78;
const PULL_MAX = 150;
const SKILL_STEPS = [20, 32];
const ACTIVE = new Set(['prof', 'chef', 'spy']);
const LEVEL_IDS = ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7', '1-8', '1-9', '1-10'];

const { LEVELS } = await import('./harness.mjs').then((m) => m.loadGame());

const angles = [];
for (let a = ANGLE_MIN; a <= ANGLE_MAX; a += STEP) angles.push(a);
const pulls = [];
for (let p = PULL_MIN; p <= PULL_MAX; p += STEP) pulls.push(p);

const out = [];
for (const levelId of only ? [only] : LEVEL_IDS) {
  const level = LEVELS.find((l) => l.id === levelId);
  const pigTypes = level.pigs;
  const points = [];
  for (let pigIndex = 0; pigIndex < pigTypes.length; pigIndex += 1) {
    const isActive = ACTIVE.has(pigTypes[pigIndex]);
    for (const angleDeg of angles) {
      for (const pull of pulls) {
        points.push({ angleDeg, pull, pigIndex });
        if (isActive) {
          for (const skillAtStep of SKILL_STEPS) points.push({ angleDeg, pull, pigIndex, skillAtStep });
        }
      }
    }
  }
  let reached = 0;
  let stable = 0;
  let star3 = 0;
  let star2 = 0;
  const star3Points = [];
  for (const point of points) {
    let wins = 0;
    let stars = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await playSequence(levelId, [point], { seed });
      if (res.won) {
        wins += 1;
        stars.push(res.stars);
      }
    }
    if (wins > 0) reached += 1;
    if (wins === SEEDS) {
      stable += 1;
      const minStar = Math.min(...stars);
      if (minStar >= 3) {
        star3 += 1;
        star3Points.push(`${point.angleDeg}°/${point.pull}${point.pigIndex ? `#${point.pigIndex}` : ''}${point.skillAtStep ? `@s${point.skillAtStep}` : ''}`);
      } else if (minStar >= 2) star2 += 1;
    }
  }
  const pct = (n) => Math.round((n / points.length) * 1000) / 10;
  out.push({
    levelId,
    pigs: pigTypes,
    points: points.length,
    reach: reached,
    reachRate: pct(reached),
    stable,
    stableRate: pct(stable),
    star3,
    star3Rate: pct(star3),
    star2,
    star2Rate: pct(star2),
    star3Points,
  });
  const last = out[out.length - 1];
  console.log(
    `${levelId}: 撒点 ${last.points} · 能通 ${last.reach}(${last.reachRate}%) · 稳定 ${last.stable}(${last.stableRate}%) · 稳定3★ ${last.star3}(${last.star3Rate}%) · 稳定2★ ${last.star2}(${last.star2Rate}%)`,
  );
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, only ? `density-${only}.json` : 'density.json'), JSON.stringify(out, null, 2));
restoreRandom();
