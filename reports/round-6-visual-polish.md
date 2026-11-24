# 第六轮：角色动画、场景表现与整体视觉升级

> 结论先行：本轮**没有**新增关卡、猪、鸟、机关，没有改核心玩法、三星规则、建筑物理参数，也没有重写 `engine.ts` / Matter 集成。
> 所有改动都落在「绘制层 + 表现层 + 设置层」，物理与判定零变化——附 A 段末尾的回归证明。
> **第三阶段（四种机关动画）按需求方指示整体跳过**：仓库里没有风扇 / 摆锤 / 绳索桥 / 旋转平台，见 C 段。

---

## A. 原有动画系统审查

### A.1 素材与帧分组实况

| 角色 | 图集 | 帧数 | 单帧尺寸 | 现有帧分组（`sprite.ts`） |
| --- | --- | --- | --- | --- |
| 普通 / 钢盔 / 国王 / 教授 / 厨师 / 间谍猪 | `public/sprites/pig/<type>.png` | 5 | 256×256 | `PIG_CLIPS.idle = [0,1,2]`（hold 420/260/260ms）、`PIG_CLIPS.fly = [3,4]`（hold 140/110ms） |
| 红鸟 / 黄鸟 / 蓝鸟 | `public/sprites/bird/<color>.png` | 6 | 256×256 | `BIRD_CLIPS.idle = [0,1,2]`、`BIRD_CLIPS.fly = [3,4,5]`（按速度 ±35% 调速） |
| 投石车 | `public/sprites/launcher/trebuchet.png` | 6 | — | 只用 `fireFrames [3,4]`，帧 1/2（抬臂/蓄力）从未使用 |
| 大炮 | `public/sprites/launcher/cannon.png` | 6 | — | `fireFrames [1,2,3,4]` |

检查结论（对应审查问题 1–4）：**六只猪各 5 帧、三种鸟各 6 帧；实际使用上，猪只有 idle/fly 两个动作，鸟也只有 idle/fly**。受击、落地、技能、胜利、失败、瞄准、发射这些状态此前**完全不存在**（不是"有帧没用"，是没有状态）。

### A.2 素材缺陷（需要重新导出，属阻塞级但已用"不靠该区域的姿态动画"绕开）

用纯 Python 解码 PNG 逐像素检查，六套猪图集（钢盔/国王/教授/间谍）与三套鸟图集的**最后一帧**右下角存在同一块污点：

- 位置：帧内 `x 210–250 / y 242–250`（宽 41px、高 9px），**被帧边界裁切**
- 颜色：纯 `#a6a6a6`，alpha ≈ 20%，共 163 个非透明像素
- `_template.png`（pig / bird 目录各一份）**每一帧**都有这块灰条

它不影响命中、不影响绘制逻辑，但放大会看到一格淡灰。本轮的处理方式是：**不把最后一帧当成主要展示帧**，且 Hit / Land / Skill / Win / Defeat 全部用姿态（旋转/缩放/位移）实现而不是硬套帧，所以这块污点在正常游玩里不会成为"角色身上一条灰"。**建议按 D 段清单干净重导。**

### A.3 动画器能力（审查问题 6–7）

- 旧 `SpriteAnimator`：支持循环 clip、逐帧 hold、按速度缩放 hold、相位偏移、100ms 交叉淡入（`SPRITE_FADE_MS`）。**不支持单次动作、不支持播放完成回调、不支持暂停**，所以"发射瞬间收缩一次"这类动作无从表达。
- 闪帧：跨 clip 切换有 100ms 交叉淡，本身不闪；但旧代码靠**两个散落的阈值**（2.2 / 0.8）在 fly ↔ idle 之间反复横跳，落地一抖就会来回切，观感上是"抽搐"而不是闪帧。
- 状态落点：全部塞在 `updatePigAnim` 一个函数里，`setState` 由外部随意调用（`onPointerUp`、`triggerSkill`、HUD 头像都用），没有"当前动作播完该回哪儿"的概念。

### A.4 其他审查结论（对应审查问题 8–12）

| 问题 | 结论 |
| --- | --- |
| 8. 机关绘制与物理一致 | 仓库只有 TNT 与弹簧板。TNT 箱体位置直接读 `body.position`，引信火星读 `fuse`；弹簧板压板形变由 `press` 驱动，触发点与 `Body.setVelocity` 同帧，二者都没有"视觉与刚体分离"的问题 |
| 9. 背景是否只有静态 | 是。`backdrop.ts` 一次性把天空/太阳/远山/草坡/阴影**以及 14 棵坡上小树**烘进 2000×1600 离屏画布，每帧只 `drawImage` 一次；唯一的动态是 7 朵视差云 |
| 10. 镜头是否跳变 | **有，而且是本轮最大的一处**：瞄准态 `fitScale = min(cssW/2000, cssH/900)`（1280×720 → 0.64），飞行态 `followScale = min(cssW/1250, cssH/760)`（→ 0.947）。旧代码在 `flyingPig` 一出现就把缩放**直接切到 followScale**，即 90ms 内视野放大约 48%，像被人猛推了一把 |
| 11. UI 是否缺动画 | 分数是死数字直接跳；连锁徽标只在**首次挂载**时播一次 `gd-star-pop`，层数涨了不重播；多个成就挤在一个横幅里用 `·` 拼串，没有排队；面板有 `gd-float-in`，失败有 `gd-panel-shake`，星级已按 180ms 逐颗点亮且只点亮已达成的星 |
| 12. 双版本差异 | React 与 standalone **共用同一个 `GameEngine`**，所以渲染/物理/镜头天然一致；差异只在 DOM 外壳：连锁重播机制不同（React 用 key 重挂载 / standalone 用 reflow 重加类），成就展示不同（React 有 `AchievementQueue` 逐条 / standalone 是拼串） |

### A.5 阻塞项与处理决定

- 第五轮报告 `reports/round-5-mechanisms.md` **不存在**（`reports/` 只有 round-4）；`mechanisms.ts` 只有 `TNT` 与 `SPRING`；`LevelDef` 只有 `springs/wheels/tnt`。全仓库检索 fan / pendulum / rope / platform 均无命中。
- 因此**第三阶段（四种机关动画）与测试 B（机关动画）无法执行**。已按需求方确认：整体跳过，不伪造机关、不做假同步、不在报告里假装做过。
- 没有发现"用视觉动画掩盖物理问题"的情况。

### A.6 物理零变化证明（回归）

改动后重跑第四轮报告 E 段的 10 关路线，**逐关数值与第四轮完全一致**（`node /tmp/r6reg.mjs`）：

```
1-1  26°/150 → 1500 3★ 连锁×2 破2
1-2  32°/150 → 1480 2★ 连锁×1 破1
1-3  50°/132 → 1500 3★ 连锁×2 破2
1-4  62°/150 → 1990 3★ 连锁×4 破4 撞鸟2
1-5  32°/132 → 2090 3★ 连锁×7 破7
1-6  56°/150 → 1450 2★ 连锁×1 破1
1-7  26°/114 → 1740 3★ 连锁×3 破3 撞鸟1
1-8  26°/150 → 1860 3★ 连锁×6 破6
1-9  20°/132 → 1530 2★ 连锁×2 破2
1-10 38°/132 → 1710 3★ 连锁×5 破5
```

真机（Playwright，真实拖拽）同样复现：React 版与 standalone 版 1-1 `26°/150` → **1500 通关**，控制台 0 error。

---

## B. 角色动画

### B.1 设计原则（对应任务书 3.1 / 9.2）

1. **不改帧分组**：`PIG_CLIPS` / `BIRD_CLIPS` 一行未动，自然就"不会把不匹配的帧强行用于其他动作"。
2. **动作 = 帧分组 + 绘制层姿态**：新增 `SpriteStateDef { clip, once, pose(p, charge, t) }`，`pose` 只产出 `PoseAdd { rot, sx, sy, ox, oy }`，由 `snapshot()` 叠到呼吸/拉伸之上，最终交给 `drawPig/drawBird`。**姿态永远不进物理**：`ox/oy` 只在绘制时平移，`rot` 只加到 `pigBody.angle` 上做显示角度。
3. **一次性动作有明确落点**：`playState(next, { after, restart })`，`once` 到时自动切 `after`；`busy` 给状态机判断"现在别抢"。
4. 将来补图集时，只要把 `PIG_STATES.hit.clip` 指到新的帧组、`once` 保留，动画立刻升级，**绘制层代码零改动**。

### B.2 九态 × 六猪

| 状态 | 帧来源 | 绘制层姿态 | 触发与回落 |
| --- | --- | --- | --- |
| Idle | `idle[0,1,2]` | 呼吸（`breath`）+ 每角色不同相位（`PIG_PHASE`：normal 0 / helmet 170 / king 330 / prof 510 / chef 690 / spy 860 ms） | 默认态 |
| Aim | `idle` | 随拉力 `charge` 增大而**压低 + 前倾**（`sy↓ / rot+`），原地不动 | `state === 'aiming'`，`charge = pullPower()` 直接读真实拖动距离 |
| Launch | `fly` | 200ms：先压扁再回弹（`sx>1, sy<1` → 1），模拟"被皮兜甩出去" | `onPointerUp` 发射后 `once:200ms → fly` |
| Fly | `fly[3,4]` | 显示角度 = `pigBody.angle`（真实刚体角）**+ 约 ±2° 的姿态摆动**；高速时 hold 变短 | 速度 > 2.2 |
| Hit | `fly` | 220ms：后仰 + 沿撞击方向位移一点（`ox/oy`） | 猪撞到东西且 `relSpeed > 6`，140ms 防抖；`after` = 当前是飞行就回 `fly`，否则 `idle` |
| Land | `idle` | 260ms：落地压扁（`sy<1, sx>1`）再恢复 | 只在"真的落地那一下"（`pigWasAirborne` 由 true 转 false），`after: idle` |
| Skill | `fly` | 320ms：蓄势（`sy↓` 后弹回） | `triggerSkill` 内部 `playState('skill', { after: 'fly' })` |
| Win | `idle` | 胜利跳动（`oy` 上下 + 轻微 `rot`） | `state === 'won'` |
| Defeat | `idle` | 低头（`sy` 压一点、`rot` 沉一点） | `state === 'lost'` |

状态机在 `updatePigAnim` 里是**四分支**（aiming / won / lost / flying），且 flying 分支里"`anim.busy` 时不抢状态"，所以 hit / land / launch / skill 不会被每帧的阈值判断打断——这正是旧版"抽搐"的根因。

### B.3 六种猪的差异

- **待机节奏**：`PIG_PHASE` 六档错开，HUD 里六只头像并排不再同步呼吸（`PigAnimator(PIG_PHASE[type])`）。
- **技能表现**（按真实技能分支，不改逻辑）：

| 猪 | 技能（原逻辑） | 本轮视觉 |
| --- | --- | --- |
| 普通 | 无技能 | 发射/飞行中点击 → `skill` 姿态 + **"哼！"气泡**（`drawOinkBubble`，480ms 上浮淡出） |
| 钢盔 | 无技能（免疫一次撞击） | 同上（气泡 + 姿态） |
| 国王 | 无技能（更重） | 同上 |
| 教授 | 空中引爆 | 320ms `skill` 姿态 + 原有火球/冲击波/烟尘 |
| 厨师 | 1.9× 冲刺 + 穿透 | `skill` 姿态 + **冲刺尾焰**（`drawPigDash`，沿真实速度反向拉 3 道锥形尾焰，`pierceUntil` 期间持续） |
| 间谍 | 2s 免疫 | `skill` 姿态 + **护盾环**（`drawPigShield`，双环 + 6 段弧光旋转，按剩余时间收缩淡出） |

护盾 / 尾焰 / 气泡都是**纯绘制**：读 `immuneUntil / pierceUntil / skillAt` 与真实速度，不写任何刚体字段。

### B.4 小鸟（三色）

- 状态：`idle` / `fly` / `hit` / `fall`。
- **朝向 = 每帧真实位移**（`face: ±1`，位移 > 0.08px 才翻面，`faceHold` 防抖）。这一点很关键：黄鸟与蓝鸟的巡逻是 `Body.setPosition` 摆位，**`body.velocity` 恒为 0**，用速度判朝向会永远朝左。实测 1-10 六只鸟 5.2s 内的朝向序列：

```
unL unL unL unR unR unL | unL unL unR unR unR unL | ... （三只巡逻鸟按轨道左右翻面，静止鸟不变）
```

- 被撞：`captureBird` 里按**击飞方向**设 `face`，`hit` 200ms → `fall`，之后 `updateBirdAnims` 直接 return（不再播巡逻），与 `Body.setStatic(false)` 的真实下坠一致——视觉位置始终来自 `body.position`。
- 渲染：`drawBird(..., face)`，`flipMul` 做镜像，`ox/oy/rot` 叠加；镜像期间沿用 100ms 交叉淡，翻面无闪跳。

---

## C. 机关视觉表现

**本轮不涉及（按需求方指示跳过）。**

事实清单：
- `src/game/mechanisms.ts` 只有 `TNT`（引信/爆炸/连带点火）与 `SPRING`（弹射力度/触发阈值）；
- `LevelDef` 只有 `springs / wheels / tnt`；
- 仓库内不存在风扇、摆锤、绳索桥、旋转平台的任何定义、绘制或物理体（检索 fan / pendulum / rope / platform 零命中）；
- 因此"风扇开关与风力同步 / 摆锤绘制与真实角度同步 / 绳索桥与实际连接点同步 / 旋转平台与刚体角度同步"这四项无对象可验。

不伪造：没有新增假机关、没有给机关画"假旋转"。现有两种机关的表现维持第四轮状态（TNT 引信闪白 + 火星、弹簧板压板形变 + 金色冲击环），它们本来就以 `body` 坐标为唯一依据。

---

## D. 背景环境

### D.1 分层（保留原布局，只补层次）

| 层 | 内容 | 绘制策略 |
| --- | --- | --- |
| 远景天空 | `SKY.top/mid/low` 渐变 + 太阳光晕 | 离屏缓存 |
| 中远景 | 两排圆头远山（`MOUNTAIN.far/near`） | 离屏缓存 |
| 中景 | 草坡三层（`HILL`）+ 坡脚阴影 + **14 棵坡上小树** | 草坡/阴影在缓存；**小树改为每帧绘制**（见 D.2） |
| 主体 | 地形（亮草皮 + 草簇 + 暖土剖面 + 碎石）、方块、角色 | 每帧矢量 |
| 前景 | 左右灌木剪影 + 长草 | 每帧矢量 |

缓存策略没变：**每帧仍然只有一次 `drawImage`**（`drawBackdrop`），新增的动态都在世界坐标里画。

### D.2 环境动态（四项，全部不进物理）

1. **树摆**：14 棵树从缓存里搬出来，`drawWindTrees(ctx, tSec, reduce)` 每帧画。风 = 两个不同频率的正弦叠加（1.05Hz 主摆 ±1.34px、0.43Hz 次摆 ±0.56px，按 `tr.phase` 错相位），**只平移树冠控制点**（`tree(..., lean)`），不换坐标系——比 `save/rotate/restore` 便宜：同一份代码实测 idle 帧时间从 1.07ms 降到 0.98ms（DPR2），而 `rotate` 版是 1.07ms。
2. **草摆**：`drawTerrain(ctx, GROUND_Y, sway)`，草簇叶尖按 `sin(sway*1.7 + i*0.55) * (1.4 + len*0.08)` 弯 ±1.4~2px；`drawForeground(..., sway)` 长草同样按相位弯 ±3px。
3. **浮尘**：`drawAmbient`，18 粒极低亮度（alpha 0.08–0.18）小圆点，位置**完全由时间 + 序号算出**（无粒子池、无状态、零分配），画在地形之前、亮度低于任何游戏元素，不干扰瞄准。
4. **云**：保留原 7 朵视差云（`drawClouds`），这是唯一"移动的大块"。

以上四项在低动态模式全部归零（树/草 `sway = 0`、浮尘密度 0），**但树和草仍然画出来**——不是"关掉动画变成空场景"。

### D.3 场景切换

新增 `gd-scene-in`（React：canvas 挂载时 220ms 淡入）/ `#game.is-in`（standalone：`startLevel` 里 reflow 重加类）。低动态模式缩短到 120ms。它只是 `opacity` 补间：不碰 `GameEngine` 生命周期，不会重复发射、不会误触发碰撞或计分，输入焦点也没变（过渡期间 `pointer` 事件照常进 canvas）。

---

## E. 镜头系统

### E.1 发射瞬间的跳变（修掉的最大问题）

旧行为：`flyingPig` 一出现 → 缩放直接 `followScale`（0.64 → 0.947，+48%）。
新行为：新增 `camFollow ∈ [0,1]`，`τ = 300ms` 一阶缓动，并且**只有猪离开锚点 >130px 才开始跟随**（`CAM_FOLLOW_AFTER`），目标点用 `clamp(pig.x, fitHalf, WORLD_WIDTH - fitHalf)` 夹住避免露出世界边缘；缩放 = `fitScale + (followScale - fitScale) * camFollow`。

效果：发射瞬间（`camFollow = 0`）**缩放与瞄准时完全一致**，视野不再被猛推；飞行中约 0.6~0.9s 内平滑完成推近；猪落地后保持跟随视野（看得清塌楼），下一只猪上膛时 `camFollow` 快速回落到 `fitScale`（τ=120ms）。

### E.2 震动分级（保持封顶）

震动唯一入口仍是 `addShake(amount)`（`SHAKE_MAX = 6.5`，衰减 `dt*0.055`）。本轮新增两处：抢蛋 `camPunch 0.85`（推近，不动震动）、失败 `0.9` 震动。原有分级不变：发射 `0.8 + power*1.5`、爆炸 `2.6 + power*2.2`、破块 `0.14 + min(0.8, w*h/16000)`、硬撞 `0.3+k*0.8`、软撞 `0.12+k*0.42`、掉屑 `0.1+harm*0.3`、弹簧 `0.35+k*0.7`、撞鸟 `0.5`。**没有出现"连续碰撞震成地震"**：`addShake` 里 `amount ≤ 0.05` 直接丢弃 + 叠加封顶。

### E.3 关键事件

- 抢蛋：`camPunch = 0.85`（260ms 回 0）+ 蛋的上浮/光晕 + 两圈白环 + 星芒（原有）+ 震动 1.2。
- 失败：一次"沉下去"的 0.9 震动，不缩放（避免玩家二次眩晕）。
- 大规模连锁：不加镜头缩放，只靠已有的 `maxChain` 飘字 + 逐级震动——刻意不堆镜头运动。

---

## F. UI 动效

### F.1 React（`GameShell.tsx`）

| 位置 | 本轮改动 |
| --- | --- |
| HUD 分数 | `useRollScore(target, instant)`：320ms 补间（先快后慢），掉分（重开）直接落位；低动态模式直接落位 |
| 连锁徽标 | `key={snapshot.chain}` 重挂载 + 新类 `.gd-chain-pop`（scale 1 → 1.24 → 1，300ms 回弹），**每涨一层重播一次**；低动态模式保留（属状态反馈） |
| 成就 | `AchievementQueue` 逐条显示（不并列、不互相覆盖），单条 `gd-float-in` |
| 星级 | 已有 `STAR_STEP_MS = 180` 逐颗；`pop && i < count` 只点亮真正拿到的星，未拿到的星不播点亮动画、不发光 |
| 面板 | 胜/负/关卡选择/说明/成就/重置都用 `gd-float-in`；失败面板 `gd-panel-shake` + `PigPortrait` 摇头 |
| 场景 | `gd-scene-in` 淡入（切关/重开） |
| 设置 | 音效旁新增「动画：标准动效 / 低动态」按钮 |

### F.2 standalone（`src/standalone/main.ts` + `main.css`）

同一套视觉，用 DOM 原生实现：

- 分数滚动：`requestAnimationFrame` 320ms 补间（`setScoreValue`），低动态直接落位；
- 连锁重播：`remove('is-pop')` → `void offsetWidth` → `add('is-pop')`（`chainChalk` 300ms）；
- 成就：多个成就拆成 `.ach-chip`，`animation-delay: i*160ms` 逐个冒出（小屏不做"逐条排队"以免逼迫滚动）；
- 场景淡入：`#game.is-in`；
- 设置：菜单出现「动画 标准 / 动画 低动态」按钮，写进 `Progress.motion`。

### F.3 一致性说明

两版本共用同一引擎与同一份 `globals.css` 主题 token（`build-standalone.mjs` 会把 `:root` 与 `@layer components` 注入 `style.css`）。差异只有两处刻意的本地化：成就展示形态（React 逐条队列 / standalone 错开 chip）、连锁重播机制（React key / standalone reflow）。

---

## G. 动画设置（标准 / 低动态）

- 存档新增字段 `Progress.motion: 'standard' | 'low'`，默认 `standard`；老存档缺字段时 `loadProgress` 自动补 `standard`（不迁移、不清档）。
- 生效路径：UI → `progress.motion` → `engine.setReduceMotion(bool)` + `document.documentElement.classList.toggle('gd-low-motion')`；standalone 完全相同（类名同源）。

| 维度 | 标准 | 低动态 |
| --- | --- | --- |
| 震动幅度 | 100% | **35%**（`addShake` 内 `×0.35`，仍保留"撞到了"的信息） |
| 发射/抢蛋推近 `camPunch` | 1 / 0.85 | **0**（完全不做推近） |
| 粒子上限（碎块/尘/火星） | 220 / 160 / 120 | **110 / 80 / 60** |
| 浮尘 | 18 粒 | **0** |
| 树摆 / 草摆 | 有 | **静止**（树与草照常绘制） |
| 分数滚动 | 320ms 补间 | **直接落位** |
| 星级弹跳 / 失败摇头 | 有 | **关闭**（星星仍然出现，只是不弹） |
| 面板/淡入 | 260ms / 220ms | **130ms / 120ms** |
| 连锁徽标、星级出现、场景淡入 | 有 | **保留**（这些是状态反馈，不是装饰） |

即"不是把所有动画关掉"：必要的状态反馈（谁拿到了什么、蛋有没有被抢走、分数变没变）在低动态模式下**全部保留**，被削掉的是持续晃动、闪光、满屏粒子和装饰性运动。

---

## H. 性能测试

### H.1 测试条件

- 环境：Linux 容器内 Chromium（Playwright，完整 chromium，`--headless=new`），**软件光栅**（`--use-gl=swiftshader`，无 GPU 加速）——所以数字是"最悲观"的 JS 侧成本。
- 画布：CSS 1280×720（容器 1300×760），DPR 1 与 DPR 2（真实像素 2600×1520 后备缓冲）。
- 采样：包装 `GameEngine.loop`，`performance.now()` 记每次 `loop` 的耗时；同时记录粒子峰值与破块数。
- 关卡：1-10（最复杂：10 个方块 + TNT ×2 + 铁/石/木混合 + 6 只鸟），三连爆炸等效 TNT 连锁峰值。

### H.2 结果（本轮，最终代码）

| 场景 | DPR | 帧数 | 平均 | P95 | P99 | 最大 | >16.7ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 瞄准待机（云 + 树摆 + 草摆 + 18 粒浮尘 + 待机呼吸） | 2 | 75 | **0.88ms** | 1.10 | 1.20 | 1.20 | 0 |
| 瞄准待机 | 1 | 203 | **0.60ms** | 0.80 | 0.90 | 0.90 | 0 |
| 飞行 + 坍塌（含镜头缓动、拖尾、破块与碎片） | 2 | 81 | **1.06ms** | 1.40 | 2.70 | 2.70 | 0 |
| 飞行 + 坍塌 | 1 | 229 | **0.63ms** | 0.80 | 1.20 | 2.20 | 0 |
| 三连爆炸（11 块全碎、连锁 ×11） | 2 | 99–111 | **1.05–1.28ms** | 2.30–2.80 | 2.90–3.20 | 13.2–15.8 | **0（3/3 次）** |
| 三连爆炸 | 1 | 255 | **0.86ms** | 2.20 | 2.50 | 16.20 | 0 |

- 粒子峰值（DPR2 爆炸）：shards 82/220、puffs 88/160、sparks 30/120、rings 5、blasts 3–4、flashes 11、texts 9。
- 与第四轮对比：DPR2 三连爆炸 均 1.16ms → **1.05–1.28ms**（同一区间，属噪声）；瞄准待机从"无环境动态"的 0.81ms（未加树摆时的中间测量）到 0.88–0.98ms，**环境动态成本 ≈ +0.1ms/帧**。
- 诚实记录：多次重复中有 1 次出现 `max 34.20ms / 1 帧 >33ms`，发生在软件光栅下三颗火球同时首次上屏的那一帧，不可在后续 3 次重跑中复现（判为合成/GC 抖动）。真实 GPU 环境不会有这一帧。
- 另注：软件光栅下 DPR2 的整体帧率本身只有 ~35–40fps（2600×1520 后备缓冲的合成开销），**这不是 JS 的耗时**（上表每帧 JS 只有 ~1ms），真实硬件上不受此限。

### H.3 资源与泄漏检查

- 精灵图：`sprite.ts` 模块级缓存，7 张图集（2.3MB，最大 `chef.png` 289KB）只加载一次，`SpriteAnimator` 共享同一批 `HTMLImageElement`；无 per-frame 分配（点池/姿态对象全部在 `snapshot()` 里复用字面量对象）。
- 临时 canvas：仅 `backdrop.ts` 建一张 2000×1600 缓存（首次绘制时），此后每帧一次 `drawImage`；HUD 头像是各自独立的小 canvas（原本如此）。
- 动画循环：`GameEngine.start()` 单 `requestAnimationFrame`；`destroy()` 里退订 `spriteClock`、卸载 Matter 事件（未改动）。`retry()` 后动画状态经 `pigAnim.reset()` 与 `pigWasAirborne = false` 复位（实测重打同一发仍是 1710 3★，无"上一局动画残留"）。
- 断言：环境动态全部是"时间函数"，**没有新增任何跨帧状态**，因此不存在"装饰动画在角色销毁后继续跑"的问题。

---

## I. 双版本测试

| 项目 | React（`localhost:5000`） | standalone（`file://…/public/standalone/index.html`） |
| --- | --- | --- |
| 1-1 `26°/150` 真机拖拽 | **1500 通关**，0 console error | **1500 通关**，0 console error |
| 角色动画（aim→launch→fly→hit→fly） | 状态序列正确（引擎内探针实测 `launch>fly>hit>fly`） | 同（同一引擎） |
| 技能视觉（六猪） | 护盾(间谍)=true、尾焰(厨师)=true、其余气泡，无报错 | 同 |
| 鸟朝向 | 巡逻鸟按轨道左右翻面（5.2s 采样见 B.4） | 同 |
| 镜头缓动 | 发射瞬间不缩放，飞行中平滑推近 | 同 |
| 动画设置 | 按钮「标准动效 ↔ 低动态」，写档 `motion: low`，`:root.gd-low-motion` 生效 | 按钮「动画 标准 / 动画 低动态」，写档同、类名同 |
| 低动态模式通关 | 1500 通关（判定不受影响） | 1500 通关 |
| 离线依赖 | — | 无 CDN、无远程请求；`file://` 下 `sprite.ts` 直接走 `FALLBACK_TYPES` 不 fetch |
| 构建 | `pnpm lint --quiet` / `pnpm ts-check` 通过 | `pnpm build:standalone` 产物已重建（未手改 `public/standalone/`） |

---

## J. 尚未完成 / 已知限制

1. **素材缺陷未修**（需重新导出，非代码问题）：九套图集末帧右下 41×9px `#a6a6a6` 灰条；`_template.png` 每帧都有。建议按下面清单重导。
2. **没有真实动作序列帧**：Hit / Land / Skill / Win / Defeat 目前是"帧分组 + 绘制层姿态"。要做成真正的手绘动作，需要每猪 8 帧的动作图集（清单见下）。
3. **投石车帧 1/2 仍未使用**（抬臂/蓄力）：本轮没有改发射器动画逻辑，避免和"瞄准姿态"叠加后打架。
4. **灌木/远山仍然静态**：只给草、树、尘、云做了动态；灌木剪影若要做摆动需要额外路径重绘（当前保守，避免前景抢视线）。
5. **四种机关动画无法交付**（仓库没有这些机关，见 C 段）。
6. **成就展示两版本形态不同**（React 逐条队列 / standalone 错开 chip）：小屏上做逐条队列会逼出滚动，故有意保留差异。
7. **性能数字是软件光栅下的 JS 成本**，不是真实 GPU 环境的最终帧率；若需真机 120Hz 验证需在用户设备上跑。

### 素材清单（若要走"真手绘动作"路线）

- A 必需（我方无法生成、必须重导）：
  - 7 张现有图集干净重导（去掉末帧灰条）：`pig/{normal,helmet,king,prof,chef,spy}.png`、`bird/{red,yellow,blue}.png`
  - 6 张猪动作图集，每张 8 帧 256×256（帧序固定）：`idle×2 / aim×1 / launch×1 / fly×2 / hit×1 / land×1`（win/defeat 可各 2 帧单独出图）
  - 3 张鸟动作图集，每张 3 帧 256×256：`flap-up / flap-mid / hit`
- B 可选：护盾环（单帧 256×256 透明 PNG）、冲刺尾焰（3 帧）、"哼"气泡（3 帧）、远景树林层（2000×240）、前景草丛层（2000×160）
- C 明确不需要：TNT、弹簧板、车轮、四种方块、地形、云山太阳、任何 UI 位图（这些已是矢量绘制，换位图反而会掉分辨率）

**放下图集后如何接入（零改动承诺）**：把 `PIG_STATES.hit.clip` 指向新帧组、`once: 220` 保留 → `playState('hit', { after: 'fly' })` 立刻播真帧；`BIRD_STATES` 同理。绘制层、状态机、引擎触发点都不用改。
