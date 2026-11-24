/**
 * 细网格 + 多种子搜索（第三轮第二阶段）：确认某关到底有没有「稳定三星解」。
 *
 *   node scripts/balance/search.mjs --level 1-6 [--angleStep 2] [--pullStep 6] [--seeds 4]
 *
 * 只读：不改关卡数据、不写存档。结果写 /tmp/pig-balance/fine-<level>.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { playSequence, restoreRandom } from './harness.mjs';

const OUT_DIR = '/tmp/pig-balance';
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};

const levelId = arg('level', '1-6');
const angleStep = Number(arg('angleStep', '2'));
const angleMin = Number(arg('angleMin', '2'));
const angleMax = Number(arg('angleMax', '72'));
const pullStep = Number(arg('pullStep', '6'));
const pullMin = Number(arg('pullMin', '78'));
const pullMax = Number(arg('pullMax', '150'));
const SEEDS = Number(arg('seeds', '4'));
const SKILL_STEPS = [12, 20, 28, 36, 44];
const ACTIVE = new Set(['prof', 'chef', 'spy']);

const angles = [];
for (let a = angleMin; a <= angleMax; a += angleStep) angles.push(a);
const pulls = [];
for (let p = pullMax; p >= pullMin; p -= pullStep) pulls.push(p);

const { LEVELS } = await import('./harness.mjs').then((m) => m.loadGame());
const level = LEVELS.find((l) => l.id === levelId);
const pigTypes = level.pigs;

const label = (s) =>
  `${s.angleDeg}°/${s.pull}${s.pigIndex ? `#${s.pigIndex}` : ''}${s.skillAtStep ? `@s${s.skillAtStep}` : ''}`;

async function evaluate(shot) {
  const results = [];
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await playSequence(levelId, [shot], { seed });
    results.push(res);
  }
  const wins = results.filter((r) => r.won);
  const stars = wins.map((r) => r.stars);
  return {
    shot,
    label: label(shot),
    wins: wins.length,
    minStars: stars.length ? Math.min(...stars) : 0,
    maxStars: stars.length ? Math.max(...stars) : 0,
    avgScore: wins.length ? Math.round(wins.reduce((s, r) => s + r.score, 0) / wins.length) : 0,
    breakScore: wins.length ? wins[0].breakScore : 0,
    levelWorth: results[0].levelWorth,
  };
}

const all = [];
let tried = 0;
for (let pigIndex = 0; pigIndex < pigTypes.length; pigIndex += 1) {
  const isActive = ACTIVE.has(pigTypes[pigIndex]);
  for (const angleDeg of angles) {
    for (const pull of pulls) {
      tried += 1;
      // 先单次快筛：多打一次不带技能；先跑 1 个种子，通关再看多 seed（省时间）
      // eslint-disable-next-line no-await-in-loop
      const probe = await playSequence(levelId, [{ angleDeg, pull, pigIndex }], { seed: 1 });
      if (!probe.won) continue;
      // eslint-disable-next-line no-await-in-loop
      const row = await evaluate({ angleDeg, pull, pigIndex });
      all.push(row);
      if (isActive) {
        for (const skillAtStep of SKILL_STEPS) {
          // eslint-disable-next-line no-await-in-loop
          const p2 = await playSequence(levelId, [{ angleDeg, pull, pigIndex, skillAtStep }], { seed: 1 });
          if (!p2.won) continue;
          // eslint-disable-next-line no-await-in-loop
          all.push(await evaluate({ angleDeg, pull, pigIndex, skillAtStep }));
        }
      }
    }
  }
}

all.sort((a, b) => b.wins / SEEDS - a.wins / SEEDS || b.avgScore - a.avgScore);
const stable3 = all.filter((r) => r.wins === SEEDS && r.minStars === 3);
const stable = all.filter((r) => r.wins === SEEDS);
console.log(
  `${levelId}: 细网格 ${tried} 次探测，通关格 ${all.length} 个；稳定解 ${stable.length}，稳定三星解 ${stable3.length}（${SEEDS} 个种子）`,
);
for (const r of all.slice(0, 20)) {
  console.log(
    `  ${r.label.padEnd(16)} 通关 ${r.wins}/${SEEDS} 星 ${r.minStars}~${r.maxStars} 均分 ${r.avgScore} 破坏 ${r.breakScore}/${r.levelWorth}`,
  );
}
await mkdir(OUT_DIR, { recursive: true });
await writeFile(
  path.join(OUT_DIR, `fine-${levelId}.json`),
  JSON.stringify({ levelId, seeds: SEEDS, tried, rows: all }, null, 2),
);
restoreRandom();
