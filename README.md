# Nordschleife Kart

基于 [Open Street Kart](https://github.com/Picorims/open-street-kart)（OSK）的网页 3D 卡丁车游戏，赛道为纽博格林北环（Nürburgring Nordschleife）全长 20.75 km。赛道、地形、森林、建筑与周边道路全部由 OpenStreetMap 和高程数据生成，与 OSK“在真实地点比赛”的思路一致。

## 运行

需要 Node.js 20.19+ / 22.12+ 和支持 WebGL2 的浏览器。

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 类型检查 + 输出静态站点到 dist/
npm run preview
```

`dist/` 是纯静态文件，可直接部署到任意静态托管（资源使用相对路径）。

## 玩法

| 项目 | 内容 |
| --- | --- |
| 模式 | 对手赛（Versus，3/5/7 个 AI）、计时赛（Against Clock，3 次氮气 + 幽灵车）、自由驾驶（Touristenfahrten） |
| 速度档位 | OSK 的 Chill / Casual / Challenging / Crazy：90 / 108 / 126 / 144 km/h |
| 赛段 | 北环全圈（T13 → T13），或四个分段：Hatzenbach、Adenauer Forst、Bergwerk、Hohe Acht 起点 |
| 道具 | 氮气加速（+50% 极速 2.5 s）、空投炸弹（16 m 爆炸半径）；落后越多补给越快 |
| 其他 | 漂移与小涡轮、每 250 m 检查点、42 个命名路段的分段计时、个人最佳与路段对比、小地图、海拔剖面进度条 |

操作：W/S 或方向键油门刹车，A/D 转向，空格/Shift 漂移，E 道具，R 回到检查点，C 切换视角，Q 回看，Esc 暂停，M 静音。支持标准手柄与触屏。

## 从 OSK 移植了什么

OSK 是 Godot 4.6 桌面工程，依赖 Terrain3D、Debug Draw 3D 等原生扩展，无法直接导出到网页，所以这里把核心系统用 TypeScript + Three.js 重写：

| OSK 源文件 | 本项目 |
| --- | --- |
| `prefabs/car_custom_physics_2.gd` | `src/race/kart.ts`：油门/刹车/倒车系数、漂移转向公式、离心力抵消、空中操控削弱、软限速、越界限速、速度提升 |
| `scripts/track_state.gd`, `prefabs/player_spawner.gd` | `src/race/race.ts`：速度档位表、模式、发车格、倒计时、实时排名、比赛结束 |
| `scripts/player_item_slots_state.gd`, `prefabs/items/air_bomb.gd` | `src/race/items.ts`：三格道具槽、补给时间、加权随机、空投炸弹 |
| `prefabs/ai/race_path*`, BotBrain | `src/race/brain.ts`：沿赛车线行驶的 AI |
| `prefabs/track_checkpoint.gd` | `Kart.checkpointS` / `respawn()` |
| `scripts/osm_data_generator.gd`, `prefabs/map_data_loader.gd` | `tools/build_data.py` + `src/world/*`：OSM → 道路、建筑、地表纹理绘制 |
| `TrackState._update_camera` | `src/race/camera.ts` |
| 材质与道具图标（CC BY-SA 4.0） | `public/textures/`（由 `tools/build_textures.py` 转换） |

在此基础上补充了：真实坡度重力、坡顶飞跃（Flugplatz、Sprunghügel、Pflanzgarten 等）、Karussell 倾斜弯、双层护栏碰撞、轮胎墙、观众区、跨线桥、幽灵车、Web Audio 合成音效。

## 数据管线

```bash
python3 tools/build_data.py      # 需要 numpy、scipy、Pillow
python3 tools/build_textures.py  # 需要 ../open-street-kart（或 OSK_DIR 环境变量）
```

输入在 `data/raw/`：Overpass 查询（`*.overpassql`）及结果 JSON、AWS Terrain Tiles（Terrarium z14，`terrarium/` 目录，未纳入版本库，可按脚本注释重新下载）。输出到 `public/data/`：

- `track.json`：每 2 m 一个采样的中心线、高程、倾角、路宽、赛车线、42 个路段名
- `terrain.bin`：8 m 网格高度图（Uint16，厘米），赛道下方已整形
- `landcover.png` / `landcover_rock.png`：4 m 地表分类（森林、田地、城镇道路、碎石）
- `world.json`：4,653 栋建筑、公路（含桥/隧道标记）、地名
- `trees.bin`：约 30 万棵树（近处 3D，远处广告牌）

## 已知限制

- 高程来自约 30 m 精度的 DEM，弯道的细微起伏和路面倾角为平滑或手工近似；坡顶跳跃是手工添加的。
- 北环两侧护栏、路肩与轮胎墙按曲率规则生成，不是逐处还原；GP 赛道只在地表纹理中出现，不可驾驶。
- 物理是街机式（沿用 OSK 的思路），不是轮胎模型模拟。
- 在集成显卡上建议选择“流畅”画质。

## 许可

- 代码：MPL-2.0（与 OSK 相同，见 `LICENSE`）
- OSK 美术素材：CC BY-SA 4.0，© Picorims
- 地图数据：© OpenStreetMap contributors，ODbL
- 高程：AWS Terrain Tiles（Mapzen）

完整署名见 `public/credits.txt` 与游戏内“致谢与许可”。
