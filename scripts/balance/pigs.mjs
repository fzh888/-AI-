/**
 * 第五阶段：六种小猪的真实战术价值（只在真实引擎上测，不猜）。
 *
 * 对每一关、每一个可用猪位（第 1/2/3 发）统计：
 *   - reach：这只猪**首发**能在多少比例的（角度, 力度）撒点上通关
 *   - best：这只猪拿到过的最高分与最高星
 *   - skill：主动技能猪再统计「开技能」相对于「不开技能」的通关占比提升（技能是否真的改变策略）
 *
 *   node scripts/balance/pigs.mjs [--step 8] [--seeds 2]
 */
import { playSequence, restoreRandom } from './harness.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const STEP = Number(arg('step', '8'));
const SEEDS = Number(arg('seeds', '2'));
const SKILL_STEPS = [20, 32];
const ACTIVE = new Set(['prof', 'chef', 'spy']);

const { LEVELS } = await import('./harness.mjs').then((m) => m.loadGame());

const angles = [];
for (let a = 4; a <= 72; a += STEP) angles.push(a);
const pulls = [];
for (let p = 78; p <= 150; p += STEP) pulls.push(p);
const grid = [];
for (const angleDeg of angles) for (const pull of pulls) grid.push({ angleDeg, pull });

const rows = [];
for (const level of LEVELS) {
  console.log(`\n=== ${level.id} ${level.name} · ${level.pigs.join(' / ')}`);
  const perPig = [];
  for (let pigIndex = 0; pigIndex < level.pigs.length; pigIndex += 1) {
    const type = level.pigs[pigIndex];
    let reach = 0;
    let best = -1;
    let bestStars = 0;
    let stable = 0;
    for (const point of grid) {
      let wins = 0;
      let score = -1;
      let stars = 0;
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await playSequence(level.id, [{ ...point, pigIndex }], { seed });
        if (res.won) {
          wins += 1;
          if (res.score > score) {
            score = res.score;
            stars = res.stars;
          }
        }
      }
      if (wins > 0) reach += 1;
      if (wins === SEEDS) stable += 1;
      if (score > best) {
        best = score;
        bestStars = stars;
      }
    }
    let skillReach = -1;
    let noSkillReach = -1;
    if (ACTIVE.has(type)) {
      noSkillReach = reach;
      skillReach = 0;
      // 只在"不开技能也通"的参数上用技能重跑太乐观，这里对同一批撒点全量重跑一遍
      for (const point of grid) {
        let wins = 0;
        for (const skillAtStep of SKILL_STEPS) {
          // eslint-disable-next-line no-await-in-loop
          const res = await playSequence(level.id, [{ ...point, pigIndex, skillAtStep }], { seed: 1 });
          if (res.won) wins += 1;
        }
        if (wins > 0) skillReach += 1;
      }
    }
    const pct = (n) => Math.round((n / grid.length) * 1000) / 10;
    perPig.push({ levelId: level.id, pigIndex, type, reach, stable, rate: pct(reach), best, bestStars, noSkillReach, skillReach });
    console.log(
      `  ${pigIndex === 0 ? '首发' : pigIndex === 1 ? '第二发' : '第三发'} ${type.padEnd(6, ' ')} 撒点 ${grid.length} · 能通 ${reach}(${pct(reach)}%) · 稳定 ${stable}(${pct(stable)}%) · 最高 ${best} 分 / ${bestStars}★` +
        (skillReach >= 0 ? ` · 技能撒点 ${skillReach}(${pct(skillReach)}%) vs 无技能 ${pct(noSkillReach)}%` : ''),
    );
  }
  rows.push(...perPig);
}

restoreRandom();
console.log('\n--- 汇总：每只猪在每关的首发通关占比（%） ---');
const types = ['normal', 'helmet', 'prof', 'chef', 'king', 'spy'];
console.log(`关卡   ${types.map((t) => t.padStart(6, ' ')).join(' ')}`);
for (const level of LEVELS) {
  const cells = types.map((t) => {
    const row = rows.find((r) => r.levelId === level.id && r.type === t);
    return row ? `${row.rate}`.padStart(6, ' ') : '     -';
  });
  console.log(`${level.id.padEnd(6, ' ')}${cells.join(' ')}`);
}
