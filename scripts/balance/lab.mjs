/**
 * 关卡改动实验台（第三轮第六阶段）：**不碰 levels.ts**，在内存里改一份克隆再测。
 *
 *   node scripts/balance/lab.mjs --level 1-2 --variant base,pillar-44 --seeds 2 --step 6
 *
 * 每个 variant 由本文件的 VARIANTS 表定义（只做数据级改动：坐标/尺寸/材质/鸟的位置）。
 * 输出：能通 / 稳定 / 稳定三星的撒点占比，以及与 base 的差值，用来判断改动是否真的有效。
 */
import { createRunFromLevel, loadGame, restoreRandom, seedRandom, shoot } from './harness.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};

const STEP = Number(arg('step', '6'));
const SEEDS = Number(arg('seeds', '1'));
const SKILL_STEPS = [20, 32];
const ACTIVE = new Set(['prof', 'chef', 'spy']);

const angles = [];
for (let a = 6; a <= 72; a += STEP) angles.push(a);
const pulls = [];
for (let p = 78; p <= 150; p += STEP) pulls.push(p);

const block = (mat, x, y, w, h) => ({ x, y, w, h, mat });

/** 变体：拿到克隆后的关卡，原地改数据 */
const VARIANTS = {
  base: () => {},
  /* 1-2：石柱降低 80 → 44，中高力度也能越过柱顶落进巢 */
  'pillar-44': (lv) => {
    lv.blocks[3] = block('stone', 1244, 584, 44, 44);
  },
  /* 1-2：石柱再矮一点 80 → 26 */
  'pillar-26': (lv) => {
    lv.blocks[3] = block('stone', 1244, 593, 44, 26);
  },
  /* 1-2：石柱贴到平台最左端 */
  'pillar-left': (lv) => {
    lv.blocks[3] = block('stone', 1240, 566, 44, 80);
  },
  /* 1-2：蛋往前挪 30px */
  'egg-fwd30': (lv) => {
    lv.egg = { ...lv.egg, x: 1340 };
  },
  /* 1-2：平台右侧红鸟挪到地面（落点区间右边界从 1410 放宽到 1470） */
  'bird-ground': (lv) => {
    lv.birds[1] = { kind: 'red', x: 1560, y: 774 };
  },
  /* 1-2：平台加宽 40（左端 1210 → 1170） */
  'deck-wide': (lv) => {
    lv.blocks[2] = block('wood', 1340, 628, 300, 44);
    lv.blocks[0] = block('glass', 1220, 725, 44, 150);
  },
  /* 1-2：巢底改成铁板（hp 34，吃得住一发满速猪，不会被一撞穿底） */
  'deck-metal': (lv) => {
    lv.blocks[2] = block('metal', 1340, 628, 260, 44);
  },
  /* 1-2：石砌阳台（石柱 + 石台面） */
  'deck-stone': (lv) => {
    lv.blocks[0] = block('stone', 1240, 725, 44, 150);
    lv.blocks[1] = block('stone', 1440, 725, 44, 150);
    lv.blocks[2] = block('stone', 1340, 628, 260, 44);
  },
  /* 1-2：石柱 + 铁台面 */
  'deck-metal-stone': (lv) => {
    lv.blocks[0] = block('stone', 1240, 725, 44, 150);
    lv.blocks[1] = block('stone', 1440, 725, 44, 150);
    lv.blocks[2] = block('metal', 1340, 628, 260, 44);
  },
  /* 1-2：整座鸟巢降低 60（柱高 150→90，台面 666~710，蛋 642），弧线更容易直接落进巢 */
  'nest-low60': (lv) => {
    lv.blocks[0] = block('glass', 1240, 755, 44, 90);
    lv.blocks[1] = block('glass', 1440, 755, 44, 90);
    lv.blocks[2] = block('wood', 1340, 688, 260, 44);
    lv.blocks[3] = block('stone', 1244, 626, 44, 80);
    lv.egg = { ...lv.egg, y: 642 };
    lv.birds[1] = { kind: 'red', x: 1436, y: 640 };
  },
  /* 1-2：整座鸟巢往前挪 80（更近，角度容错更大） */
  'nest-near80': (lv) => {
    lv.blocks[0] = block('glass', 1160, 725, 44, 150);
    lv.blocks[1] = block('glass', 1360, 725, 44, 150);
    lv.blocks[2] = block('wood', 1260, 628, 260, 44);
    lv.blocks[3] = block('stone', 1164, 566, 44, 80);
    lv.egg = { ...lv.egg, x: 1290 };
    lv.birds[1] = { kind: 'red', x: 1356, y: 580 };
  },
  /* 1-2：蛋的判定/视觉半径 24 → 30 */
  'egg-big': (lv) => {
    lv.egg = { ...lv.egg, r: 30 };
  },
  /* 1-2：巢低 60 + 蛋加大 */
  'nest-low60-big': (lv) => {
    lv.blocks[0] = block('glass', 1240, 755, 44, 90);
    lv.blocks[1] = block('glass', 1440, 755, 44, 90);
    lv.blocks[2] = block('wood', 1340, 688, 260, 44);
    lv.blocks[3] = block('stone', 1244, 626, 44, 80);
    lv.egg = { ...lv.egg, y: 642, r: 30 };
    lv.birds[1] = { kind: 'red', x: 1436, y: 640 };
  },
  /* 1-2：低巢 + 石柱石台面 */
  'low60-stone': (lv) => {
    lv.blocks[0] = block('stone', 1240, 755, 44, 90);
    lv.blocks[1] = block('stone', 1440, 755, 44, 90);
    lv.blocks[2] = block('stone', 1340, 688, 260, 44);
    lv.blocks[3] = block('stone', 1244, 626, 44, 80);
    lv.egg = { ...lv.egg, y: 642 };
    lv.birds[1] = { kind: 'red', x: 1436, y: 640 };
  },
  /* 1-2：低巢 + 石柱铁台面 */
  'low60-metal': (lv) => {
    lv.blocks[0] = block('stone', 1240, 755, 44, 90);
    lv.blocks[1] = block('stone', 1440, 755, 44, 90);
    lv.blocks[2] = block('metal', 1340, 688, 260, 44);
    lv.blocks[3] = block('stone', 1244, 626, 44, 80);
    lv.egg = { ...lv.egg, y: 642 };
    lv.birds[1] = { kind: 'red', x: 1436, y: 640 };
  },
  /* 1-2：低巢 + 台面加宽到 340 */
  'low60-wide': (lv) => {
    lv.blocks[0] = block('glass', 1240, 755, 44, 90);
    lv.blocks[1] = block('glass', 1440, 755, 44, 90);
    lv.blocks[2] = block('wood', 1340, 688, 340, 44);
    lv.blocks[3] = block('stone', 1244, 626, 44, 80);
    lv.egg = { ...lv.egg, y: 642 };
    lv.birds[1] = { kind: 'red', x: 1516, y: 640 };
  },
  /* 1-6：整座巢降低 60（柱 150→90，台面 666~710，蛋 642，右侧冰砖随台面下移） */
  'low60': (lv) => {
    lv.blocks[0] = block('glass', 1260, 755, 44, 90);
    lv.blocks[1] = block('glass', 1460, 755, 44, 90);
    lv.blocks[2] = block('wood', 1360, 688, 300, 44);
    lv.blocks[3] = block('glass', 1420, 606, 40, 120);
    lv.egg = { ...lv.egg, y: 642 };
    lv.birds[0] = { kind: 'red', x: 1250, y: 640 };
  },
  /* 1-6：低巢 + 台面换石头 */
  'low60-stone6': (lv) => {
    lv.blocks[0] = block('stone', 1260, 755, 44, 90);
    lv.blocks[1] = block('stone', 1460, 755, 44, 90);
    lv.blocks[2] = block('stone', 1360, 688, 300, 44);
    lv.blocks[3] = block('glass', 1420, 606, 40, 120);
    lv.egg = { ...lv.egg, y: 642 };
    lv.birds[0] = { kind: 'red', x: 1250, y: 640 };
  },
  /* 1-6：只把台面换成石头（高度不变） */
  'deck-stone6': (lv) => {
    lv.blocks[2] = block('stone', 1360, 628, 300, 44);
  },
  /* 1-6：台面往左加宽到 360（前缘 1150，低空接近时会被前沿"托"一下） */
  'deck-left-wide': (lv) => {
    lv.blocks[2] = block('wood', 1330, 628, 360, 44);
  },
  /* 1-6：蛋往左挪到 1330（离前缘更近，落点区间右边界不动） */
  'egg-1330': (lv) => {
    lv.egg = { ...lv.egg, x: 1330 };
  },
  /* 1-6：右侧冰砖挪到最右端（落点区间从 1400 放宽到 1502） */
  'brick-right': (lv) => {
    lv.blocks[3] = block('glass', 1470, 546, 40, 120);
  },
  /* 1-6：台面左宽 + 冰砖右移 */
  'wide-brick': (lv) => {
    lv.blocks[2] = block('wood', 1330, 628, 360, 44);
    lv.blocks[3] = block('glass', 1470, 546, 40, 120);
  },
  /* 1-6：低巢 60 + 冰砖右移 + 红鸟右端（h2 + 低 60） */
  'h3': (lv) => {
    lv.blocks[0] = block('glass', 1260, 755, 44, 90);
    lv.blocks[1] = block('glass', 1460, 755, 44, 90);
    lv.blocks[2] = block('wood', 1360, 688, 300, 44);
    lv.blocks[3] = block('glass', 1470, 606, 40, 120);
    lv.egg = { ...lv.egg, y: 642 };
    lv.birds[0] = { kind: 'red', x: 1480, y: 640 };
  },
  /* 1-6：只把红鸟从巢口挪到台面最右端（原本悬空 20px，还正好堵住左翼进场） */
  'h1': (lv) => {
    lv.birds[0] = { kind: 'red', x: 1480, y: 580 };
  },
  /* 1-6：红鸟挪右端 + 冰砖右移，形成「左进右守」 */
  'h2': (lv) => {
    lv.birds[0] = { kind: 'red', x: 1480, y: 580 };
    lv.blocks[3] = block('glass', 1470, 546, 40, 120);
  },
  /* 1-6：低巢 60 + 冰砖右移 + 红鸟站台面右端（把进场左翼让出来） */
  'g1': (lv) => {
    lv.blocks[0] = block('glass', 1260, 755, 44, 90);
    lv.blocks[1] = block('glass', 1460, 755, 44, 90);
    lv.blocks[2] = block('wood', 1360, 688, 300, 44);
    lv.blocks[3] = block('glass', 1470, 606, 40, 120);
    lv.egg = { ...lv.egg, x: 1330, y: 642 };
    lv.birds[0] = { kind: 'red', x: 1410, y: 640 };
  },
  /* 1-6：g1 但蛋留在 1360 */
  'g2': (lv) => {
    lv.blocks[0] = block('glass', 1260, 755, 44, 90);
    lv.blocks[1] = block('glass', 1460, 755, 44, 90);
    lv.blocks[2] = block('wood', 1360, 688, 300, 44);
    lv.blocks[3] = block('glass', 1470, 606, 40, 120);
    lv.egg = { ...lv.egg, y: 642 };
    lv.birds[0] = { kind: 'red', x: 1410, y: 640 };
  },
  /* 1-6：f1 基础 + 红鸟站到台面右端（左翼让开，但仍可被打中） */
  'f4': (lv) => {
    lv.blocks[0] = block('glass', 1260, 775, 44, 50);
    lv.blocks[1] = block('glass', 1460, 775, 44, 50);
    lv.blocks[2] = block('wood', 1360, 728, 300, 44);
    lv.blocks[3] = block('glass', 1470, 646, 40, 120);
    lv.egg = { ...lv.egg, x: 1330, y: 682 };
    lv.birds[0] = { kind: 'red', x: 1420, y: 724 };
  },
  /* 1-6：f2 但蛋留在 1360 */
  'f5': (lv) => {
    lv.blocks[0] = block('glass', 1260, 775, 44, 50);
    lv.blocks[1] = block('glass', 1460, 775, 44, 50);
    lv.blocks[2] = block('wood', 1360, 728, 300, 44);
    lv.blocks[3] = block('glass', 1470, 646, 40, 120);
    lv.egg = { ...lv.egg, y: 682 };
    lv.birds[0] = { kind: 'red', x: 1150, y: 774 };
  },
  /* 1-2：低巢 60 + 只换台面（玻璃柱保留，仍可被撞塌） */
  'low60-deckstone': (lv) => {
    lv.blocks[0] = block('glass', 1240, 755, 44, 90);
    lv.blocks[1] = block('glass', 1440, 755, 44, 90);
    lv.blocks[2] = block('stone', 1340, 688, 260, 44);
    lv.blocks[3] = block('stone', 1244, 626, 44, 80);
    lv.egg = { ...lv.egg, y: 642 };
    lv.birds[1] = { kind: 'red', x: 1436, y: 640 };
  },
  /* 1-2：现方案 + 石台面加宽到 320（多留一点落脚/滚行面） */
  'a-deck320': (lv) => {
    lv.blocks[0] = block('glass', 1240, 755, 44, 90);
    lv.blocks[1] = block('glass', 1440, 755, 44, 90);
    lv.blocks[2] = block('stone', 1340, 688, 320, 44);
    lv.blocks[3] = block('stone', 1244, 626, 44, 80);
    lv.egg = { ...lv.egg, y: 642 };
    lv.birds[1] = { kind: 'red', x: 1436, y: 640 };
  },
  /* 1-2：现方案 + 石台面左移加宽（1190-1510，左前缘更早接住落点） */
  'a-deck-wide-left': (lv) => {
    lv.blocks[0] = block('glass', 1240, 755, 44, 90);
    lv.blocks[1] = block('glass', 1440, 755, 44, 90);
    lv.blocks[2] = block('stone', 1320, 688, 320, 44);
    lv.blocks[3] = block('stone', 1244, 626, 44, 80);
    lv.egg = { ...lv.egg, y: 642 };
    lv.birds[1] = { kind: 'red', x: 1416, y: 640 };
  },
  /* 1-6：低巢 100 + 冰砖右移 + 蛋 1330 */
  'f1': (lv) => {
    lv.blocks[0] = block('glass', 1260, 775, 44, 50);
    lv.blocks[1] = block('glass', 1460, 775, 44, 50);
    lv.blocks[2] = block('wood', 1360, 728, 300, 44);
    lv.blocks[3] = block('glass', 1470, 646, 40, 120);
    lv.egg = { ...lv.egg, x: 1330, y: 682 };
    lv.birds[0] = { kind: 'red', x: 1250, y: 724 };
  },
  /* 1-6：f1 + 红鸟挪到地面 */
  'f2': (lv) => {
    lv.blocks[0] = block('glass', 1260, 775, 44, 50);
    lv.blocks[1] = block('glass', 1460, 775, 44, 50);
    lv.blocks[2] = block('wood', 1360, 728, 300, 44);
    lv.blocks[3] = block('glass', 1470, 646, 40, 120);
    lv.egg = { ...lv.egg, x: 1330, y: 682 };
    lv.birds[0] = { kind: 'red', x: 1150, y: 774 };
  },
  /* 1-6：f2 + 蓝鸟轨道抬高 */
  'f3': (lv) => {
    lv.blocks[0] = block('glass', 1260, 775, 44, 50);
    lv.blocks[1] = block('glass', 1460, 775, 44, 50);
    lv.blocks[2] = block('wood', 1360, 728, 300, 44);
    lv.blocks[3] = block('glass', 1470, 646, 40, 120);
    lv.egg = { ...lv.egg, x: 1330, y: 682 };
    lv.birds = [
      { kind: 'red', x: 1150, y: 774 },
      { kind: 'blue', cx: 1180, cy: 400, rx: 110, ry: 50, speed: 1.4 },
    ];
  },
  /* 1-10：蓝鸟轨道降到「猪翻墙落进来」的高度（y 454~546，不与围墙重叠） */
  'e5': (lv) => {
    const i = lv.birds.findIndex((b) => b.kind === 'blue');
    lv.birds[i] = { ...lv.birds[i], cy: 500, ry: 46 };
  },
  /* 1-10：门柱 + 蓝鸟降到 500 */
  'e6': (lv) => {
    lv.blocks.push(block('stone', 1300, 726, 44, 148));
    const i = lv.birds.findIndex((b) => b.kind === 'blue');
    lv.birds[i] = { ...lv.birds[i], cy: 500, ry: 46 };
  },
  /* 1-10：门厅矮路障（800-700）+ 蓝鸟降到 500 */
  'g1': (lv) => {
    lv.blocks.push(block('stone', 1300, 750, 44, 100));
    const i = lv.birds.findIndex((b) => b.kind === 'blue');
    lv.birds[i] = { ...lv.birds[i], cy: 500, ry: 46 };
  },
  /* 1-10：门厅承重柱（贴住一层顶 800-640）+ 蓝鸟降到 500 */
  'g2': (lv) => {
    lv.blocks.push(block('stone', 1300, 720, 44, 160));
    const i = lv.birds.findIndex((b) => b.kind === 'blue');
    lv.birds[i] = { ...lv.birds[i], cy: 500, ry: 46 };
  },
  /* 1-10：门柱 + 蓝鸟压低 */
  'e1': (lv) => {
    lv.blocks.push(block('stone', 1300, 726, 44, 148));
    const i = lv.birds.findIndex((b) => b.kind === 'blue');
    lv.birds[i] = { ...lv.birds[i], cy: 700, ry: 46 };
  },
  /* 1-10：门柱 + 蛋更深 */
  'e2': (lv) => {
    lv.blocks.push(block('stone', 1300, 726, 44, 148));
    lv.egg = { ...lv.egg, x: 1450 };
  },
  /* 1-10：门柱 + 蓝鸟压低 + 蛋更深 */
  'e3': (lv) => {
    lv.blocks.push(block('stone', 1300, 726, 44, 148));
    lv.egg = { ...lv.egg, x: 1450 };
    const i = lv.birds.findIndex((b) => b.kind === 'blue');
    lv.birds[i] = { ...lv.birds[i], cy: 700, ry: 46 };
  },
  /* 1-10：门柱挪到 1330 + 蓝鸟压低 */
  'e4': (lv) => {
    lv.blocks.push(block('stone', 1330, 726, 44, 148));
    const i = lv.birds.findIndex((b) => b.kind === 'blue');
    lv.birds[i] = { ...lv.birds[i], cy: 700, ry: 46 };
  },
  /* 1-6：在 c3 基础上把红鸟挪到地面、蓝鸟轨道抬高（让出进场通道） */
  'c3-bird': (lv) => {
    lv.blocks[0] = block('stone', 1260, 755, 44, 90);
    lv.blocks[1] = block('stone', 1460, 755, 44, 90);
    lv.blocks[2] = block('stone', 1360, 688, 300, 44);
    lv.blocks[3] = block('glass', 1470, 606, 40, 120);
    lv.egg = { ...lv.egg, x: 1300, y: 642 };
    lv.birds = [
      { kind: 'red', x: 1150, y: 774 },
      { kind: 'blue', cx: 1180, cy: 400, rx: 110, ry: 50, speed: 1.4 },
    ];
  },
  /* 1-6：只在原布局上把红鸟挪到地面（验证鸟是不是主因） */
  'bird-off': (lv) => {
    lv.birds = [
      { kind: 'red', x: 1150, y: 774 },
      { kind: 'blue', cx: 1180, cy: 420, rx: 110, ry: 50, speed: 1.4 },
    ];
  },
  /* 1-6：低巢（60）+ 石台面 + 冰砖右移到 1470 + 蛋挪到 1330 */
  'c1': (lv) => {
    lv.blocks[0] = block('stone', 1260, 755, 44, 90);
    lv.blocks[1] = block('stone', 1460, 755, 44, 90);
    lv.blocks[2] = block('stone', 1360, 688, 300, 44);
    lv.blocks[3] = block('glass', 1470, 606, 40, 120);
    lv.egg = { ...lv.egg, x: 1330, y: 642 };
    lv.birds[0] = { kind: 'red', x: 1250, y: 640 };
  },
  /* 1-6：低巢（60）+ 石台面 + 冰砖右移 + 蛋 1360（不动 x） */
  'c2': (lv) => {
    lv.blocks[0] = block('stone', 1260, 755, 44, 90);
    lv.blocks[1] = block('stone', 1460, 755, 44, 90);
    lv.blocks[2] = block('stone', 1360, 688, 300, 44);
    lv.blocks[3] = block('glass', 1470, 606, 40, 120);
    lv.egg = { ...lv.egg, y: 642 };
    lv.birds[0] = { kind: 'red', x: 1250, y: 640 };
  },
  /* 1-6：低巢（60）+ 石台面 + 冰砖右移 + 蛋 1300 */
  'c3': (lv) => {
    lv.blocks[0] = block('stone', 1260, 755, 44, 90);
    lv.blocks[1] = block('stone', 1460, 755, 44, 90);
    lv.blocks[2] = block('stone', 1360, 688, 300, 44);
    lv.blocks[3] = block('glass', 1470, 606, 40, 120);
    lv.egg = { ...lv.egg, x: 1300, y: 642 };
    lv.birds[0] = { kind: 'red', x: 1250, y: 640 };
  },
  /* 1-6：整座巢降低 100（柱 150→50，台面 706~750，蛋 682，冰砖随台面下移） */
  'low100': (lv) => {
    lv.blocks[0] = block('glass', 1260, 775, 44, 50);
    lv.blocks[1] = block('glass', 1460, 775, 44, 50);
    lv.blocks[2] = block('wood', 1360, 728, 300, 44);
    lv.blocks[3] = block('glass', 1420, 646, 40, 120);
    lv.egg = { ...lv.egg, y: 682 };
    lv.birds[0] = { kind: 'red', x: 1250, y: 724 };
  },
  /* 1-6：整座巢降低 120（柱 150→30，台面 726~770，蛋 702） */
  'low120': (lv) => {
    lv.blocks[0] = block('glass', 1260, 785, 44, 30);
    lv.blocks[1] = block('glass', 1460, 785, 44, 30);
    lv.blocks[2] = block('wood', 1360, 748, 300, 44);
    lv.blocks[3] = block('glass', 1420, 666, 40, 120);
    lv.egg = { ...lv.egg, y: 702 };
    lv.birds[0] = { kind: 'red', x: 1250, y: 744 };
  },
  /* 1-6：低 100 + 石台面石柱 */
  'low100-stone': (lv) => {
    lv.blocks[0] = block('stone', 1260, 775, 44, 50);
    lv.blocks[1] = block('stone', 1460, 775, 44, 50);
    lv.blocks[2] = block('stone', 1360, 728, 300, 44);
    lv.blocks[3] = block('glass', 1420, 646, 40, 120);
    lv.egg = { ...lv.egg, y: 682 };
    lv.birds[0] = { kind: 'red', x: 1250, y: 724 };
  },
  /* 1-6：蛋挪到 1300（落在「越过前缘后自然下落」的位置） */
  'egg1300': (lv) => {
    lv.egg = { ...lv.egg, x: 1300 };
  },
  /* 1-6：蛋 1300 + 冰砖右移到 1470（右翼不再挡进场通道） */
  'egg1300-brick1470': (lv) => {
    lv.egg = { ...lv.egg, x: 1300 };
    lv.blocks[3] = block('glass', 1470, 546, 40, 120);
  },
  /* 1-6：蛋 1280 + 台面缩到 260（1210~1470），落点区间集中在蛋附近 */
  'egg1280-deck260': (lv) => {
    lv.egg = { ...lv.egg, x: 1280 };
    lv.blocks[2] = block('wood', 1340, 628, 260, 44);
    lv.blocks[3] = block('glass', 1460, 546, 40, 120);
  },
  /* 1-6：蛋半径 24 → 32（判定同式，只是目标更大更好进） */
  'egg32': (lv) => {
    lv.egg = { ...lv.egg, r: 32 };
  },
  /* 1-6：蛋半径 24 → 38 */
  'egg38': (lv) => {
    lv.egg = { ...lv.egg, r: 38 };
  },
  /* 1-6：蛋左挪 20px */
  'egg-left20': (lv) => {
    lv.egg = { ...lv.egg, x: 1340 };
  },
  /* 1-6：右侧冰砖抬高（下沿 486，落点区间右边界 1502） */
  'brick-up': (lv) => {
    lv.blocks[3] = block('glass', 1420, 486, 40, 120);
  },
  /* 1-6：平台加宽 40（左端 1210 → 1170） */
  'deck-wide6': (lv) => {
    lv.blocks[2] = block('wood', 1340, 628, 340, 44);
    lv.blocks[0] = block('glass', 1210, 725, 44, 150);
  },
  /* 1-6：巢边红鸟挪到左柱顶，给落点让位 */
  'bird-left6': (lv) => {
    lv.birds[0] = { kind: 'red', x: 1260, y: 624 };
  },
  /* 1-10：守卫蓝鸟轨道压低 */
  'blue-low': (lv) => {
    const i = lv.birds.findIndex((b) => b.kind === 'blue');
    if (i >= 0) lv.birds[i] = { ...lv.birds[i], cy: 700, ry: 46 };
  },
  /* 1-10：蛋往后挪到更深的堡内 */
  'egg-deep': (lv) => {
    lv.egg = { ...lv.egg, x: 1450 };
  },
  /* 1-10：左侧石墙加高一块 */
  'wall-tall': (lv) => {
    lv.blocks.push(block('stone', 1140, 646, 44, 44));
  },
  /* 1-10：墙后补一根石柱压住通道 */
  'gate-stone': (lv) => {
    lv.blocks.push(block('stone', 1300, 726, 44, 148));
  },
};

const { LEVELS, PIG_INFO } = await loadGame();
void PIG_INFO;
const levelId = arg('level', '1-2');
const source = LEVELS.find((l) => l.id === levelId);
const names = arg('variant', 'base').split(',');
const results = [];

for (const name of names) {
  const mutate = VARIANTS[name];
  if (!mutate) throw new Error(`没有这个变体：${name}`);
  const lv = structuredClone(source);
  mutate(lv);

  const points = [];
  for (let pigIndex = 0; pigIndex < lv.pigs.length; pigIndex += 1) {
    const isActive = ACTIVE.has(lv.pigs[pigIndex]);
    for (const angleDeg of angles) {
      for (const pull of pulls) {
        points.push({ angleDeg, pull, pigIndex });
        if (isActive) for (const skillAtStep of SKILL_STEPS) points.push({ angleDeg, pull, pigIndex, skillAtStep });
      }
    }
  }

  let reached = 0;
  let stable = 0;
  let star3 = 0;
  for (const point of points) {
    let wins = 0;
    let minStars = 9;
    let best = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      seedRandom(seed);
      // eslint-disable-next-line no-await-in-loop
      const run = await createRunFromLevel(structuredClone(lv));
      const res = shoot(run, point);
      run.eng.destroy();
      if (res.win) {
        wins += 1;
        minStars = Math.min(minStars, res.win.stars);
        best = Math.max(best, res.win.score);
      }
    }
    if (wins > 0) reached += 1;
    if (wins === SEEDS) {
      stable += 1;
      if (minStars >= 3) star3 += 1;
    }
    void best;
  }
  const pct = (n) => Math.round((n / points.length) * 1000) / 10;
  results.push({ name, points: points.length, reached, stable, star3, reachRate: pct(reached), star3Rate: pct(star3) });
  console.log(
    `${levelId} [${name}] 撒点 ${points.length} · 能通 ${reached}(${pct(reached)}%) · 稳定 ${stable}(${pct(stable)}%) · 3★ ${star3}(${pct(star3)}%)`,
  );
}

const base = results.find((r) => r.name === 'base');
if (base && results.length > 1) {
  for (const r of results.filter((x) => x.name !== 'base')) {
    console.log(
      `  Δ${r.name}: 能通 ${(r.reachRate - base.reachRate).toFixed(1)}pt · 3★ ${(r.star3Rate - base.star3Rate).toFixed(1)}pt`,
    );
  }
}
restoreRandom();
