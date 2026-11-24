# -AI-
长久以来，我一直梦想亲手开发一款游戏。 这是我的第一款网页小游戏，灵感是愤怒的小鸟，不过这次反过来了，让绿皮猪强夺他们的蛋。嘿嘿，这也算是迈出了自己的第一步，也不知道以后的自己什么时候可以真正做出属于自己的游戏。

---

## 立即试玩

不用装任何东西：直接用浏览器打开 [`public/standalone/index.html`](public/standalone/index.html) 就能玩（`file://` 双击也可以）。

那份产物是 `pnpm build:standalone` 打包出来的**离线单文件版**——游戏引擎和物理库全部内联，零外部依赖。

## 游戏简介

角色反转的《愤怒的小鸟》：这次玩家站在绿皮猪一边，用投石机与炮台主动出击，去抢鸟的蛋。

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16.1.1（App Router） |
| UI | React 19 + shadcn/ui（Radix UI） |
| 语言 | TypeScript 5 |
| 样式 | Tailwind CSS v4 |
| 物理引擎 | [matter-js](https://brm.io/matter-js/) 0.20 |
| 包管理 | pnpm 9（`preinstall` 强制校验，会阻止 npm / yarn） |

## 本地运行

需要 Node.js 20.9+ 与 pnpm 9（本项目在 Node 24 下开发）。

```bash
pnpm install
pnpm dev
```

然后打开 <http://localhost:5000>。端口可用 `PORT` 或 `DEPLOY_RUN_PORT` 环境变量覆盖。

> `pnpm dev` 实际调用 `scripts/dev.sh`，需要 bash 环境。**在 Windows 上如果没有 bash**，可以直接跑：
>
> ```powershell
> pnpm exec next dev --port 5000
> ```
>
> 或用仓库自带的 `scripts\dev.ps1`。

## 构建

```bash
pnpm build              # 生产构建
pnpm start              # 启动生产服务器
pnpm build:standalone   # 重新生成离线单文件版
```

`pnpm build:standalone` 会把游戏引擎、Matter.js 与纯 DOM 外壳打成一个 IIFE，产物写入 `public/standalone/`：

- `index.html`
- `game.js` —— 已内联 Matter.js，无外部依赖
- `style.css` —— 主题 token 从 `src/app/globals.css` 抽出
- `sprites/**` —— 角色与发射器序列帧

## 代码检查

```bash
pnpm validate   # 并行执行 tsc 类型检查 + eslint + stylelint
```

## 目录结构

```
src/
├── app/                  # Next.js App Router 页面与全局样式
├── game/                 # 游戏核心引擎（物理、瞄准、绘制、关卡、音效）
│   ├── engine.ts         # 主循环与物理世界
│   ├── draw.ts           # Canvas 渲染
│   ├── aim.ts            # 瞄准与弹道
│   ├── sprite.ts         # 序列帧精灵
│   ├── levels.ts         # 关卡数据
│   └── ...
├── components/
│   ├── game/             # 游戏 React 外壳（GameShell / GameCanvas）
│   └── ui/               # shadcn/ui 基础组件
├── standalone/           # 离线单文件版的入口（main.ts / main.css）
├── hooks/  lib/          # 通用 hook 与工具函数
public/
├── sprites/              # 角色 / 发射器序列帧（bird / pig / cannon / trebuchet）
├── bg/                   # 背景图
└── standalone/           # build:standalone 的产物（已提交，可直接玩）
scripts/                  # dev / build / start / validate，各有 .sh 与 .ps1 版本
└── balance/              # 关卡数值平衡实验脚本
reports/                  # 设计迭代记录
```

## 文档

- [DESIGN.md](DESIGN.md) —— 视觉与交互设计说明
- [PRD.md](PRD.md) —— 产品需求文档
- [AGENTS.md](AGENTS.md) —— AI 协作开发约定
- [`reports/`](reports) —— 关卡平衡、破坏手感、视觉打磨三轮迭代记录

## 许可

[Apache License 2.0](LICENSE)
