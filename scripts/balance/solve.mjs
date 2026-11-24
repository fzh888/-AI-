/**
 * 关卡通关性求解（第三轮）：分阶段搜索，输出可复核的「已测试成功」清单。
 *
 *   阶段 1：单发全网格（所有猪 × 11 角度 × 5 力度 + 主动技能小猪的技能时机变体）
 *   阶段 2：单发无解时，首发取 20 个差异化候选 + 次发全网格
 *   阶段 3：两发仍无解时，前两发各取 6 个候选 + 第三发全网格
 *
 *   node scripts/balance/solve.mjs --level 1-3 [--maxShots 3] [--out solve-1-3]
 *
 * 只写 /tmp/pig-balance/*.json：不写存档、不改关卡数据、不做成就与累计统计。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadGame, playSequence, restoreRandom } from './harness.mjs';

const OUT_DIR = '/tmp/pig-balance';
export const ANGLE_GRID = [8, 14, 20, 26, 32, 38, 44, 50, 56, 62, 68];
export const PULL_GRID = [150, 132, 114, 96, 78];
/** 主动技能小猪的技能时机（飞行步数）与触发位置（世界 x）变体 */
const SKILL_STEPS = [16, 24, 32];
const SKILL_X = [1100, 1250, 1360];
const ACTIVE = new Set(['prof', 'chef', 'spy']);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};

function variants(angleDeg, pull, pigIndex, pigType) {
  const base = [{ angleDeg, pull, pigIndex }];
  if (!pigType || !ACTIVE.has(pigType)) return base;
  return [
    ...base,
    ...SKILL_STEPS.map((skillAtStep) => ({ angleDeg, pull, pigIndex, skillAtStep })),
    ...SKILL_X.map((skillAtX) => ({ angleDeg, pull, pigIndex, skillAtX })),
  ];
}

export function label(shot) {
  const skill = shot.skillAtStep ? `@s${shot.skillAtStep}` : shot.skillAtX ? `@x${shot.skillAtX}` : '';
  return `${shot.angleDeg}°/${shot.pull}${shot.pigIndex ? `#${shot.pigIndex}` : ''}${skill}`;
}

/** 全网格（可按猪类型过滤），返回 [{shot,label,res}] */
async function gridScan(levelId, pigTypes, { seed = 1, pigFilter = null } = {}) {
  const rows = [];
  for (let pigIndex = 0; pigIndex < pigTypes.length; pigIndex += 1) {
    if (pigFilter && !pigFilter.includes(pigIndex)) continue;
    for (const angleDeg of ANGLE_GRID) {
      for (const pull of PULL_GRID) {
        for (const shot of variants(angleDeg, pull, pigIndex, pigTypes[pigIndex])) {
          // eslint-disable-next-line no-await-in-loop
          const res = await playSequence(levelId, [shot], { seed });
          rows.push({ shot, label: label(shot), res });
        }
      }
    }
  }
  return rows;
}

const rank = (r) =>
  r.won
    ? 1e6 + r.stars * 1e4 + r.score
    : r.score + (r.maxChain >= 3 ? 150 : 0) - (r.perShot[0]?.minEggDist ?? 500) * 1.2;

/** 候选：分数最高的若干，且彼此角度/力度有差异，避免候选挤在同一点 */
function pickCandidates(rows, count, { angleGap = 6, pullGap = 18 } = {}) {
  const sorted = [...rows].sort((a, b) => rank(b.res) - rank(a.res));
  const picked = [];
  for (const row of sorted) {
    if (
      picked.some(
        (p) =>
          Math.abs(p.shot.angleDeg - row.shot.angleDeg) <= angleGap &&
          Math.abs(p.shot.pull - row.shot.pull) <= pullGap &&
          p.shot.pigIndex === row.shot.pigIndex,
      )
    ) {
      continue;
    }
    picked.push(row);
    if (picked.length >= count) break;
  }
  return picked;
}

function summarize(entry) {
  if (!entry) return null;
  const r = entry.res;
  return {
    label: entry.label ?? entry.shots.map(label).join(' → '),
    shots: entry.shots,
    won: r.won,
    stars: r.stars,
    score: r.score,
    usedPigs: r.usedPigs,
    breakScore: r.breakScore,
    chainBonus: r.chainBonus,
    birdScore: r.birdScore,
    pigBonus: r.pigBonus,
    maxChain: r.maxChain,
    birdsCaptured: r.birdsCaptured,
    brokenBlocks: r.brokenBlocks,
    levelWorth: r.levelWorth,
    goals: (r.goals ?? []).map((g) => ({ id: g.id, reached: g.reached, hint: g.hint })),
  };
}

export async function solveLevel(levelId, maxShots = 3, options = {}) {
  const { LEVELS } = await loadGame();
  const level = LEVELS.find((lv) => lv.id === levelId);
  const pigTypes = level.pigs;
  const seed = options.seed ?? 1;
  const t0 = Date.now();
  const report = { levelId, pigTypes, seed, stage1: null, stage2: null, stage3: null, solutions: [] };

  const stage1 = await gridScan(levelId, pigTypes, { seed });
  report.settle = stage1[0].res.settle;
  const wins1 = stage1.filter((r) => r.res.won);
  // 分猪统计 + 技能效果（主动技能猪：不带技能 vs 带技能）
  report.perPig = pigTypes.map((type, index) => {
    const rows = stage1.filter((r) => r.shot.pigIndex === index);
    const plain = rows.filter((r) => !r.shot.skillAtStep && !r.shot.skillAtX);
    const skilled = rows.filter((r) => r.shot.skillAtStep || r.shot.skillAtX);
    return {
      pigType: type,
      tried: rows.length,
      wins: rows.filter((r) => r.res.won).length,
      plainTried: plain.length,
      plainWins: plain.filter((r) => r.res.won).length,
      skilledTried: skilled.length,
      skilledWins: skilled.filter((r) => r.res.won).length,
      bestScore: Math.max(0, ...rows.filter((r) => r.res.won).map((r) => r.res.score)),
    };
  });
  report.stage1 = {
    tried: stage1.length,
    wins: wins1.length,
    winRate: Math.round((wins1.length / stage1.length) * 1000) / 10,
    /** 全网格原始结果（画通关窗口用） */
    grid: stage1.map((r) => ({
      a: r.shot.angleDeg,
      p: r.shot.pull,
      g: r.shot.pigIndex,
      s: r.shot.skillAtStep ?? r.shot.skillAtX ?? 0,
      w: r.res.won ? 1 : 0,
      st: r.res.stars,
      sc: r.res.score,
      d: r.res.perShot[0]?.minEggDist ?? -1,
      b: r.res.brokenBlocks,
      c: r.res.maxChain,
    })),
    bestWin: summarize(wins1.sort((a, b) => b.res.stars - a.res.stars || b.res.score - a.res.score)[0]),
    bestScore: summarize([...stage1].sort((a, b) => b.res.score - a.res.score)[0]),
    nearMiss: pickCandidates(
      stage1.filter((r) => !r.res.won),
      8,
    ).map((r) => ({
      label: r.label,
      minEggDist: r.res.perShot[0]?.minEggDist ?? null,
      broken: r.res.brokenBlocks,
      maxChain: r.res.maxChain,
      score: r.res.score,
    })),
  };
  if (wins1.length) report.solutions.push(...wins1.map((r) => ({ shots: [r.shot], res: r.res })));
  if (wins1.length || maxShots < 2) return finish(report, t0);

  // ---- 阶段 2：两发 ----
  const firsts2 = pickCandidates(stage1, 20);
  const stage2Wins = [];
  let tried2 = 0;
  for (const first of firsts2) {
    for (let pigIndex = 0; pigIndex < pigTypes.length - 1; pigIndex += 1) {
      for (const angleDeg of ANGLE_GRID) {
        for (const pull of PULL_GRID) {
          for (const second of variants(angleDeg, pull, pigIndex, pigTypes[pigIndex])) {
            tried2 += 1;
            // eslint-disable-next-line no-await-in-loop
            const res = await playSequence(levelId, [first.shot, second], { seed });
            if (res.won) stage2Wins.push({ shots: [first.shot, second], res });
          }
        }
      }
    }
  }
  report.stage2 = {
    tried: tried2,
    wins: stage2Wins.length,
    best: summarize(stage2Wins.sort((a, b) => b.res.stars - a.res.stars || b.res.score - a.res.score)[0]),
  };
  if (stage2Wins.length) report.solutions.push(...stage2Wins);
  if (stage2Wins.length || maxShots < 3) return finish(report, t0);

  // ---- 阶段 3：三发（前两发各取少量候选，第三发全网格） ----
  const stage3Wins = [];
  let tried3 = 0;
  for (const first of firsts2.slice(0, 6)) {
    for (const second of pickCandidates(stage1, 6)) {
      for (let pigIndex = 0; pigIndex < pigTypes.length - 2; pigIndex += 1) {
        for (const angleDeg of ANGLE_GRID) {
          for (const pull of PULL_GRID) {
            tried3 += 1;
            const third = { angleDeg, pull, pigIndex };
            // eslint-disable-next-line no-await-in-loop
            const res = await playSequence(levelId, [first.shot, second.shot, third], { seed });
            if (res.won) stage3Wins.push({ shots: [first.shot, second.shot, third], res });
          }
        }
      }
    }
  }
  report.stage3 = {
    tried: tried3,
    wins: stage3Wins.length,
    best: summarize(stage3Wins.sort((a, b) => b.res.stars - a.res.stars || b.res.score - a.res.score)[0]),
  };
  if (stage3Wins.length) report.solutions.push(...stage3Wins);
  return finish(report, t0);
}

function finish(report, t0) {
  report.ms = Date.now() - t0;
  report.solutions.sort((a, b) => a.shots.length - b.shots.length || b.res.stars - a.res.stars || b.res.score - a.res.score);
  report.minShots = report.solutions.length ? report.solutions[0].shots.length : null;
  report.bestOverall = summarize(report.solutions[0]);
  report.bestStarRoute = summarize(
    [...report.solutions].sort((a, b) => b.res.stars - a.res.stars || b.res.score - a.res.score)[0],
  );
  // 只保留每关最多 40 条解，避免 JSON 过大（不删除原始解的数量统计）
  report.solutionCount = report.solutions.length;
  report.solutions = report.solutions.slice(0, 40).map((s) => summarize(s));
  return report;
}

async function main() {
  const levelId = arg('level', '1-1');
  const maxShots = Number(arg('maxShots', '3'));
  const outName = arg('out', `solve-${levelId}`);
  const report = await solveLevel(levelId, maxShots);
  await mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${outName}.json`);
  await writeFile(file, JSON.stringify(report, null, 2));
  const s = report.stage1;
  console.log(
    `${levelId}: 单发 ${s.wins}/${s.tried}` +
      `${report.stage2 ? ` · 两发 ${report.stage2.wins}/${report.stage2.tried}` : ''}` +
      `${report.stage3 ? ` · 三发 ${report.stage3.wins}/${report.stage3.tried}` : ''}` +
      ` · 最少 ${report.minShots ?? '-'} 发 · 最好 ${report.bestStarRoute?.score ?? 0}分/${report.bestStarRoute?.stars ?? 0}星 · ${report.ms}ms`,
  );
  if (report.settle.score > 0) console.log(`  ⚠ 开局静置得分 ${report.settle.score}（自毁）`);
  if (report.settle.drift > 3) console.log(`  ⚠ 开局位移 ${report.settle.drift}px`);
  if (report.bestOverall) console.log(`  代表路线 ${report.bestOverall.label}`);
}

if (process.argv[1] && process.argv[1].endsWith('solve.mjs')) {
  try {
    await main();
  } finally {
    restoreRandom();
  }
}
