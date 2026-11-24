/**
 * 汇总第三轮测试数据：读 /tmp/pig-balance/solve-*.json，输出难度/星级/容错指标。
 *
 *   node scripts/balance/analyze.mjs [--json]
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = '/tmp/pig-balance';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const PIG_NAME = {
  normal: '普通猪',
  prof: '教授猪',
  chef: '冲刺猪',
  helmet: '钢盔猪',
  king: '国王猪',
  spy: '特工猪',
};

async function loadReports() {
  const files = await readdir(OUT_DIR);
  const reports = [];
  for (const file of files) {
    if (!/^solve-.*\.json$/.test(file)) continue;
    // eslint-disable-next-line no-await-in-loop
    const raw = await readFile(path.join(OUT_DIR, file), 'utf8');
    reports.push(JSON.parse(raw));
  }
  return reports.sort((a, b) => a.levelId.localeCompare(b.levelId));
}

function pct(n, d) {
  return d ? `${Math.round((n / d) * 1000) / 10}%` : '—';
}

function perLevel(report) {
  const wins = report.solutions ?? [];
  const byStars = { 1: 0, 2: 0, 3: 0 };
  for (const s of wins) byStars[s.stars] = (byStars[s.stars] ?? 0) + 1;
  const oneShotWins = wins.filter((s) => s.shots.length === 1);
  return {
    levelId: report.levelId,
    pigs: report.pigTypes.map((t) => PIG_NAME[t] ?? t),
    tried: report.stage1.tried,
    wins: report.stage1.wins,
    winRate: report.stage1.winRate,
    byStars,
    minShots: report.minShots,
    solutionCount: report.solutionCount ?? wins.length,
    bestScore: report.bestStarRoute?.score ?? null,
    bestLabel: report.bestStarRoute?.label ?? null,
    bestBreakRatio:
      report.bestStarRoute && report.bestStarRoute.levelWorth
        ? Math.round((report.bestStarRoute.breakScore / report.bestStarRoute.levelWorth) * 1000) / 10
        : null,
    settleScore: report.settle?.score ?? 0,
    settleDrift: report.settle?.drift ?? 0,
    nearMiss: report.stage1.nearMiss ?? [],
    bestWin: report.stage1.bestWin,
    oneShotWinRate: pct(oneShotWins.length, oneShotWins.length + (report.stage1.tried - report.stage1.wins)),
  };
}

function table(rows) {
  const head = '| 关卡 | 小猪 | 单发网格 | 通关 | 通关率 | 1★ | 2★ | 3★ | 最好分 | 最好破坏率 | 静置得分 | 静置位移 |';
  const sep = '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|';
  const body = rows.map(
    (r) =>
      `| ${r.levelId} | ${r.pigs.join('/')} | ${r.tried} | ${r.wins} | ${r.winRate}% | ${r.byStars[1] ?? 0} | ${r.byStars[2] ?? 0} | ${r.byStars[3] ?? 0} | ${r.bestScore ?? '—'} | ${r.bestBreakRatio ?? '—'}% | ${r.settleScore} | ${r.settleDrift}px |`,
  );
  return [head, sep, ...body].join('\n');
}

const reports = await loadReports();
if (!reports.length) {
  console.error('没有数据：先跑 scripts/balance/solve.mjs');
  process.exit(1);
}
const rows = reports.map(perLevel);

if (asJson) {
  console.log(JSON.stringify({ rows, raw: reports }, null, 2));
} else {
  console.log(table(rows));
  console.log('');
  for (const row of rows) {
    console.log(`### ${row.levelId}（代表路线 ${row.bestLabel}，${row.bestScore} 分）`);
    const near = row.nearMiss.slice(0, 4).map((n) => `${n.label}(蛋距${n.minEggDist})`);
    console.log(`  擦边：${near.join(' , ') || '—'}`);
  }
}
