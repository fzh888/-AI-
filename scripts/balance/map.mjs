/**
 * 把 solve 的网格结果画成「通关窗口」矩阵：每个角度一行，每个力度一列。
 * 单元格 = 该 (角度,力度) 下有多少比例的候选发成功（含各猪与技能变体）。
 *
 *   node scripts/balance/map.mjs [--level 1-6]
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = '/tmp/pig-balance';
const only = process.argv.includes('--level') ? process.argv[process.argv.indexOf('--level') + 1] : null;

const files = (await readdir(OUT_DIR)).filter((f) => /^solve-.*\.json$/.test(f)).sort();
const reports = [];
for (const f of files) {
  const r = JSON.parse(await readFile(path.join(OUT_DIR, f), 'utf8'));
  if (only && r.levelId !== only) continue;
  reports.push(r);
}

const cells = (grid) => {
  const map = new Map();
  for (const g of grid) {
    const key = `${g.a}:${g.p}`;
    const cur = map.get(key) ?? { a: g.a, p: g.p, tried: 0, won: 0, best: 0, bestStars: 0 };
    cur.tried += 1;
    if (g.w) {
      cur.won += 1;
      if (g.st > cur.bestStars || (g.st === cur.bestStars && g.sc > cur.best)) {
        cur.bestStars = g.st;
        cur.best = g.sc;
      }
    }
    map.set(key, cur);
  }
  return [...map.values()];
};

for (const r of reports) {
  const list = cells(r.stage1.grid);
  const angles = [...new Set(list.map((c) => c.a))].sort((x, y) => x - y);
  const pulls = [...new Set(list.map((c) => c.p))].sort((x, y) => y - x);
  console.log(`\n### ${r.levelId}（${r.pigTypes.join('/')}）  单发通关 ${r.stage1.wins}/${r.stage1.tried}`);
  console.log(`角度\\力度 ${pulls.map((p) => String(p).padStart(8)).join('')}`);
  for (const a of angles) {
    const row = pulls.map((p) => {
      const c = list.find((x) => x.a === a && x.p === p);
      if (!c) return '       —';
      if (!c.won) return '       ·';
      return `${String(c.won).padStart(2)}/${String(c.tried).padStart(2)}`.padStart(6) + (c.bestStars >= 3 ? '*' : ' ');
    });
    console.log(`${String(a).padStart(6)}° ${row.join('')}`);
  }
}
