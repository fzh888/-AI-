/**
 * 稳健性复测（第三轮 3.5）：把 solve 里找到的通关解拿 10 个随机种子重跑，
 * 区分「稳定通关」与「偶然通关」。
 *
 *   node scripts/balance/robust.mjs [--level 1-6] [--seeds 10] [--top 12]
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { playSequence, restoreRandom } from './harness.mjs';

const OUT_DIR = '/tmp/pig-balance';
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const only = arg('level', null);
const SEEDS = Number(arg('seeds', '10'));
const TOP = Number(arg('top', '12'));

const files = (await readdir(OUT_DIR)).filter((f) => /^solve-.*\.json$/.test(f)).sort();
const reports = [];
for (const f of files) {
  const r = JSON.parse(await readFile(path.join(OUT_DIR, f), 'utf8'));
  if (!only || r.levelId === only) reports.push(r);
}

/** 从网格里挑「彼此不同」的通关解（角度差 ≥6 或力度差 ≥18），优先高分/高星 */
function pickRoutes(report, top) {
  const wins = report.stage1.grid.filter((g) => g.w === 1).sort((a, b) => b.st - a.st || b.sc - a.sc);
  const picked = [];
  for (const g of wins) {
    if (picked.some((p) => Math.abs(p.a - g.a) < 6 && Math.abs(p.p - g.p) < 18 && p.g === g.g)) continue;
    picked.push(g);
    if (picked.length >= top) break;
  }
  return picked.map((g) => ({ angleDeg: g.a, pull: g.p, pigIndex: g.g, ...(g.s ? (g.s < 100 ? { skillAtStep: g.s } : { skillAtX: g.s }) : {}) }));
}

const label = (s) =>
  `${s.angleDeg}°/${s.pull}${s.pigIndex ? `#${s.pigIndex}` : ''}${s.skillAtStep ? `@s${s.skillAtStep}` : s.skillAtX ? `@x${s.skillAtX}` : ''}`;

const out = [];
for (const report of reports) {
  const routes = pickRoutes(report, TOP);
  const rows = [];
  for (const route of routes) {
    const results = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await playSequence(report.levelId, [route], { seed });
      results.push({ seed, won: res.won, stars: res.stars, score: res.score });
    }
    const wins = results.filter((r) => r.won).length;
    const stars = results.filter((r) => r.won).map((r) => r.stars);
    rows.push({
      label: label(route),
      route,
      wins,
      ratio: wins / SEEDS,
      minStars: stars.length ? Math.min(...stars) : 0,
      maxStars: stars.length ? Math.max(...stars) : 0,
      avgScore: Math.round(results.filter((r) => r.won).reduce((s, r) => s + r.score, 0) / Math.max(1, wins)),
    });
  }
  rows.sort((a, b) => b.ratio - a.ratio || b.avgScore - a.avgScore);
  const stable = rows.filter((r) => r.ratio === 1).length;
  out.push({ levelId: report.levelId, seeds: SEEDS, stable, total: rows.length, rows });
  console.log(`\n### ${report.levelId}  稳定解 ${stable}/${rows.length}（${SEEDS} 个种子）`);
  for (const r of rows) {
    console.log(
      `  ${r.label.padEnd(14)} 通关 ${r.wins}/${SEEDS}  ${r.ratio === 1 ? '稳定' : r.ratio >= 0.5 ? '较稳' : '偶然'}  星 ${r.minStars}~${r.maxStars}  均分 ${r.avgScore}`,
    );
  }
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, only ? `robust-${only}.json` : 'robust-all.json'), JSON.stringify(out, null, 2));
restoreRandom();
