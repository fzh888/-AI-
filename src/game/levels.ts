import type { BlockDef, LevelDef, SpringDef, WheelDef } from './types';

export const WORLD_WIDTH = 2000;
export const WORLD_HEIGHT = 900;
export const GROUND_Y = 800;
export const PIG_RADIUS = 26;
/**
 * 最大拉伸距离（世界坐标 px）。
 * 投石车改成贴地摆放后发射点低了 243，同样的力度够不着远处的屋顶，
 * 所以把拉杆加长到 150（最高速度 150*0.23≈34.5），射程与弧顶都回到原来的手感。
 */
export const MAX_PULL = 150;
export const LAUNCH_FACTOR = 0.23;

/**
 * 投石车关卡的发射点：抛兜贴地，只比地面高 (216-177)*1.45 ≈ 57。
 * 大炮另有炮台垫高，所以 1-5 单独用自己的发射点。
 */
const GROUND_LAUNCH = { x: 300, y: 743 };
const CANNON_LAUNCH = { x: 300, y: 500 };

const wood = (x: number, y: number, w: number, h: number): BlockDef => ({ x, y, w, h, mat: 'wood' });
const glass = (x: number, y: number, w: number, h: number): BlockDef => ({
  x,
  y,
  w,
  h,
  mat: 'glass',
});
const stone = (x: number, y: number, w: number, h: number): BlockDef => ({ x, y, w, h, mat: 'stone' });
const metal = (x: number, y: number, w: number, h: number): BlockDef => ({ x, y, w, h, mat: 'metal' });
/** 炸药箱：木头箱，打碎时原地爆炸 */
const tnt = (x: number, y: number, s: number): BlockDef => ({
  x,
  y,
  w: s,
  h: s,
  mat: 'wood',
  tnt: true,
});
const wheel = (x: number, y: number, r: number): WheelDef => ({ x, y, r });
/**
 * 弹簧板：钉在地上的弹射机关，按 `GROUND_Y` 自动贴地。
 * `angle` 是板面倾角（0 = 平放），`power` 是弹射力度倍率（缺省 1）。
 */
/**
 * 弹簧板助手。y 省略 = 直接坐在草皮上；给 y 就变成架在立柱上的弹射台（板上表面 = y - h/2）。
 * power 是弹射力度倍率，用来按关卡难度微调。
 */
const spring = (x: number, w = 120, power = 1, angle = 0, y = GROUND_Y - 12): SpringDef => ({
  x,
  y,
  w,
  h: 26,
  angle,
  power,
});

export const LEVELS: LevelDef[] = [
  {
    id: '1-1',
    index: 0,
    name: '第一次出手',
    hint: '按住画面往左下拖，虚线是前段轨迹，松手让投石车把猪甩出去。拿到中间的鸟蛋就过关。',
    pigs: ['normal', 'prof', 'chef'],
    launchPoint: GROUND_LAUNCH,
    egg: { x: 1350, y: 776, r: 26 },
    blocks: [glass(1250, 725, 44, 150), glass(1450, 725, 44, 150), wood(1350, 628, 300, 44)],
    birds: [{ kind: 'red', x: 1350, y: 578 }],
    wheels: [wheel(690, 768, 32)],
  },
  {
    id: '1-2',
    index: 1,
    name: '屋顶鸟巢',
    hint: '鸟蛋搬到石台上了。冰玻璃柱一撞就碎，石台硬得多——把猪抛上屋顶，让它滚进巢里，别正面硬砸台面。',
    pigs: ['normal', 'helmet', 'prof'],
    launchPoint: GROUND_LAUNCH,
    egg: { x: 1370, y: 642, r: 24 },
    blocks: [
      glass(1240, 755, 44, 90),
      glass(1440, 755, 44, 90),
      stone(1340, 688, 260, 44),
      stone(1244, 626, 44, 80),
    ],
    birds: [
      { kind: 'red', x: 1130, y: 774 },
      { kind: 'red', x: 1436, y: 640 },
    ],
    wheels: [wheel(620, 770, 30), wheel(720, 766, 34)],
  },
  {
    id: '1-3',
    index: 2,
    name: '黄鸟拦截',
    hint: '黄鸟会横着冲刺，撞上就被弹回来。趁它飞远再出手；射低了也别急，门前那块弹簧板会把猪弹起来。',
    pigs: ['chef', 'normal', 'helmet'],
    launchPoint: GROUND_LAUNCH,
    egg: { x: 1400, y: 776, r: 26 },
    blocks: [
      glass(1300, 725, 44, 150),
      glass(1500, 725, 44, 150),
      wood(1400, 628, 260, 44),
      // 门前堆着的炸药箱：打爆它整间房子都会散架
      tnt(1180, 772, 56),
    ],
    birds: [
      { kind: 'red', x: 1400, y: 570 },
      { kind: 'yellow', x: 1010, y: 640, dashToX: 540, dashToY: 640, restTime: 1.4, dashTime: 0.7 },
    ],
    wheels: [wheel(760, 770, 28)],
    // 门前一块弹簧板：把射低的猪弹起来，照样能砸到屋顶
    springs: [spring(980)],
  },
  {
    id: '1-4',
    index: 3,
    name: '蓝鸟编队',
    hint: '石墙硬得很，普通猪正面撞不开。顶上那个炸药箱炸开就省事多了。',
    pigs: ['prof', 'spy', 'helmet'],
    launchPoint: GROUND_LAUNCH,
    egg: { x: 1350, y: 776, r: 26 },
    blocks: [
      stone(1200, 700, 44, 200),
      stone(1500, 700, 44, 200),
      stone(1350, 578, 344, 44),
      glass(1290, 534, 90, 44),
      tnt(1450, 528, 56),
    ],
    birds: [
      { kind: 'red', x: 1010, y: 774 },
      { kind: 'red', x: 1350, y: 486 },
      { kind: 'blue', cx: 1020, cy: 560, rx: 110, ry: 60, speed: 1.1 },
    ],
  },
  {
    id: '1-5',
    index: 4,
    name: '三重防线',
    hint: '这一关换上了大炮：瞄准照样靠拖拽，松手就轰出去。顶棚是铁板，得从侧面掏进去。',
    pigs: ['king', 'chef', 'spy'],
    launcher: 'cannon',
    launchPoint: CANNON_LAUNCH,
    egg: { x: 1350, y: 776, r: 26 },
    blocks: [
      stone(1220, 720, 44, 160),
      stone(1480, 720, 44, 160),
      wood(1350, 618, 300, 44),
      stone(1250, 566, 40, 60),
      stone(1450, 566, 40, 60),
      wood(1350, 514, 280, 44),
      stone(1300, 462, 44, 60),
      stone(1400, 462, 44, 60),
      metal(1350, 410, 240, 44),
      tnt(1150, 772, 60),
    ],
    birds: [
      { kind: 'red', x: 1620, y: 774 },
      { kind: 'yellow', x: 1620, y: 340, dashToX: 1100, dashToY: 340, restTime: 1.2, dashTime: 0.6 },
      { kind: 'blue', cx: 1020, cy: 620, rx: 130, ry: 55, speed: 1.3 },
    ],
    wheels: [wheel(560, 768, 32), wheel(660, 764, 36), wheel(1580, 770, 30)],
  },
  {
    id: '1-6',
    index: 5,
    name: '玻璃塔',
    hint: '整座塔都是冰玻璃，一碰就碎。蛋架在二层敞口的巢里，抛物线压低一点，直接把猪扔进去；台面右端停着一只红鸟，滚过去能顺带撞飞它。',
    pigs: ['normal', 'chef', 'helmet'],
    launchPoint: GROUND_LAUNCH,
    egg: { x: 1360, y: 582, r: 24 },
    blocks: [
      glass(1260, 725, 44, 150),
      glass(1460, 725, 44, 150),
      wood(1360, 628, 300, 44),
      glass(1420, 546, 40, 120),
    ],
    birds: [
      { kind: 'red', x: 1480, y: 580 },
      { kind: 'blue', cx: 1180, cy: 470, rx: 110, ry: 50, speed: 1.4 },
    ],
    wheels: [wheel(700, 768, 32), wheel(820, 770, 28)],
  },
  {
    id: '1-7',
    index: 6,
    name: '挡风墙',
    hint: '前面立起一道石墙还压着缓冲木块。要么把弧线拉到最高翻过去，要么低平射到墙前的弹簧板上借力弹高。',
    pigs: ['helmet', 'normal', 'prof'],
    launchPoint: GROUND_LAUNCH,
    egg: { x: 1380, y: 776, r: 26 },
    blocks: [
      // 挡风墙 + 墙顶缓冲木块
      stone(1080, 690, 44, 220),
      wood(1080, 558, 130, 44),
      // 主屋
      wood(1290, 720, 44, 160),
      wood(1470, 720, 44, 160),
      stone(1380, 618, 260, 44),
      wood(1380, 576, 160, 40),
    ],
    birds: [
      { kind: 'red', x: 1380, y: 530 },
      { kind: 'yellow', x: 1560, y: 500, dashToX: 1150, dashToY: 500, restTime: 1.1, dashTime: 0.55 },
    ],
    wheels: [wheel(600, 768, 34), wheel(1200, 770, 26)],
    // 高墙前的弹簧板：低平弹道落在板上会被弹高，从上方越过去
    springs: [spring(936, 148, 1.15, 0, 750)],
  },
  {
    id: '1-8',
    index: 7,
    name: '三层鸟巢',
    hint: '三层塔，一层里藏着一箱炸药。先点炸它把塔腿掀断，再补一发落进二层偷蛋。',
    pigs: ['prof', 'normal', 'chef'],
    launchPoint: GROUND_LAUNCH,
    egg: { x: 1360, y: 552, r: 24 },
    blocks: [
      stone(1230, 710, 44, 180),
      stone(1490, 710, 44, 180),
      wood(1360, 598, 320, 44),
      tnt(1360, 770, 60),
      glass(1280, 511, 40, 130),
      glass(1440, 511, 40, 130),
      wood(1360, 424, 300, 44),
      glass(1360, 382, 220, 40),
    ],
    birds: [
      { kind: 'red', x: 1150, y: 774 },
      { kind: 'red', x: 1360, y: 336 },
      { kind: 'blue', cx: 1060, cy: 520, rx: 100, ry: 70, speed: 1.2 },
    ],
    wheels: [wheel(680, 770, 30), wheel(1560, 768, 32)],
  },
  {
    id: '1-9',
    index: 8,
    name: '窄缝守卫',
    hint: '上边铁板封顶，只剩一道贴地的矮门。贴地平射打进去，别把力气都拉满。',
    pigs: ['spy', 'chef', 'normal'],
    launchPoint: GROUND_LAUNCH,
    egg: { x: 1370, y: 776, r: 26 },
    blocks: [
      // 左右两堵落地石墙（顶面 562 齐平，用来架铁顶棚）
      stone(1210, 681, 44, 238),
      stone(1500, 681, 44, 238),
      // 铁顶棚：架在两墙顶面，压住整条通道
      metal(1360, 542, 340, 40),
      // 铁顶棚下立两块冰玻璃当门槛：贴着地面把通道掐成一道矮缝
      glass(1290, 745, 36, 110),
      glass(1440, 745, 36, 110),
    ],
    birds: [
      { kind: 'red', x: 1370, y: 496 },
      { kind: 'yellow', x: 1080, y: 700, dashToX: 620, dashToY: 700, restTime: 1.0, dashTime: 0.5 },
      { kind: 'blue', cx: 1250, cy: 330, rx: 130, ry: 55, speed: 1.5 },
    ],
    wheels: [wheel(760, 770, 30)],
  },
  {
    id: '1-10',
    index: 9,
    name: '鸟巢堡垒',
    hint: '鸟村最后一道防线：外墙、立柱、门口石障、铁顶、两只炸药箱。先用炸药撕开外墙，再补一发进去。',
    pigs: ['king', 'prof', 'chef'],
    launcher: 'cannon',
    launchPoint: CANNON_LAUNCH,
    egg: { x: 1400, y: 776, r: 26 },
    blocks: [
      // 外墙 + 门前炸药
      stone(1140, 700, 44, 200),
      tnt(1060, 772, 60),
      // 主楼立柱
      wood(1240, 720, 44, 160),
      wood(1560, 720, 44, 160),
      // 门厅石障：低平射进不来，得先掀外墙或抬高弧线
      stone(1300, 750, 44, 100),
      // 一层顶
      wood(1400, 618, 380, 44),
      tnt(1400, 568, 56),
      // 二层
      glass(1300, 531, 40, 130),
      glass(1500, 531, 40, 130),
      wood(1400, 444, 340, 44),
      // 铁顶
      metal(1400, 402, 260, 40),
    ],
    birds: [
      { kind: 'red', x: 1620, y: 774 },
      { kind: 'red', x: 1250, y: 570 },
      { kind: 'yellow', x: 1700, y: 330, dashToX: 1180, dashToY: 330, restTime: 1.05, dashTime: 0.55 },
      { kind: 'blue', cx: 1040, cy: 500, rx: 110, ry: 46, speed: 1.35 },
    ],
    wheels: [wheel(560, 768, 32), wheel(660, 764, 36), wheel(1680, 770, 30)],
  },
];
