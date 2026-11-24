# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 游戏模块（《贪吃的绿皮猪》）

```
src/
├── app/page.tsx                    # 入口页，渲染 <GameShell />
├── game/
│   ├── types.ts                    # 关卡/角色/快照等类型契约
│   ├── levels.ts                   # 世界尺寸常量 + 10 关关卡数据（唯一关卡来源）
│   ├── engine.ts                   # Matter.js 物理引擎封装：发射、技能、破坏、相机、胜负
│   ├── aim.ts                      # 分段弹道预测（与物理同构的离散积分 + 撞穿/弹簧/滚行）+ 瞄准表现：分段轨迹/首撞菱形/落点环/拦截提示/鸟蛋目标/皮筋/满拉圈/状态胶囊/读数/速度线
│   ├── materials.ts                # 四种材质的唯一属性表：密度/摩擦/回弹/耐久/记伤阈值/分值/碎屑风格/音效/配色
│   ├── mechanisms.ts               # 机关的唯一参数表：TNT 引信/爆炸/连带点火半径、弹簧板弹射力度与触发阈值
│   ├── draw.ts                     # Canvas 2D 绘制（序列帧贴图 + 地形/建筑/碎块矢量）
│   ├── backdrop.ts                 # 程序化晴天舞台（天空/太阳/远山/草坡/树丛）+ 云：离屏缓存 + 每帧一次 drawImage
│   ├── sprite.ts                   # 序列帧精灵图（猪/鸟/大炮）：manifest 预加载 + SpriteAnimator（唯一角色绘制来源）
│   ├── audio.ts                    # Web Audio 合成音效（无音频素材文件）
│   ├── rating.ts                   # 星级三目标判定（rateStars）+ 五项分数合计（totalScore）
│   ├── achievements.ts             # 6 项成就定义与 findNewAchievements
│   ├── feedback.ts                 # 失败原因措辞（describeLose，纯函数，React/standalone 共用）
│   └── storage.ts                  # localStorage 进度存档（星级/最高分/成就/累计统计）+ applyWin 入档
└── components/game/
    ├── GameCanvas.tsx              # 挂载 canvas 与 GameEngine 生命周期
    └── GameShell.tsx               # 菜单/HUD/结算/关卡选择/玩法说明/竖屏遮罩
```

### 离线单文件版（`pnpm build:standalone`）

```
src/standalone/
├── main.ts                 # 原生 DOM 版外壳（菜单/HUD/关卡选择/结算），不含 React
└── main.css                # 复用 --gd-* token 与 gd-* 组件的独立样式（构建时自动注入）
scripts/build-standalone.mjs # esbuild 打包：game.js（内联 Matter.js）+ style.css + sprites/ + index.html
public/standalone/           # 产物：直接用 file:// 打开 index.html 就能玩（不要手改，重新构建生成）
```

- 由需求方要求"最终交付能 `file://` 直接打开的静态网页"，所以另有一条零依赖构建链；`src/game/*` 与 React 无关，两个外壳共用同一套引擎/关卡/绘制。
- `sprite.ts` 的 `setSpriteBase('.')` 把 `/sprites/...` 改成相对路径；`file://` 下 `location.protocol === 'file:'` 时**不 fetch** manifest，直接用 `FALLBACK_TYPES` 兜底登记表（否则控制台刷 fetch 报错）。新增猪/鸟/发射器**必须同时**更新 `FALLBACK_TYPES`。
- 改完 `src/game/*` 或 `src/standalone/*` 要重跑 `pnpm build:standalone`，产物才同步（`public/standalone/` 是构建物，别在上面手改）。
- 验证时注意：`headless_shell`（旧 headless）在 `file://` + Canvas 首帧会崩渲染进程，是浏览器自身问题；用完整 chromium 的 `--headless=new` 才能跑（`headless: false` + `args: ['--headless=new']`）。`file://` 下 canvas 会被精灵图 taint，`getImageData` 会抛 SecurityError，游戏本身不依赖它。

### 开发注意
- 物理参数：`GRAVITY_Y`(3)、`LAUNCH_FACTOR`(0.23) 在 `engine.ts` 顶部；`MAX_PULL`(150) 与两个发射点常量在 `levels.ts`（`GROUND_LAUNCH = {x:300,y:743}` 给投石车 4 关、`CANNON_LAUNCH = {x:300,y:500}` 给第 5 关大炮）。材质属性（密度/摩擦/回弹/耐久 `hp`/记伤阈值 `minImpact`/分值/碎屑风格/音效/配色）**只有 `materials.ts` 一份**：`hp` 就是「一击必碎」的冲击强度（wood 8 / glass 7 / stone 22 / metal 34，沿用旧的 `BREAK_POWER` 数值，所以破坏手感与关卡平衡不变），分值 50/50/80/120。改任一参数都要同步验证 10 关可通关。
- **弹道预测只有一份实现**（`aim.ts` 的 `predictAim(scene, plan)` + `createAimPlan()`）：步进式 `v = v·(1−frictionAir) + GRAVITY_STEP`、`p += v`，与 Matter `Body.update` 完全同构，`GRAVITY_STEP` 由 `GRAVITY_Y * 0.001 * STEP²` 现算（改重力只需改 `GRAVITY_Y`）；**猪的 `frictionAir = 0.001` 必须一起参与预测**。实测（`/tmp/aimacc.mjs`，5 关 44 组角度/力度）首撞前采样点与真机位置平均差 **0.02px**，"预测撞点 vs 真实首撞点"平均 **4.6px**（残差来自撞击前的半径差与滚行/小鸟拦截），最大 51px 出现在小鸟拦截那几步。
  - **分段**：`AimPlan.segments[]`（每段预分配 `SHOT_DOTS=72` / `ROLL_DOTS=40` 点池，最多 `MAX_SEGMENTS=8`，总步数 `MAX_STEPS=420`，每 `DOT_EVERY=6` 步采一个点）。首段 `'shot'` 撞到东西即收尾，之后按事件续段：能撞穿（`speed * pigPower >= MATERIALS[mat].hp`）→ `v *= SMASH_KEEP(0.72)` 续 `'smash'` 段（与 `drainBreaks` 给猪留 0.72 冲量同源，所以预测能穿过木/玻璃并继续飞）；踩中弹簧板 → 用 `mechanisms.ts` 的 `SPRING` 现算新速度向量续 `'spring'` 段；撞到车轮 → 只按 `WHEEL_KEEP(0.9)` 衰减一次（位掩码防重复）并**继续**（车轮会被推开，不是墙）；`tnt && speed >= TNT.minImpact` → 判定"会被点炸"直接停（爆炸后果不可预测）；撞小鸟 → 记 `intercept` 停。地面收尾后进入 `'roll'` 滚行估算（`ROLL_DECAY=0.978`、`ROLL_STEPS=120`、`ROLL_TRAVEL_MAX=460`，只用来给"可能滚进鸟窝"的概率提示，绝不当作准确落点）。
  - **地面半径**：`AimScene.groundRadius` 由 engine 传 `PIG_RADIUS`(26)，预测自己的 `radius` 是 `AIM_RADIUS`(23.92)，两者不一致会让落点环系统性偏高（曾差 120px）。
  - **小鸟外推**：`AimBird.motion` 的 `static/dash/orbit` 与 `updateBirds` 的脚本同构，`birdAt(bird, tSec)` 用 `now = simClock/1000` + `steps * stepMs` 求该步的鸟位置（黄鸟用 smoothstep 往返、蓝鸟用椭圆相位 + `def.offset`），所以拦截提示是真的"那一帧鸟在哪"，不是把当前位置冻住。**黄鸟的 `AimBird.x/y` 必须取 `LevelDef` 的待机点**（它的巡逻是 `Body.setPosition` 从原点摆到 `dashTo`，实时 `body.position` 只是被摆到的位置）。
  - **蛋的可达性**（`AimPlan.egg`）：`direct`（飞行中出现 `dist < egg.r + radius`，与 `updatePig` 的通关判定同式）> `roll`（滚行段进入蛋区域且入滚速度 `|vx| <= ROLL_SURE_SPEED(2.2)`，慢速才敢说"能滚进"）> `uncertain`（预测在撞穿处被截断，或路径离蛋 `<= egg.r*NEAR_EGG_RATIO(1.45)` 的擦边）> `blocked`（首撞在蛋之前、停下时速度 `< RICOCHET_SPEED(6)` 且离蛋远）/`none`；`hit === 'block'` 但余速 ≥6 也归 `uncertain`（真实里会被弹开、滑落、连带塌方）。只有 `direct/roll` 才亮绿色，`uncertain` 用金虚线（宁可少说也不假装算准）。
  - **性能**：预测只在拖拽时跑，且 32ms（`AIM_REFRESH_MS`）+ 拉拽向量未变时直接复用上一次 `AimPlan`；场景对象（方块 AABB / 弹簧 / 车轮 / 小鸟）由 engine 的 `aimBoxes/aimSprings/aimCircles/aimBirds` 池复用，`predictAim` 内部零分配（点池 + `plan.broken` 数组），全程不碰 `Matter.World`、不建刚体。实测拖拽期间 `buildAimPlan` 1.0ms/次（≈3% 一帧），60fps 稳定。
  - 无法预测的：撞穿后的坍落碎片、TNT 爆炸连锁、小鸟受击后改变状态、弹簧冷却期。这些只用"空心段/虚线/胶囊语气"表达不确定，不要为了好看去改真实物理。
- 瞄准表现都在 `aim.ts`：`drawAimPlan`（总入口）→ `drawEggTarget`（鸟蛋目标环，绿实线/绿虚线/金虚线三态）、`drawTrajectory`（首段实心米白点 + 撞穿/弹簧金空心点 + 滚行极淡小点）、`drawWheelHint`、`drawInterceptHint`（红虚线圈 + 金脉冲）、`drawHitMarker`（首撞菱形 + 内部符号）、`drawLandingMarker`（落点环，与首撞重叠时隐藏）、`drawPullBand`（两根二次贝塞尔皮筋）、`drawPullLimit`（满拉虚线圈，满拉变金）、`drawAimReadout` + `drawStatusChip`（屏幕空间底部居中：角度 + 力度条 + 一行状态胶囊）、`drawSpeedLines`（飞行高速段三根米白短线）。发射时 `camPunch = 1`（260ms 回 0，渲染按 `1 + camPunch*0.05` 推近）并叠 `shake`，`onSfx('launch', power)` 的 power 决定起音与气声。小猪本体在瞄准期仍钉在发射点（不做皮兜拉拽），换发射器/改手感都不动这套。胶囊文案由 `engine.aimStatus(plan)` 给（`直击鸟蛋` / `慢速滑进鸟窝` / `擦着蛋边，可能进` / `打不到蛋` / `XXX会拦下这一发`），别在绘制层再判一次。
- 物理循环使用固定步长 + 时间累加器（`STEP=16.666`），保证不同刷新率下速度一致。
- 发射前 `Body.setPosition(pig, anchor)`，速度用 `setVelocity`，否则轨迹与虚线预览不一致。
- 撞穿手感依赖 `pigSmashVelocity`：破块后在 `drainBreaks` 里给猪保留 0.72 倍冲量。
- 投石车**不再抬高**：车体 `bottomY` 直接压 `GROUND_Y=800`，所以发射点只能是 `y=743`（抛兜离底座 39 帧 px × 1.45）。发射点比原来的 500 低 243，就是靠 `MAX_PULL` 130→150 把射程/弧顶补回来的；再动发射点高度必须重跑 10 关弹道。
- 背景走 `backdrop.ts`，**纯程序化、无位图**：天空渐变（`SKY.top/mid/low`）+ 太阳光晕 + 两排圆头远山（`mountains()`）+ 三层草坡（`HILL`）+ 树丛（`TREE`）一次性画进 2000×1600 的离屏画布（世界 y −560~1040，`CACHE_TOP/CACHE_BOTTOM`），之后每帧只 `drawImage` 一次；云是唯一会动的部分（`drawClouds`，7 朵绕 `WORLD_WIDTH+800` 循环横移，别塞进缓存）。渲染时 `drawBackdropScreen`（屏幕兜底天空渐变）→ `drawBackdrop`（世界内一次 drawImage，按 `viewHalfWidth` 等比放大兜满）→ `drawClouds` → `drawTerrain`（亮草皮 + 草簇 + 暖土剖面 + 碎石）→ `drawForeground`（左右灌木剪影 + 长草）。调天色/山形只改 `backdrop.ts` 顶部常量。
- 障碍物材质四选一：`wood`（橙木）/ `stone`（浅石）/ `glass`（冰玻璃）/ `metal`（铁皮），`Material` 在 `types.ts`，**全部属性集中在 `src/game/materials.ts` 的 `MATERIALS`**：物理（density/friction/frictionStatic/restitution，`engine.ts` 的 `bodyOptions()` 直接读它）、耐久（`hp`）、记伤阈值（`minImpact`）、切向敏感度（`shear`，玻璃 .75 / 木 .45 / 石 .25 / 铁 .2，参与伤害折算）、分值（`score`）、碎屑风格（`debris`：splinter/chunk/shard/plate）、音效（`sfx`）、配色（`palette`，`draw.ts` 用 `palOf()` 读）。穿透判定读 `pierce`（`glass`/`wood` 可被冲刺猪穿透，`stone`/`metal` 不行）。新增材质只需在 `MATERIALS` 补一条 + `drawBlock` 的绘制分支 + `audio.ts` 的合成分支，然后重跑 10 关。`draw.ts` 的 `MAT_PALETTE`、`engine.ts` 的 `BODY_OPTIONS`/`BREAK_POWER`/`BREAK_SCORE`/`MAT_SFX` 都已删除，别再补第二份材质表。
- **伤害模型（第四轮重写，别再退回"全相对速度"）**：`onCollision` 先算 `vn = min(relSpeed, |dot(vA−vB, normal)|)`，`applyImpact(target, other, contact, vn, relSpeed)` 再算
  `hitSpeed = vn + (relSpeed − vn) × MATERIALS[mat].shear`（shear 取**被撞材质**：glass .75 / wood .45 / stone .25 / metal .2），
  然后 `power = isPig ? hitSpeed×PIG_POWER[type] : hitSpeed×min(1.4, other.mass×0.5)`、`harm = power / MATERIALS[mat].hp`，`dmg ≥ 1` 才进 `breakQueue`；`hitSpeed < minImpact`（wood 2.6 / glass 2.2 / stone 3.2 / metal 3.6 px/步）一律不计伤害——这批阈值必须明显高于单步重力增量（≈0.83），否则开局静置就在自己掉血。静态体（地面/鸟蛋/站桩鸟）按 1.4 满系数，所以横梁砸地面也会碎。
  - **为什么不能只看法向**：实测（探针挂 `engine.events.collisionStart`，10 关 × 100 次发射 / 907 次伤害性撞击）41.1% 的撞击 `vn/rel < 0.6`、30.9% < 0.4、均值 0.634，还有 174 次 `relSpeed ≥ 8` 的高速擦碰；但纯法向模型会让"斜擦玻璃/木箱"完全无效，1-2 直接不可通（reach 8.6%→0），所以必须留 `shear` 这个材质各向异性项。改 `shear`/`hp`/`minImpact` 任一项都要重跑 10 关平衡（`scripts/balance/density.mjs`）与 `reports/round-4-destruction.md` E 段的 10 关回归弹道。
  - **防抖只按对手**：`blockDamage[id].lastOther/lastAt`，同一对刚体 `IMPACT_REPEAT_MS=40ms` 内复发接触不重复扣耐久；**不要**加成全局冷却（"被撞开又砸在墙上"是两个对手，必须结算两次）。
  - **撞击点要记下来**：`markHitPoint()` 把接触点存成方块局部坐标（`hx/hy`）与撞击方速度（`pushX/pushY`），渲染时传给 `drawDamage(..., hit)` 让裂纹画在被打的那一点、`spawnBreakFx` 用 `pushX/pushY` 决定碎块飞散方向。
  - **爆炸**：`explodeAt(x, y, radius, power, source?)` 里 `d < radius` 走 `applyBlast`（`fall = t ≤ BLAST_CORE(.62) ? 1 : 1 − (1−BLAST_RIM .34)·…`，`harm = power×BLAST_DMG(34)×fall/hp`），`radius ~ 1.8R` 只推不碎（`BLAST_PUSH .075×power×(1−t)^1.3`），小猪受 `BLAST_PIG_KNOCK(15)` 掀飞但 **source 是自己时跳过**（否则弹道会被自己的技能打乱）。实测铁皮在 0.74R 只裂不碎（harm 0.8），石在 1.0R harm≈0.54。
  - 猪撞碎块后在 `drainBreaks` 里留 0.72 冲量（`pigSmashVelocity`），与第三轮预测的 `SMASH_KEEP` 同源，别改。
- **损伤表现（`draw.ts` 的 `drawDamage`，四材质各一套）**：完好 → 裂纹（`dmg ≥ CRACK_HIT 0.18`）→ 重伤（`dmg ≥ CRACK_HEAVY 0.62`），`MAT_SCAR = 0.05` 起就有痕。木=顺纹折线+纤维短刺+浅色崩口；石=放射折线+白色撞击坑+重伤缺角；玻璃=放射蛛网+同心环+撞击白点；铁=凹陷（径向渐变+下缘高光）+划痕，重伤加折痕+发丝裂。种子取 `body.id`（`seeded()` LCG），所以裂纹固定不闪；旧 `drawCracks` 已删除，别再补一份"只换颜色的同一套裂纹"。受伤未碎时 `spawnChips` 掉小碎屑（110ms 冷却，防贴墙摩擦刷粒子）。
- **连锁坍塌**：`drainBreaks` 里 `CHAIN_WINDOW_MS=700` 内连续破块计数（`chain` / `maxChain` / `chainUntil`），第 3 块起每块额外 `(chain-2)*10` 分包奖励；`Snapshot.chain`/`maxChain` 进 HUD（右上角「连锁 ×N」徽标）与结算（`WinResult.maxChain`）。
- **稳定性兜底**：`MAX_BODY_SPEED=62` 速度钳制（爆炸/掀飞后调 `clampSpeeds()`，防穿透与能量异常）；每 8 个物理步调一次 `calmResting()`，速度 < `REST_SPEED 0.05` 且角速度 < `REST_SPIN 0.008` 的刚体直接清零，压掉残余蠕动。没用 `enableSleeping`：休眠体会让 TNT 的 `applyForce` 打不动，副作用比收益大。
- 碎片始终是纯视觉粒子（`shards`/`puffs`/`flashes`，`updateFx` 推进），不会生成永久刚体。
- 破碎动效：`drainBreaks` 里 `spawnBreakFx(pos, angle, meta, impulse)`（impulse 优先取 `blockDamage.pushX/pushY`，没有才退回 `pigSmashVelocity`）产出 `flashes`(白色闪裂 90ms) + `shards`(按 `debris` 风格切块：木=顺长边劈 2~4 段细长木刺、石=2~3 厚块、玻璃=3~4×3~4 小片、铁=2 大片，出生即与原轮廓重合) + `puffs`(尘土)，由 `updateFx(dt)` 推进，渲染顺序在猪之后、`drawForeground` 之前；上限 shards 220 / puffs 160。每材质还有独立的 `feel{grav,drag,bounce,spin,ttl0,ttl1,push}`（木 .50/.995/.32/.55/950/500/.26、玻璃 .58/.992/.38/.62/620/430/.20、石 .95/.998/.14/.26/1050/550/.15、铁 .80/.999/.10/.32/1050/550/.18），碎块落地弹跳与寿命读它；撞击方向偏置 `along = min(2.6, |impulse|×0.16)` 让"从哪边打进去"看得出来。金属断口额外爆火星+白环，玻璃补高光碎屑，石材尘土更多；破坏震屏按材质分级（石 +0.1 / 铁 +0.08）叠加进 `addShake()`，别直接写 `this.shake`。碎块落到 `GROUND_Y` 会弹两下再淡出，别再另外加"消失前缩小"之类的效果。
- **音效去重复感**：`audio.ts` 的 `vary(base, spread=0.06)` 给 4 种破碎音、4 种撞击音、`boom`、`collapse` 加频率/音量随机抖动（连续破十几块不会听成一段循环）；材质音色差异读 `MATERIALS[].sfx / hitSfx`，静音开关与交互解锁逻辑不要动。
- 第四轮（碰撞伤害模型 / 四材质损伤 / 碎片与连锁 / 爆炸衰减 / 性能实测）的审查结论与实测数据见 `reports/round-4-destruction.md`；改伤害、爆炸、碎片、震屏参数前先读它，避免重复踩"擦碰全额计伤""爆炸无距离衰减"的坑。
- 爆炸动效走 `explodeAt(x, y, radius, power)`（教授猪技能与 TNT 共用）：产出 `blasts`（火球，380ms，`drawBlasts`）+ `rings`（白色冲击波，420ms，`drawShockwaves`）+ 7 团 `puffs({smoke:true})` + `shake` 震屏（渲染时在 `ctx.translate(cssW/2, cssH/2)` 之后叠加随机位移）。半径内方块进 `breakQueue`，1.8R 内方块被推飞、车轮被 `setVelocity` 掀飞。
- **反馈层（第五阶段）只有一套入口，别在各处手写**：
  - 震屏只走 `addShake(amount)`（`SHAKE_MAX = 6.5` 在 engine 顶部）：`amount ≤ 0.05` 直接忽略，叠加时封顶 `SHAKE_MAX`，衰减 `dt × 0.055`。当前强度：发射 `0.8 + power×1.5`、爆炸 `2.6 + power×2.2`、破块 `0.14 + min(0.8, w·h/16000)`、撞击`硬 0.3+k×0.8 / 软 0.12+k×0.42`、掉屑 `0.1 + harm×0.3`、弹簧 `0.35 + k×0.7`、撞鸟 0.5、抢蛋 1.2。**禁止**再直接写 `this.shake = ...`（只有开局的初始化和每帧衰减两处例外），否则小碰撞会叠成地震。
  - 撞击反馈在 `spawnImpactFx(pos, speed, meta, otherVel)`：敲击音读 `MATERIALS[mat].hitSfx`（`hitWood` / `hitStone` / `hitGlass` / `hitMetal`，登记在材质唯一源里），门槛 `IMPACT_FX_SPEED = 3.4`，同一块 `HIT_SFX_GAP = 90ms` 一次、全局再用 `impactSfxAt` 做 45ms 节流（爆炸掀飞十几块时不会砸成噪音墙）；火星进 `sparks`（`SparkFx`，`drawSparks` 渲染，上限 120 根），石/铁在 `speed > 6` 时外加一圈白环和更沉的震动，木/玻璃只给几粒火星 + 一点尘。
  - 世界飘字 `texts`（`FloatTextFx`，`drawFloatTexts` 压在最上层，`FLOAT_TEXT_TTL = 900`，同屏 ≤14 条，上浮"先快后慢"）：连锁 ≥3 打「连锁 ×N」、撞鸟「+150」、抢蛋「抢到鸟蛋！」。
  - 音效新增：`chain`（chain 3/5/8/12 各响一次）、`collapse`（`chain === 3` 且距上次 >800ms 的低频闷雷 + 4 段参差碎响）、`star`（结算星星）、四类撞击音。
  - 鸟受击：`captureBird` 里闪白 220ms + 9 根羽毛（`sparks[].feather`）+ 白环 + `+150` 飘字 + `0.5` 震动，`BirdRuntime` 加 `hitAt` / `dead`；900ms 后 `Composite.remove` 并 filter 掉。`drawBird(..., spin, flash, alpha)` 负责闪白与 520→860ms 的淡出。
  - 抢蛋：`win()` 只设 `eggPickAt` + `pendingWin` / `pendingWinAt = time + EGG_PICK_MS(760)`，真正的 `cbs.onWin` 由主循环派发——结算面板不能盖住蛋的动画。蛋的表现是 `drawEgg(..., pick)`（鼓起 / 摇摆 / 上浮 30px / 光晕放大）+ 两圈白环 + 12 根金色星芒。
- **UI 侧反馈**：`Stars` 的 `pop` 会按 `STAR_STEP_MS = 180` 逐颗播 `star` 音（`onSfx` 从 GameShell 传入），星星走 `.gd-star-pop`（缩放回弹 + 金色 `drop-shadow` 光晕**必须写在同一个 animation 里**：曾经拆成 `.gd-star-pop` / `.gd-star-glow` 两个类，都是 `animation` 简写，后者把前者整个覆盖，结果只剩发光、完全不弹出），容器挂 `.gd-star-stage`（伪元素金色光斑）。失败面板用 `.gd-panel-shake`（砸下来再左右晃）+ `.gd-sad-wobble` 摇头的 `PigPortrait`。standalone 版对应 `playStarChimes()`（含切关卡清理定时器）与 `.sad-pig`；`@layer components` 里的 keyframes 会被 `build-standalone.mjs` 自动抽出注入，别在 `main.css` 里重写一份。
- **评分与成就的唯一规则源**：`src/game/rating.ts`（`rateStars` / `totalScore`）与 `src/game/achievements.ts`（`ACHIEVEMENTS` / `findNewAchievements`）。`engine.ts` 只负责采集事实（`breakScore` / `chainBonus` / `birdScore` / `brokenBlocks` / `birdsCaptured` / `levelWorth`），判定全走这两个纯函数；UI 只渲染 `WinResult.goals` **别自己再判一次星级**（曾经在 win() 里 `used<=1?3:used===2?2:1` 硬编码，已删除）。
  - 星级三目标各一颗星：偷蛋（恒真）/ `usedPigs ≤ STAR_PIG_LIMIT(2)` / 破坏表现（`maxChain ≥ STAR_CHAIN_GOAL(3)` 或 `birdsCaptured ≥ 1` 或 `breakScore ≥ levelWorth * STAR_DEMOLISH_RATIO(0.4)`）。`levelWorth` 在 `buildWorld()` 里按所有方块 `MATERIALS[mat].score` 求和，所以新增/删减方块不用改评分代码。
  - `WinResult`（`types.ts`）`extends ScoreBreakdown`，五项分别是 `breakScore` / `chainBonus` / `birdScore` / `pigBonus` / `eggBonus`，外加 `brokenBlocks` / `birdsCaptured` / `goals`。`engine.win()` 里 `score = totalScore(...)`，`drainBreaks` 破块时也用它同步 `score`，别在两处各算一遍。常量 `EGG_BONUS=1000` / `PIG_LEFT_BONUS=200` 在 engine 顶部。
  - 成就：`SNIPER_GOAL=5`（累计撞鸟）、`CHAIN_ACHIEVEMENT=5`（单局最高连锁）、`DEMOLITION_GOAL=12`（单局破坏块数）、`oneShot`（`usedPigs === 1`）、`allClear`（`clearedLevels >= levelCount`）。`findNewAchievements` 的入参含 `unlocked`，返回的只含**本次新达成**的项，UI 拿它弹金色横幅。
- **失败反馈的唯一措辞源**：`src/game/feedback.ts` 的 `describeLose(info: LoseInfo, level)` → `{reason, tip}`。`engine` 只采集事实（`shotClosest` / `shotContacts` / `shotFar` / `tntLeft` / `springLeft`，见 `types.ts` 的 `LoseInfo`，**不参与任何判定**），`onLose(info)` 传出去；React（`GameShell.tsx`）与 standalone（`main.ts`）都只调这一个函数，别在 UI 里各写一套判断。
- **失败不写档**：`engine` 的 `onLose` 只给事实 + 弹面板，`storage` 不介入。
- **存档结构与入档入口**：`src/game/storage.ts` 的 `Progress = { levels:{[id]:{stars,bestScore,clears}}, soundOn, achievements:{[id]:ts}, totals:{birds,blocks,wins} }`，key `pig-revenge-progress-v1`。**所有写入都走 `applyWin(progress, levelId, result, levelCount) => {progress, unlocked}`**（更新星级/最高分/通关次数 → 累计 totals → 判定成就），React 与 standalone 各自维护一份 `Progress` state 即可；`loadProgress` 负责容错与旧存档迁移（缺 `achievements`/`totals` 时补空，星级钳 0~3），**失败不写档**（`engine` 的 `onLose` 只弹面板）。`recordResult` 已删除，别再找。
- **机关的唯一参数源是 `mechanisms.ts`**（`TNT` / `SPRING`），引擎/绘制/音效全读它，别再往 engine 里塞第二份常量。
- TNT 炸药箱（机关一）：`BlockDef.tnt = true`，物理仍按 `wood` 结算，但**不吃耐久累积**——`applyImpact` 里只要相对速度 ≥ `TNT.minImpact`(2.2) 就 `lightFuse()`（比木块的 2.6 还敏感，静置落位抖动约 1.6 不会误炸）。引信 `TNT.fuseMs`(240ms) 期间箱体画火星 + 闪白（`drawTntCrate(fuse, now)`），到期由 `updateFuses()` 推进 `breakQueue`，`drainBreaks` 里按 `TNT.radius`(210)/`TNT.power`(1.35) 爆炸。`explodeAt` 里还会对 `TNT.chainRadius`(420) 内的其它炸药箱错峰 `lightFuse(60~170ms)`，这就是机关之间的连锁；被炸进来的方块又进队列，所以 `drainBreaks` 用 `while + guard < 6` 排空，避免失控。
- 弹簧板（机关二）：`LevelDef.springs = [spring(x, w, power, angle, y)]`（`levels.ts` 的助手，`y` 省略就坐在草皮上，给了就是架立柱的弹射台）。`buildWorld()` 建成 **静态刚体**（不参与破坏、不进入计分），`onCollision` 调 `trySpring()`：法线 `n = (sin a, −cos a)`，砸向正面（`−v·n ≥ SPRING.minSpeed`）或"踩在正面且有速度"（`v·总速 × grazeKeep`）都会触发，`Body.setVelocity` 成 `n × speed`（`power + impact×0.55`，上限 `maxSpeed`），切向保留 `tangentKeep`(0.68)，冷却 `cooldownMs`。触发时播 `'spring'`、压板形变（`squashMs`/`reboundMs` 驱动 `drawSpring` 的 `press`）、推金色冲击环 + 尘土 + 震屏。木箱/石块/小猪都会被弹，所以"弹簧板 → 砸塌墙 → 墙砸到炸药箱"这类连锁是自然发生的。
- **开局静置保护**：`ARM_DELAY_MS = 340`（`armedAt = time + 340`）。这段时间内 `applyImpact` 不结算伤害、`trySpring` 不弹射，防止落位抖动把炸药箱提前引爆（曾经 1-10 一开局就整塔自爆）。
- **弹簧板的落点必须能被弹道踩到**：板面法线竖直，光看 `along` 永远弹不到"横着飞过板面"的猪，所以才有 `grazeKeep` 兜底；摆位别贴着墙根（1-7 的板在 x=936、板面 y≈737，14° 满拉的猪正好擦过它被弹高翻墙）。改 `spring()` 参数后必须重跑该关的 `16°/24°/32°/48°` 四档，确认既有通关解没被板子挡住。
- 车轮：`LevelDef.wheels = [{x,y,r}]`，`buildWorld()` 建成真实的圆形动态刚体（`wheelBodies` / `wheelRadii`），`drawWheel` 绘制，不参与计分；别把车轮做成静态装饰，房子塌了要靠它滚。
- **关卡结构必须「一出生就稳」**：木/石块在 `buildWorld()` 里就有物理体，没有支撑的悬臂结构会在开局自毁并白送分数（1-2 曾因屋顶只有单侧墙撑住，开局掉两块木板白给 100 分、鸟蛋悬空）。改 `levels.ts` 后必须验证开局 2 秒内积分为 0。
- **关卡共 10 关**（`levels.ts` 的 `LEVELS`）：1-1 第一次出手 / 1-2 屋顶鸟巢 / 1-3 黄鸟拦截 / 1-4 蓝鸟编队 / 1-5 三重防线（大炮）/ 1-6 玻璃塔 / 1-7 挡风墙 / 1-8 三层鸟巢 / 1-9 窄缝守卫 / 1-10 鸟巢堡垒（大炮）。改 `LEVELS` 数量要同步：关卡选择网格（`sm:grid-cols-2 xl:grid-cols-3`）、`totalStars` 分母、standalone 版同名结构。
- **摆放铁律（踩过坑）**：同一竖列的方块必须面贴面（上块 `y+h/2` = 下块 `y-h/2`），插入 5px 以上会让物理解算产生冲击 → TNT 开局自爆、整栋楼自毁白送分。站桩红鸟必须踩在方块顶面（`y = 顶面y − 26`），压进方块里会把楼推塌。改完必须验证开局 2.5s 得分为 0。
- **承重材质别错配（踩过坑）**：Matter 里重物压在细柱上会持续蠕动。`glass`（密度 0.0011）当承重柱、上面再压 `metal`（0.004）宽顶板 → 顶板会一路滑出去（1-5 曾 8 秒滑掉 180px）；`stone` 柱（0.0032）承 `metal` 顶板 / `wood` 落 `glass` 柱都稳（≤1px）。经验：**承重柱密度别比压在上面的板低一个档**，细柱（40~44 宽）上别叠 200+ 宽的顶层。
- **鸟的脚本轨迹不能穿结构（踩过坑）**：黄鸟沿 `(x,y) → (dashToX,dashToY)` 直线、蓝鸟沿 `(cx,cy,rx,ry)` 椭圆被 `Body.setPosition` 摆位，它们是静态体但会顶飞动态方块。黄鸟直线 / 蓝鸟椭圆（各自按半径 red 26 / yellow 24 / blue 18 外扩）必须与所有方块 AABB 留 2px 以上间隙，否则开局整栋楼被推走（1-10 的蓝鸟轨道曾压住铁顶、黄鸟冲刺线穿过一层楼板，8 秒推走 100+ px）。
- **竖直叠放层数别太贪**：超过 4 层、且中间夹细柱的塔即使贴面也会缓慢张开（1-8 的「两块 36 宽玻璃 + 200 宽木顶」压在 4 层塔上，8 秒张开 60px）。顶层要么直接落一块通铺板（1-8 现在是单块 220 宽玻璃顶），要么把细柱换成宽柱。
- **飞行慢放**：`FLIGHT_SLOWMO = 0.72` / `FLIGHT_SLOWMO_SPEED = 3`（engine.ts 顶部）。主循环只用 `dt * slowmo` 去喂固定步长累加器，**每一步的物理量完全不动**，所以 10 关弹道/破坏结果与之前逐帧一致，只是把猪在空中的真实时间拉长约 2 倍（1-1 从 ~0.7s 变成 ~1.05s），让玩家来得及点屏幕放技能；猪速掉到 3 以下（撞完开始塌楼）立刻恢复 1×，塌楼不拖沓。小鸟巡逻相位改读 `this.simClock`（同样按 slowmo 累加），否则飞行中鸟会相对猪变快。
- **飞行拖尾别调浓**：`updatePig` 里按速度自适应（间隔 `128 − fast×26` ms、`r 3.8 + fast×3.2 + rand`、`ttl 150~270`，`fast = min(1, 速度/16)`），慢速时和原来 130ms 一朵一样淡；再浓就会在慢放下糊成一条白带（0.5 慢放时踩过这个坑）。
- **小鸟捕捉加分**：`BirdRuntime.captured`，`onBirdHit` → `captureBird` 里 +150 分、`Body.setStatic(false)` 后按猪→鸟方向掀飞、推一蓬 `puffs`，`updateBirds()` 对已捕捉的鸟直接 return（停掉脚本巡逻）。钢盔猪撞鸟不反弹但仍算捕捉。`PuffFx` 字段是 `{x,y,vx,vy,r,grow,life,ttl,mat,smoke}`，**没有 `color`**。
- 弹道可达性：满拉（`MAX_PULL=150`）时最高点约在世界 y≈491，**蛋的 y 不要高于 500**，否则只能靠撞块反弹，通关窗口会窄到不可玩（1-6/1-8 曾把蛋放在 418/392 就是这个坑）。
- 切换关卡使用 `GameCanvas key={levelIndex}-{runId}` 强制重建引擎；`startLevel` 必须同时递增 `runId`，否则重复选同一关会丢 HUD。
- 颜色 token 见 `src/app/globals.css` 的 `--gd-*`（`--gd-ink` 描边 / `--gd-cream` 奶油内环 / `--gd-wood-1..4` / `--gd-gold` / `--gd-grass-*` / `--gd-stone-*` / `--gd-sky-*` / `--gd-blue` / `--gd-red`）；canvas 内的配色常量在 `materials.ts` 的 `MATERIALS[mat].palette`（方块四材质）与 `draw.ts` 顶部（`GRASS` / `DIRT` / `TNT`）、`backdrop.ts` 顶部（`SKY` / `MOUNTAIN` / `HILL` / `TREE`），需与 `DESIGN.md` 保持一致。
- UI 一律用 `globals.css` 的 `@layer components` 里那套卡通组件：`.gd-btn`（木质按钮，`--gold`/`--blue`/`--green`/`--red` 变体）、`.gd-round`（圆形）、`.gd-panel`（石板弹窗/卡片）、`.gd-plank`（深棕木牌）、`.gd-outline-text`、`.gd-star-pop`、`.gd-float-in`。`GameShell.tsx` 里的 `GdButton` / `StarIcon` / `Stars` / `LevelCard` 是这套样式的封装，新增按钮别再手写 border + bg-card。
- 10 关统一用「引擎快进（临时在 `GameEngine` 加 `ff(ms)` 同步推进物理的钩子，验完删掉，别提交）+ 角度 16~62°（步长 4）× 拉伸 150/134/118/102/86、每组合最多 3 发」扫射验证：全部存在通关解，全部满足开局 3s 得分为 0、最高连锁为 0。第三阶段（TNT 引信 + 弹簧板）之后实测通关组合数：1-1 45 / 1-2 5 / 1-3 32 / 1-4 25 / 1-5 45 / 1-6 5 / 1-7 32 / 1-8 6 / 1-9 37 / 1-10 30（1-10 最狠的一发能打出 `连锁 ×10`，一轮扫射里 TNT 被点炸 85 次、1-7 弹簧板被踩 41 次）。弹道特征：1-6 要抬到约 55° 满拉落进二层敞口巢；1-7 / 1-8 用 48° 满拉两发（1-8 先用教授猪点炸一层炸药箱）；1-9 约 16~24° 满拉平射钻低缝（门槛是两块落地冰玻璃，缝高 128px）；1-10 用 36° 满拉两到三发先掀外墙。
- **改动后回归用的通关弹道（第四轮伤害模型下重新推导，普通首发猪、不点技能；投石车关用 `GROUND_LAUNCH`，1-5 / 1-10 用 `CANNON_LAUNCH`）**：1-1 26°/150 → 1500 3★（浏览器实测 30°/150 也是 1500；1-1 的蛋位对力度敏感）；1-2 32°/150 → 1480 2★（全关最窄）；1-3 50°/132 → 1500 3★（56°/150 同样能过但对随机种子敏感）；1-4 62°/150 → 1990 3★；1-5 32°/132 → 2090 3★（连锁 ×7）；1-6 56°/150 → 1450 2★；1-7 26°/114 → 1740~1810 3★；1-8 26°/150 → 1860 3★（连锁 ×6）；1-9 20°/132 → 1530 2★；1-10 38°/132 → 1710 3★（多种子稳定）。机关回归：1-3 36°/150 → TNT 引信点亮后炸掉（tnt 1→0）、1-7 14°/150 → 弹簧板被踩中、猪被弹到 y≈487 翻过石墙、**1-10 40°/150 → 两只炸药箱串炸（链式引信 84ms）+ 连锁 ×11 全拆 2830 分**（旧的 1-10 16°/150 在新伤害模型下已打不到箱子）。**1-3 / 1-10 的部分路线对随机种子敏感**（碎片随机影响"哪块先塌"），改物理后请用 5 个种子复核（`playSequence(id, [shot], {seed})`）。headless 下物理比真实时间慢约 4 倍，验证脚本要轮询状态而不是固定等待；猪的飞行是**时机敏感**的（黄鸟会俯冲拦截），固定 sleep 的脚本容易误判成"关卡不可通"。
- **浏览器端拖拽验证的坐标换算**（踩过坑）：`WORLD_HEIGHT = 900`（不是 1600），瞄准态 `scale = min(cssW/2000, cssH/900)`、`cam = {x:1000, y:WORLD_HEIGHT/2 − 20}`，所以 `screenX = (wx−1000)·scale + cssW/2`、`screenY = (wy − 430)·scale + cssH/2`；拖拽终点取 `anchor + P·(−cosα, +sinα)` 的世界坐标再换算。用错 `WORLD_HEIGHT` 会把一次命中的发射画到完全错的角度上（表现为"拖了但总是 0 分"）。
- 精灵图统一走 `src/game/sprite.ts`：`SpriteAnimator(clips, motion, phaseMs)` 是通用帧动画器，`PigAnimator` / `BirdAnimator` 只是绑定各自节奏表的子类。`PIG_SHEETS` / `BIRD_SHEETS` 定义图集路径、帧尺寸与标定（`bodySize` + `centerX/centerY`）。图集放 `public/sprites/pig|bird/`，只认各自 `manifest.json` 的登记；没有登记/图片没到就**这一帧不画**（不保留矢量备用画法，`drawPig` / `drawBird` 只有贴图一条路径）。
- 红鸟是**动态刚体**（`isStatic: !perched`，`inertia: Infinity` 锁死转动惯量，否则圆形会顺着微斜的屋顶一直滚）：支撑它的木板被轰塌后会跟着掉落、落地停住；被猪撞会平移并被撞开，平移速度 >1.4 时切飞行帧并前倾。黄鸟（空中俯冲）/蓝鸟（空中绕圈）没有支撑面，仍是静态体由脚本 `Body.setPosition` 摆位——动它们的位置别加物理。加新鸟种时先想清楚「它站在哪」，只有站得住的才做成动态体。
- 小鸟：`BIRD_SHEETS` 里 `flipX: true`（素材朝右、游戏内朝左）；`BirdRuntime.anim` 每只鸟一份，蓝鸟三只相位错开 65ms；`updateBirdAnims(dt)` 里红鸟恒 idle、黄鸟按 `bird.dash` 切 fly、蓝鸟恒 fly。鸟的飞行帧**不带翅膀**，所以 `SpriteAnimator` 在 `setState` 时会做 `SPRITE_FADE_MS`(100ms) 交叉淡入（`snapshot().fade`），`drawBird` 在 fly 时再前倾 0.12rad。
- 动画状态由 `updatePigAnim(dt)` 用双阈值切换（>2.2 fly / <0.8 idle），避免停在斜坡上反复闪烁。
- 节奏集中在 `PIG_CLIPS` / `BIRD_CLIPS`（逐帧 holds，不是统一 fps）与 `PIG_MOTION` / `BIRD_MOTION`（呼吸/拉伸幅度）。改快慢只动这几处。
- 发射器由 `LevelDef.launcher` 决定：`'trebuchet'`（缺省，1-1 ~ 1-4）/ `'cannon'`（1-5）/ `'sling'`（已实现但当前没有关卡启用）。投石车与大炮共用 `sprite.ts` 的 `LauncherSheet`（`anchorX/anchorY` 装载点 + `bottomY` 底边 + `scale` + `fireFrames/fireHolds`）与 `blitLauncher()`；`drawTrebuchet` 直接在草皮上贴车体（画一条接地阴影，**土坡 `drawMound` 已删除**），`drawCannon` 先画木甲板 + 两根玻璃立柱的炮台（都直接复用 `drawBlock`）再贴炮身。弹弓没有位图素材，由 `drawSling(ctx, x, y, GROUND_Y, fireT)` 纯程序化绘制（立柱 + 双叉臂 + 皮筋 + 皮兜），撒放表演时长是 `SLING_RELEASE_MS = 260`（`fireT >= 0` 时按 `fireT / SLING_RELEASE_MS` 驱动皮兜回弹，`fireT < 0` 表示瞄准/待机）。**三种发射器共用 `launchPoint` 与 `LAUNCH_FACTOR`**，换发射器不动弹道：1-1 依旧是 35°/130 → 1450。
- 待发射猪队列是**可点选的**：`pigQueue` 保留所有还没发射的猪（含当前装在发射器上的那只），`selected` 指向它；`selectPig(i)` 只在 `state === 'aiming'` 且没在拖拽时生效，会 `buildLoadedPig()` 重建猪刚体（不同猪 `PIG_MASS` 不同，必须重建 body 而不是改属性）；真正的出队发生在 `onPointerUp` 发射成功那一刻（`pigQueue.filter` 掉 `selected` 后 `selected = 0`），别在装载时就 splice，否则 HUD 会少一只猪。`Snapshot` 用 `pigs`（队列）+ `currentIndex`（选中下标）+ `activePig`（已装载/在飞的那只，HUD 的提示文字必须用它，不能用 `pigs[currentIndex]`）。
- 标定：`CANNON` 的 `anchorX/anchorY`(162/123) 是炮口中心、`bottomY`(240) + `scale`(1.72) 让炮座落在甲板顶面、炮口内径≈小猪直径；`TREBUCHET` 的 `anchorX/anchorY`(204/177) 是抛兜中心、`bottomY`(216) + `scale`(1.45)（抛兜离底座仅 39 帧 px × 1.45 ≈ 57 世界 px，所以底座落在地面 800 时发射点就是 743）。投石车素材的抛兜画在右边、机身在左，而发射方向朝右，所以 `TREBUCHET.flipX = true`，`blitLauncher` 会以锚点为轴 `scale(-1,1)` 镜像（镜像下 `destX` 仍是 `-anchorX * k`：图像列 c 落在 local `dx + c*k`，取负后世界坐标就是 `(anchorX - c)*k`，别再额外减 frameW），机身因此落在发射点右侧（世界 306~640）、小猪留在车身左边。时序：大炮 `[1,2,3,4]`/`[80,80,130,320]`，投石车 `[3,4]`/`[120,220]`；引擎里 `fireT` 计时，`launcherFireFrame(sheet, elapsed)` 取帧，`launcherFireMs(sheet)` 到了回待机帧 0。帧 5 两套图都是与帧 0 同姿/水印帧，引擎不使用。改弹道参数不用动发射器：发射点与 `LAUNCH_FACTOR` 对所有关卡完全一致。
- HUD 左下角猪队列头像共用 `spriteClock`（单一 rAF 时钟）自行绘制，别改成 React 每帧 setState，否则 HUD 会被 60Hz 重渲染拖慢。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**

## 关卡平衡测试工具（`scripts/balance/`）

- 只用于验证，不参与构建，也不进产物：`entry.ts` 用 esbuild 打包成 CJS，`harness.mjs` 补浏览器替身（canvas/Image/fetch/localStorage/rAF）+ mulberry32 固定种子 + `createRun(levelId)` / `createRunFromLevel(level)`（**内存克隆关卡，做对照实验不动 `LEVELS`**）+ `shoot`/`playSequence`。
- 主指标是 `density.mjs` 的「撒点密度」：角度 4°~72°、力度 78~150、全部猪位、技能开关，**3 个种子都通关才算稳定通关**；`pigs.mjs` 出猪种/技能价值表，`lab.mjs` 用 `VARIANTS` 表在内存里试关卡方案，`stability.mjs` 查开局沉降/自毁。
- 测试**不写玩家 localStorage、不走 `applyWin`、不加测试按钮、引擎无测试专用分支**；改完关卡必须重跑 `density.mjs --step 4 --seeds 3` 并对照上一轮数字（第三轮报告：`reports/round-3-level-balance.md`）。

## 第十二部分：第六轮（角色动画 / 场景表现 / 视觉升级）

> 报告：`reports/round-6-visual-polish.md`（A 审查 / B 角色动画 / C 机关（跳过）/ D 背景 / E 镜头 / F UI / G 动画设置 / H 性能 / I 双版本 / J 未完成）。
> 本轮**没有**新增关卡、猪、鸟、机关，也**没有**改物理与判定；10 关回归弹道与第四轮报告 E 段逐条一致。

### 动作状态层（`sprite.ts`）

- `PIG_CLIPS` / `BIRD_CLIPS`（帧分组）**一行没动**，这是"不把不匹配的帧硬套到别的动作"的物理保证。动作另有一层：`SpriteStateDef { clip, once, pose(p, charge, t) }`，`pose` 只产出 `PoseAdd { rot, sx, sy, ox, oy }`。
- `SpriteAnimator.playState(next, { after, restart })` + `once` 到时自动回落 + `busy` getter；`snapshot()` 把 pose 叠到呼吸/拉伸之上输出 `{ state, frame, scaleX, scaleY, fade, rot, ox, oy }`。老代码 `setState()` 保留为兼容层（HUD 头像在用）。
- `PIG_STATES` 九态：idle / aim / launch / fly / hit / land / skill / win / defeat；`BIRD_STATES` 四态：idle / fly / hit / fall。**姿态永远不进物理**：`ox/oy` 只在 `drawPig/drawBird` 里平移，`rot` 只加到真实 `body.angle` 上做显示角。
- 待机相位 `PIG_PHASE`（normal 0 / helmet 170 / king 330 / prof 510 / chef 690 / spy 860 ms）：HUD 六只头像并排时不同步吸气。
- 状态机在 `engine.updatePigAnim`，四分支（aiming / won / lost / flying），flying 分支里 `anim.busy` 为真时不抢状态——这是旧版"落地抖动来回切帧"的根因，别再把它写成裸阈值判断。
- 补图集时的接入点：把 `PIG_STATES.hit.clip` 指到新帧组、保留 `once`，引擎触发点与绘制层零改动。

### 小鸟朝向（`engine.updateBirdAnims`）

- 朝向必须由**每帧真实位移**算（`face ±1`，dx > 0.08px 才翻，`faceHold` 防抖）。**不能用 `body.velocity`**：黄鸟/蓝鸟巡逻是 `Body.setPosition` 摆位，速度恒为 0，用速度判会永远朝左（曾经的红鸟是"面向"写死在 spec 里的 `flipX: true`）。
- 被撞后 `hit`(200ms) → `fall`，然后 `updateBirdAnims` 直接 return（停巡逻）；`face` 按击飞方向设，`drawBird(..., face)` 用 `flipMul` 镜像，镜像期间沿用 100ms 交叉淡。

### 技能视觉（纯绘制）

- `draw.ts` 新增 `drawPigShield`（间谍，双环 + 6 段弧光，读 `immuneUntil` 剩余时间）/ `drawPigDash`（厨师，沿真实速度反向拉 3 道锥形尾焰，读 `pierceUntil`）/ `drawOinkBubble`（normal/helmet/king 的"哼！"气泡，读 `skillAt` 后 480ms）。三者只读引擎字段，不写刚体。
- `engine.drawSkillFx()` 在飞行小猪之后调用，分支顺序 spy → chef → 其余（教授走原有爆炸，不给气泡）。

### 背景环境（`backdrop.ts` + `draw.ts`）

- **坡上 14 棵小树从离屏缓存搬出来**，改为 `drawWindTrees(ctx, tSec, reduce)` 每帧画：风是 1.05Hz ±1.34px + 0.43Hz ±0.56px 双正弦叠加，**只平移树冠控制点**（`tree(..., lean)`，trunk 顶部按 `lean*0.42` 跟随）。别改回 `save/rotate/restore`：实测同一场景 idle 帧时间 rotate 版 1.07ms、lean 版 0.98ms（DPR2、软件光栅）。
- `drawTerrain(ctx, groundY, sway)` / `drawForeground(..., sway)`：草簇叶尖 ±1.4~2px、前景长草 ±3px，`sway = time/1000`，`sway = 0` 时完全静止。
- `drawAmbient(ctx, worldWidth, groundY, tSec, density)`：18 粒 alpha 0.08–0.18 的浮尘，位置**完全由时间 + 序号算出**（无粒子池、无跨帧状态、零分配），画在 `drawBackdrop` 之后、`drawTerrain` 之前。
- 缓存策略不变：每帧仍只有一次 `drawImage`（`drawBackdrop`）。云仍是 7 朵视差横移。
- 环境动态成本实测 ≈ +0.1ms/帧（DPR2 idle 0.81→0.88~0.98ms）。

### 镜头（`engine` 相机）

- 新增 `camFollow ∈ [0,1]`（τ=300ms 起跟、τ=120ms 回落）+ `CAM_FOLLOW_AFTER = 130`（猪离锚点超过它才开始跟）。缩放 = `fitScale + (followScale - fitScale) * camFollow`，目标点 `clamp(pig.x, fitHalf, WORLD_WIDTH - fitHalf)`。
- **不再有发射瞬间 0.64→0.947（+48%）的跳变**：发射那一帧 `camFollow = 0`，缩放与瞄准时完全一致。改这段前先读报告 E.1。
- 震动仍只走 `addShake`（封顶 6.5、≤0.05 丢弃）；本轮新增：抢蛋 `camPunch = 0.85`、失败 `addShake(0.9)`（不缩放）。

### 动画设置（标准 / 低动态）

- 存档 `Progress.motion: 'standard' | 'low'`，默认 standard，旧档缺字段由 `loadProgress` 补 standard。
- 生效链：`motion` → `engine.setReduceMotion(bool)` + `.gd-low-motion` 类（两版本同名）。React 侧**挂 GameShell 根 div**，standalone 挂 `document.documentElement`；**不要**在 React 里写 `document.documentElement.classList`——流式水合期间改 `<html>` 会报 hydration mismatch（踩过）。
- 低动态 = 震动 ×0.35、`camPunch` 恒 0、粒子上限 110/80/60、浮尘归零、树/草不摆（**仍然画出来**）、分数直接落位、星星弹跳与失败摇头关闭、面板/淡入缩到 130/120ms；**保留**星级出现、连锁徽标、场景淡入——状态反馈不能一起关掉。
- `useRollScore(target, instant)` 在 GameShell 里，低动态走 `instant`。

### UI 动效与双版本

- React：分数滚动 + `gd-chain-pop`（`key={chain}` 重挂载才重播）+ `AchievementQueue` 逐条 + `gd-scene-in` 淡入；standalone：rAF 分数补间 + `is-pop`（reflow 重加类）+ `.ach-chip` 错开 160ms + `#game.is-in`。
- 星级只点亮 `i < count` 的星（`Stars` 的 `pop && i < count`），未获得的星不播点亮动画。
- 两版本的成就展示形态**有意不同**（React 逐条队列 / standalone 错开 chip），别为"看起来一致"把 standalone 改成会逼出滚动的逐条队列。
- 改完 `src/game/*` 或 `src/standalone/*` 必须重跑 `pnpm build:standalone`；`public/standalone/` 是构建物。

### 游戏名（改名约定）

- 对外名称统一为**《贪吃的绿皮猪》**，出现在：`src/app/layout.tsx`（title / openGraph）、`GameShell.tsx` 菜单木牌 `h1`、`src/standalone/main.ts` 菜单 `h1`、`scripts/build-standalone.mjs` 模板里的 `<title>`（改完必须 `pnpm build:standalone`）。改名时**不要**动 `src/game/storage.ts` 的 `pig-revenge-progress-v1`：那是存档 key，改了所有玩家进度清零。

### 素材重导流程（换某套角色图时照做）

用户给的是"一排若干只、帧间距不等"的原始表情图（例如 `assets/五款绿猪厨师表情精灵图-1.png` 2172×724），**不要直接丢进 `public/sprites/`**：管线按 `spec.frameW` 硬切，间距不等会切到相邻角色。流程：

1. 按空列分段切出每只，取 alpha 外接框；
2. 用**帧 0 的本体宽**对旧图做统一缩放（厨师猪 163/304 = 0.536），不要逐帧各自缩放（会变成"呼吸变大"）；
3. 每只的本体圆心统一摆到帧内同一坐标（厨师猪 `(128,168)`），帧间零抖动；
4. 缩放用**预乘 alpha + LANCZOS**，否则深描边会出现半透明黑边；
5. 合成 1280×256 覆盖原文件，按新图量出的值改 `PIG_SHEETS` 的 `bodySize/centerX/centerY`（bodySize 决定屏幕大小：`k = 2r / bodySize`）。

验收：脚本量出每帧本体开口在外接框中心 ±4px 内、`greenW` 与同批角色接近（厨师猪 155~172，其它猪 151~195），再进游戏做一次"厨师 vs 普通"截图差分，差分质心应落在世界锚点投影点 ±3px（实测 (193.4,562.0) vs 期望 (192,560)）。
