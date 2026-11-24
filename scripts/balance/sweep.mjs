/**
 * 关卡平衡扫描 CLI（第三轮）。
 *
 *   node scripts/balance/sweep.mjs scan   --level 1-3 --pigs 0,1,2
 *   node scripts/balance/sweep.mjs seq    --level 1-3 --shots "30:150:0@40|36:150:0"
 *   node scripts/balance/sweep.mjs repeat --level 1-3 --shots "30:150" --seeds 1,2,3,4,5
 *
 * 输出：/tmp/pig-balance/<name>.json（结果来自真引擎，可重复运行）。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { LIMITS, playSequence, restoreRandom } from './harness.mjs';

const OUT_DIR = '/tmp/pig-balance';

/** 与游戏里能拖出来的范围一致：角度 8~72°，拉伸 40~MAX_PULL(150) */
export const ANGLE_GRID = [8, 14, 20, 26, 32, 38, 44, 50, 56, 62, 68];
export const PULL_GRID = [150, 132, 114, 96, 78];

/** "30:150:1@40" → {angleDeg:30, pull:150, pigIndex:1, skillAtStep:40} */
export function parseShot(text) {
  const [main, skill] = text.split('@');
  const [angle, pull, pigIndex] = main.split(':');
  const shot = { angleDeg: Number(angle), pull: Number(pull) };
  if (pigIndex !== undefined && pigIndex !== '') shot.pigIndex = Number(pigIndex);
  if (skill !== undefined && skill !== '') {
    if (skill.startsWith('x')) shot.skillAtX = Number(skill.slice(1));
    else shot.skillAtStep = Number(skill);
  }
  return shot;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return process.argv[i + 1];
}

async function save(name, payload) {
  await mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.json`);
  await writeFile(file, JSON.stringify(payload, null, 2));
  return file;
}

async function main() {
  const mode = process.argv[2] ?? 'scan';
  const level = arg('level', '1-1');
  const seeds = (arg('seeds', '1') ?? '1').split(',').map(Number);
  const outName = arg('out', `${mode}-${level}`);

  if (mode === 'scan') {
    const pigIdx = (arg('pigs', '0') ?? '0').split(',').map(Number);
    const angles = (arg('angles') ? arg('angles').split(',').map(Number) : ANGLE_GRID) ?? ANGLE_GRID;
    const pulls = (arg('pulls') ? arg('pulls').split(',').map(Number) : PULL_GRID) ?? PULL_GRID;
    const rows = [];
    let best = null;
    for (const pigIndex of pigIdx) {
      for (const angleDeg of angles) {
        for (const pull of pulls) {
          const res = await playSequence(level, [{ angleDeg, pull, pigIndex }], { seed: 1 });
          const row = {
            levelId: level,
            pigIndex,
            angleDeg,
            pull,
            won: res.won,
            stars: res.stars,
            shots: res.shots,
            usedPigs: res.usedPigs,
            score: res.score,
            breakScore: res.breakScore,
            chainBonus: res.chainBonus,
            birdScore: res.birdScore,
            pigBonus: res.pigBonus,
            maxChain: res.maxChain,
            birdsCaptured: res.birdsCaptured,
            brokenBlocks: res.brokenBlocks,
            levelWorth: res.levelWorth,
            goals: res.goals.map((g) => ({ id: g.id, reached: g.reached })),
            minEggDist: res.perShot[0]?.minEggDist ?? null,
            lastPos: res.perShot[0]?.lastPos ?? null,
            frames: res.perShot[0]?.frames ?? 0,
            settleScore: res.settle.score,
            settleDrift: res.settle.drift,
          };
          rows.push(row);
          if (!best || rank(row) > rank(best)) best = row;
        }
      }
    }
    const wins = rows.filter((r) => r.won);
    const payload = {
      mode,
      levelId: level,
      grid: { angles, pulls, pigIdx },
      total: rows.length,
      wins: wins.length,
      winRate: rows.length ? Math.round((wins.length / rows.length) * 1000) / 10 : 0,
      best,
      // 差一点就进蛋的样本，供第二轮搜索挑首发
      nearMiss: rows
        .filter((r) => !r.won)
        .sort((a, b) => (a.minEggDist ?? 9e9) - (b.minEggDist ?? 9e9))
        .slice(0, 12)
        .map((r) => ({
          pigIndex: r.pigIndex,
          angleDeg: r.angleDeg,
          pull: r.pull,
          minEggDist: r.minEggDist,
          brokenBlocks: r.brokenBlocks,
          breakScore: r.breakScore,
          maxChain: r.maxChain,
        })),
      topScores: [...rows].sort((a, b) => b.score - a.score).slice(0, 8),
      rows,
    };
    const file = await save(outName, payload);
    console.log(
      `${level} scan: ${rows.length} 发, 通关 ${wins.length} (${payload.winRate}%), 最好 ${best?.score ?? 0}分/${best?.stars ?? 0}星 (${best?.angleDeg}°/${best?.pull}) → ${file}`,
    );
    if (best?.settleScore > 0) console.log(`  ⚠ 开局静置得分 ${best.settleScore}（不该 >0）`);
    return;
  }

  if (mode === 'seq') {
    const plan = (arg('shots', '') ?? '').split('|').filter(Boolean).map(parseShot);
    const res = await playSequence(level, plan, { seed: seeds[0] ?? 1 });
    console.log(JSON.stringify({ ...res, perShot: res.perShot.map(compact) }, null, 2));
    return;
  }

  if (mode === 'repeat') {
    const plan = (arg('shots', '') ?? '').split('|').filter(Boolean).map(parseShot);
    const rows = [];
    for (const seed of seeds) {
      // eslint-disable-next-line no-await-in-loop
      const res = await playSequence(level, plan, { seed });
      rows.push({
        seed,
        won: res.won,
        stars: res.stars,
        score: res.score,
        maxChain: res.maxChain,
        brokenBlocks: res.brokenBlocks,
        birdsCaptured: res.birdsCaptured,
        minEggDist: res.perShot[res.perShot.length - 1]?.minEggDist ?? null,
      });
    }
    const wins = rows.filter((r) => r.won).length;
    const file = await save(outName, { mode, levelId: level, plan: arg('shots'), rows });
    console.log(
      `${level} ${arg('shots')} × ${seeds.length} seeds → 通关 ${wins}/${seeds.length}，分数 ${rows.map((r) => r.score).join('/')} → ${file}`,
    );
    return;
  }

  throw new Error(`未知模式：${mode}`);
}

function compact(shot) {
  return {
    pigType: shot.pigType,
    angleDeg: shot.angleDeg,
    pull: shot.pull,
    skillFired: shot.skillFired,
    state: shot.state,
    minEggDist: shot.minEggDist,
    lastPos: shot.lastPos,
    brokenDelta: shot.brokenDelta,
    birdsDelta: shot.birdsDelta,
    scoreDelta: shot.scoreDelta,
  };
}

/** 首发质量排序：先看通关，再看破坏与靠近蛋的程度 */
function rank(row) {
  if (row.won) return 1e9 + row.stars * 1000 + row.score;
  return row.score + (row.maxChain >= 3 ? 200 : 0) - (row.minEggDist ?? 400) * 2;
}

try {
  await main();
} finally {
  restoreRandom();
  void LIMITS;
}
