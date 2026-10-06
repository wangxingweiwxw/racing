# Nordschleife Kart

基于 [Open Street Kart](https://github.com/Picorims/open-street-kart)（OSK）的网页 3D 卡丁车游戏。赛道、地形、森林、建筑与周边道路全部由 OpenStreetMap 和高程数据生成，与 OSK“在真实地点比赛”的思路一致。目前有两条赛道：

| 赛道 | 长度 | 特点 |
| --- | --- | --- |
| 纽博格林北环（Nürburgring Nordschleife） | 20.75 km | 73 个弯、300 m 落差、坡顶飞跃、Karussell 倾斜弯、艾弗尔森林 |
| 上海国际赛车场（F1 中国大奖赛） | 5.45 km | 顺时针 16 个弯：T1–T2 蜗牛弯、T6 / T14 发夹弯、1.2 km 后直道；看台、湖泊与河道 |

在标题界面选择赛道（切换时页面会重新加载），也可以直接打开 `?track=nordschleife` 或 `?track=shanghai`。

## 运行

需要 Node.js 20.19+ / 22.12+ 和支持 WebGL2 的浏览器。

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 类型检查 + 输出静态站点到 dist/
npm run preview
```

`dist/` 是纯静态文件，可直接部署到任意静态托管（资源使用相对路径）。

## Cloudflare 无服务器部署

当前版本包含仰望 U9 Xtreme 车型、参考图样式 HUD 和停车长按刹车倒车操作。
通过以下两个 Cloudflare 入口提供游戏：

- Pages 游戏地址：https://racing-wangxingweiwxw.pages.dev/
- Worker 入口：https://racing-wangxingweiwxw.wangxingweiwxw.workers.dev/
- Worker 健康检查：`/api/health`（仅检查 Worker 自身，不代表 Pages 源站状态）

Pages 托管 `dist/` 的游戏、地图和贴图，Worker 将 GET/HEAD 请求转发到固定的
Pages 源站。游戏逻辑在浏览器执行，成绩和设置保存在当前域名的 localStorage 中；
两个域名的本地存档相互独立。建议日常使用同一个入口。

首次在新电脑部署时：

```bash
npm ci
npx wrangler@4.147.0 login
npm run deploy
```

`npm run deploy` 会运行车辆与 Worker 测试、构建游戏、发布 Pages，最后发布 Worker。
也可分别执行 `npm run deploy:pages` 和 `npm run deploy:worker`。
`wrangler.jsonc` 配置独立 Worker；Pages 使用命令中的项目名称和 `dist` 输出目录，
因此 Pages 提示忽略这个 Worker 配置文件是预期行为。

项目使用 Pages Direct Upload，GitHub push 不会自动更新 Cloudflare；更新后需要重新执行
`npm run deploy`。原有 GitHub Pages workflow 仍保留。部署到其他 Cloudflare 账号时，
先创建自己的 Pages 项目，再同步修改部署命令中的项目名和 `PAGES_ORIGIN`。
Wrangler 4.147.0 创建 Pages 项目时可能自动改用 Workers；若明确需要独立 Pages 项目，
创建命令为 `npx wrangler@4.147.0 pages project create <项目名> --production-branch main --force`。
已有 Pages 项目的日常部署无需该参数。

依赖锁文件已使用公共 npm registry，保留原锁定版本及完整性校验。
Cloudflare 凭据由 Wrangler 保存在本机，不应提交到仓库。

## 玩法

### 仰望 U9 Xtreme 车型与界面

默认车型已替换为 `gd_yangwang_u9` 中的 U9 Xtreme：保留原车身、尾翼、驾驶舱、
轮毂和灯组，使用 `red_met` 纯红涂装，重新映射碳纤维、玻璃与车漆材质。
四轮随车速旋转，前轮随转向偏转，刹车灯随减速增强；追尾/远景/车头镜头和碰撞尺寸均已适配。
驾驶仍采用项目原有的街机物理与速度档位，不代表实车性能或神力科莎物理模拟。

比赛界面采用左上排名和计时、右上圆形地图、中央底部数字车速与速度条。
右下刹车采用灰色三横槽踏板，与右侧油门水平并排；转向、油门、刹车支持鼠标及多点触控。
车速归零后连续按住刹车 2 秒进入 R 挡，继续按住倒车，最高 5 km/h；松开或暂停重置计时，
踩油门可恢复前进。支持 S / 下方向键、手柄 LT 和屏幕刹车，踏板下方显示长按进度。
已移除氮气、喷火、漂移和漂移奖励加速；对手赛保留空投炸弹，点击底部道具槽或按 E 使用。
暂停、切后台、丢失指针捕获会释放控制输入。

模型产物在 `public/models/u9x/`：玩家高精度模型 `u9x.glb`（374,034 三角形），
AI 与流畅画质使用 `u9x-lod.glb`（47,243 三角形）；几何和纹理在车辆间共享。
低画质只加载 LOD 文件，普通/高画质额外加载玩家高精度模型。

重新转换模型（原始 MOD 保留在本机并已被 Git 忽略）：

```bash
python -m pip install "git+https://github.com/semiloker/assetto-corsa-gltf.git@9ab1438113c0a1c655ba44f99ace1b048a2d3bb5"
python tools/build_car.py
npm run build
npm run test:car
```

`test:car` 需要支持直接运行 TypeScript 的 Node.js 22.18+。
浏览器集成检查：安装 Playwright 与 Edge 后运行 `node tools/check-u9.cjs`；
可通过 `PLAYWRIGHT_MODULE` 指定已有 Playwright 模块路径，检查时先在 5173 端口启动开发服务器。
检查覆盖加速、刹车、停车长按倒车、5 km/h 限速、输入释放、相机切换、暂停、重新开赛、八车同场及手机踏板布局，截图写入 `checks/`。
物理测试还覆盖 30/60/120 Hz、坡道停车、计时中断、前进恢复及道具生成。

模型署名为 GeroDa74 / ACTK；模型与贴图不属于本项目 MPL-2.0 或 OSK 素材的 CC BY-SA 授权，
详见 `public/models/u9x/NOTICE.txt`。原 MOD 说明禁止公开分享，公开分发前需具备相应授权。

| 项目 | 内容 |
| --- | --- |
| 模式 | 对手赛（Versus，3/5/7 个 AI）、计时赛（Against Clock，幽灵车）、自由驾驶 |
| 速度档位 | OSK 的 Chill / Casual / Challenging / Crazy：90 / 108 / 126 / 144 km/h |
| 赛段 | 北环：全圈（T13 → T13），或四个分段：Hatzenbach、Adenauer Forst、Bergwerk、Hohe Acht 起点；上海：1 / 3 / 5 圈赛（HUD 显示圈数，结算显示单圈用时） |
| 道具 | 空投炸弹（16 m 爆炸半径）；落后越多补给越快 |
| 其他 | 每 250 m 检查点、按路段 / 弯角分段计时（北环 42 段、上海 15 段）、个人最佳与路段对比、小地图、海拔剖面进度条 |

操作：W/S 或方向键油门刹车，停车后持续刹车 2 秒倒车，A/D 转向，E 道具，R 回到检查点，C 切换视角，Q 回看，Esc 暂停，M 静音。支持标准手柄与触屏。

## 从 OSK 移植了什么

OSK 是 Godot 4.6 桌面工程，依赖 Terrain3D、Debug Draw 3D 等原生扩展，无法直接导出到网页，所以这里把核心系统用 TypeScript + Three.js 重写：

| OSK 源文件 | 本项目 |
| --- | --- |
| `prefabs/car_custom_physics_2.gd` | `src/race/kart.ts`：油门/刹车、停车长按倒车、轮胎侧向抓地、空中操控削弱、前进软限速、倒车硬限速、越界限速 |
| `scripts/track_state.gd`, `prefabs/player_spawner.gd` | `src/race/race.ts`：速度档位表、模式、发车格、倒计时、实时排名、比赛结束 |
| `scripts/player_item_slots_state.gd`, `prefabs/items/air_bomb.gd` | `src/race/items.ts`：三格道具槽、补给时间、空投炸弹 |
| `prefabs/ai/race_path*`, BotBrain | `src/race/brain.ts`：沿赛车线行驶的 AI |
| `prefabs/track_checkpoint.gd` | `Kart.checkpointS` / `respawn()` |
| `scripts/osm_data_generator.gd`, `prefabs/map_data_loader.gd` | `tools/build_data.py` + `src/world/*`：OSM → 道路、建筑、地表纹理绘制 |
| `TrackState._update_camera` | `src/race/camera.ts` |
| 材质与道具图标（CC BY-SA 4.0） | `public/textures/`（由 `tools/build_textures.py` 转换） |

在此基础上补充了：真实坡度重力、坡顶飞跃（Flugplatz、Sprunghügel、Pflanzgarten 等）、Karussell 倾斜弯、双层护栏碰撞、轮胎墙、观众区、跨线桥、幽灵车、Web Audio 合成音效。

## 数据管线

每条赛道的配置（OSM 来源、坐标范围、路宽、弯角名称、倾斜弯、坡顶等）在 `tools/tracks.py`，前端的文案、赛段 / 圈数、看台位置在 `src/tracks.ts`。

```bash
python3 tools/fetch_data.py shanghai   # 下载 Overpass 数据与高程瓦片（已有的文件会跳过）
python3 tools/build_data.py shanghai   # 需要 numpy、scipy、Pillow（上海的看台裁切还需要 shapely）
python3 tools/build_data.py nordschleife
python3 tools/build_textures.py        # 需要 ../open-street-kart（或 OSK_DIR 环境变量）
```

输入在 `data/raw/<赛道>/`：Overpass 查询（`*.overpassql`）及结果 JSON、AWS Terrain Tiles（Terrarium z14，`terrarium/` 目录，未纳入版本库，用 `fetch_data.py` 重新下载）。Overpass 主站繁忙时脚本会改用 mail.ru 镜像；大查询超时可以拆成单条语句分别下载。输出到 `public/data/<赛道>/`：

- `track.json`：每 2 m 一个采样的中心线、高程、倾角、路宽、赛车线、路段名
- `terrain.bin`：8 m 网格高度图（Uint16，厘米），赛道下方已整形
- `landcover.png` / `landcover_rock.png`：4 m 地表分类（森林、田地、城镇道路、碎石）
- `world.json`：建筑（北环 4,653 栋，上海 159 栋，其中看台按阶梯座椅生成）、公路（含桥/隧道标记）、地名；上海还有湖泊与河道水面
- `trees.bin`：树木（北环约 30 万棵，上海约 6 千棵，包括 OSM 行道树）

上海国际赛车场取自 OSM relation 2094941 中的 GP 赛道闭合路线（way 156328670），从发车线节点 1686043686 开始按顺时针方向采样，长 5,456 m（官方 5,451 m）。弯角名称按 F1 官方编号。长江三角洲地势平坦，DEM 的起伏主要是建筑和树木造成的噪声，所以高程被大幅平滑并压缩到约 1.5 m。主看台的 OSM 轮廓包含横跨主直道的两座“翼桥”，构建时会切掉赛道走廊，只保留座椅部分。

## 已知限制

- 高程来自约 30 m 精度的 DEM，弯道的细微起伏和路面倾角为平滑或手工近似；坡顶跳跃是手工添加的。
- 护栏、路肩、缓冲区与轮胎墙按曲率规则生成，不是逐处还原；北环旁的 GP 赛道只在地表纹理中出现，不可驾驶。
- 上海的维修区通道只出现在地表纹理中；横跨主直道的翼桥没有建模。
- 物理是街机式（沿用 OSK 的思路），不是轮胎模型模拟。
- 在集成显卡上建议选择“流畅”画质。

## 许可

- 代码：MPL-2.0（与 OSK 相同，见 `LICENSE`）
- OSK 美术素材：CC BY-SA 4.0，© Picorims
- 地图数据：© OpenStreetMap contributors，ODbL
- 高程：AWS Terrain Tiles（Mapzen）

完整署名见 `public/credits.txt` 与游戏内“致谢与许可”。
