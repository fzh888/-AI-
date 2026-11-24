/**
 * 稳定性与可复现性检查（第三轮第二阶段 3.5）：
 *  1) 开局静置 6s：谁在慢慢滑（逐块位移）、有没有白送分；
 *  2) 同参数重复 3 次：结果是否完全一致（物理有无随机源）；
 *  3) 换随机种子 5 次：通关/星级是否稳定。
 *
 *   node scripts/balance/stability.mjs [--level 1-5]
 */
import { createRun, loadGame, playSequence, restoreRandom, seedRandom, shoot } from './harness.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};

const LEVEL_IDS = ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7', '1-8', '1-9', '1-10'];
const only = arg('level', null);

/** 静置 ms 毫秒，返回逐块位移（只报动了的） */
async function settleCheck(levelId, ms) {
  seedRandom(1);
  const run = await createRun(levelId);
  const { eng, frame } = run;
  const start = new Map();
  eng.blockBodies.forEach((body) => {
    start.set(body.id, { x: body.position.x, y: body.position.y, def: eng.blockMeta.get(body.id) });
  });
  const frames = Math.ceil(ms / 16.666);
  for (let i = 0; i < frames; i += 1) frame();
  const moved = [];
  eng.blockBodies.forEach((body) => {
    const s = start.get(body.id);
    if (!s) return;
    const d = Math.hypot(body.position.x - s.x, body.position.y - s.y);
    if (d > 1) moved.push({ mat: s.def?.mat ?? '?', x: Math.round(s.def?.x ?? s.x), y: Math.round(s.def?.y ?? s.y), d: Math.round(d * 10) / 10 });
  });
  const birdsMoved = eng.birdRuntimes?.filter((b) => b.dead).length ?? 0;
  const result = {
    levelId,
    ms,
    score: eng.score,
    broken: eng.brokenBlocks,
    moved: moved.sort((a, b) => b.d - a.d).slice(0, 6),
    maxDrift: moved.length ? Math.max(...moved.map((m) => m.d)) : 0,
    birdsDead: birdsMoved,
  };
  eng.destroy();
  return result;
}

async function determinismCheck(levelId, shots, times = 3) {
  const out = [];
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await playSequence(levelId, shots, { seed: 1 });
    out.push(`${res.won ? '胜' : '负'}/${res.stars}★/${res.score}分/破${res.brokenBlocks}/连锁${res.maxChain}`);
  }
  const same = new Set(out).size === 1;
  return { levelId, shots, out, same };
}

async function seedCheck(levelId, shots, seeds = [1, 2, 3, 4, 5]) {
  const out = [];
  for (const seed of seeds) {
    // eslint-disable-next-line no-await-in-loop
    const res = await playSequence(levelId, shots, { seed });
    out.push({ seed, won: res.won, stars: res.stars, score: res.score });
  }
  const wins = out.filter((o) => o.won).length;
  return { levelId, shots, wins, total: out.length, out };
}

const { LEVELS } = await loadGame();
const routes = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile('/tmp/pig-balance/routes.json', 'utf8').catch(() => 'null'))) ?? {};

const ids = only ? [only] : LEVEL_IDS;
for (const levelId of ids) {
  const lv = LEVELS.find((l) => l.id === levelId);
  const a = await settleCheck(levelId, 2400);
  const b = await settleCheck(levelId, 6000);
  console.log(`\n### ${levelId}（${lv.pigs.join('/')}）`);
  console.log(`  静置 2.4s：得分 ${a.score} 破块 ${a.broken} 最大位移 ${a.maxDrift}px`);
  console.log(`  静置 6.0s：得分 ${b.score} 破块 ${b.broken} 最大位移 ${b.maxDrift}px`);
  if (b.moved.length) console.log(`  滑动块：${b.moved.map((m) => `${m.mat}(${m.x},${m.y}) ${m.d}px`).join(' , ')}`);
  if (b.birdsDead) console.log(`  静置期间鸟死亡 ${b.birdsDead}`);
  const route = routes[levelId];
  if (route) {
    const d = await determinismCheck(levelId, route);
    const s = await seedCheck(levelId, route);
    console.log(`  重复 3 次 ${route.map((r) => `${r.angleDeg}°/${r.pull}${r.pigIndex ? '#' + r.pigIndex : ''}`).join('→')}：${d.out.join(' | ')}${d.same ? ' ✓ 完全一致' : ' ✗ 不一致'}`);
    console.log(`  换 5 个种子：${s.wins}/${s.total} 通关`);
  }
}
restoreRandom();
void shoot;
