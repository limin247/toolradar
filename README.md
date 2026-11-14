# 工具雷达 · TOOLRADAR

一个单文件即可跑起来的 GitHub 工具榜单站：**按「你今天要干什么」分类**，再叠一层时间口径（存量 / 本周新星 / 本月新星 / 还活着 / 正在涨）。

不是又一个 awesome 列表。核心判断是：**同一个仓库，对前端是神器，对运维是噪音。**所以导航的第一维不是语言、不是 Stars 总量，而是工作场景。

## 跑起来

```bash
# 方式一：直接双击 index.html
# data/tools.js 已经把数据内联成 window.TOOLRADAR_DATA，file:// 也能用

# 方式二：起个本地服务（手机同局域网也能看）
node scripts/serve.mjs 8710
```

零依赖，不需要 npm install、不需要构建。

## 榜单口径（页脚 methods 里有同一份说明）

| 榜单 | 定义 | 说明 |
| --- | --- | --- |
| 星标总榜 | `stars` 从高到低 | 存量，代表「已经被很多人验证过」 |
| 本周新星 | `created` 在近 7 天内，按 stars 排 | **不是 GitHub Trending 的周增速**。GitHub 不公开历史 star 曲线，这里给的是「这周刚出生、且已经很受关注」 |
| 本月新星 | 同上，窗口 30 天 | 同上 |
| 活跃榜 | `pushed` 在近 7 天内，按 stars 排 | 代表「还在维护」。archive 的排在后面 |
| 上升榜 | 两次快照之间的 `Δ stars` | 需要至少两次抓取才有数；只有一次快照时页面会说明原因，不编造热度分 |

**刻意不做的事**：不编造加权「热度分」，不把推断写成事实。人工策展的条目给中文定位和标签；未策展的新库保留 GitHub 原厂描述并标注「原厂描述」。

## 工作场景

15 个（14 个人工场景 + `misc` 未归类）：

终端与效率 · AI 编程 · 开发工具箱 · 前端与设计 · 部署与运维 · AI 与数据 · 数据存储 · 安全与隐私 · 测试与质量 · 文档与知识 · 效率与个人 · 自建与个人云 · 学习与面试 · 精选合集 · 未归类新库

每个场景一段「先问什么」的说明，写在 `data/curated.json` 的 `scenarios[].blurb` 里——它决定这个分类是「一个目录」还是「一个判断」。

## 刷新数据

```bash
node scripts/fetch-github.mjs        # 抓 17 组 GitHub 搜索结果 → data/snapshots/YYYY-MM-DD.json
node scripts/build-data.mjs          # 合并策展层 → data/tools.json + data/tools.js
```

- 匿名 GitHub API 限速 60 次/小时、搜索 10 次/分钟，脚本里有节流（`--pace`，默认 6.5s）和 403/429 退避。
- 有 token 时：`GITHUB_TOKEN=xxx node scripts/fetch-github.mjs`，限速提到 5000/h。
- **抓第二次快照后，上升榜自动有数**：脚本会对比最近两份快照算 `Δ stars`。

## 让它跟着 GitHub 自己更新

抓取和合并是两条命令，剩下的只是「谁来按时敲这两条命令」。三种选法：

**A. GitHub Actions（推荐，页面托管在 GitHub Pages 时最顺）**
仓库里已带 [`.github/workflows/refresh-data.yml`](.github/workflows/refresh-data.yml)：每天 UTC 01:17（北京时间 09:17）跑一次抓取 + 合并，`data/` 有变化就提交。推上去后什么都不用做，Actions 页面也能手动触发。

**B. 本机定时（Windows 任务计划）**

```powershell
schtasks /create /tn "ToolRadar 每日刷新" /sc daily /st 09:00 /tr ^
  "cmd /c cd /d \"D:\path\to\github-radar\" && node scripts/fetch-github.mjs && node scripts/build-data.mjs"
```

**C. 手动**：`node scripts/fetch-github.mjs && node scripts/build-data.mjs`

**页面自己会说谎吗？**不会。快照超过 4 天没刷新，右上角的快照 pill 会变成琥珀色并写出「· 已 N 天」，鼠标悬停给出刷新命令——数据过期这件事是可见的，不靠你记。

## 目录

```
index.html              单页
assets/style.css        样式
assets/app.js           交互（榜单/场景/搜索/收藏/对比/快捷键/深链）
data/curated.json       人工编辑层：场景定义 + 仓库的中文定位、标签、选型建议
data/tools.json         合并后的数据（441 条）
data/tools.js           同一份数据的 script 形式，供 file:// 直接打开
data/raw/               抓取原始结果（slim 字段）
data/snapshots/         按日期的快照，上升榜的原料
scripts/fetch-github.mjs  抓取
scripts/build-data.mjs    合并 + 生成 tools.js
scripts/serve.mjs         零依赖静态服务
.github/workflows/refresh-data.yml  每日自动刷新（可选）
```

## 加一个工具

在 `data/curated.json` 的 `tools` 数组里加一条，`r` 必须是 `owner/repo` 的原样写法（构建脚本会去抓取结果里核对，找不到会报 `missing`）：

```json
{
  "r": "junegunn/fzf",
  "s": "terminal",
  "z": "模糊搜索一切：文件、命令历史、进程，还能给任何管道做过滤器",
  "t": ["终端", "模糊查找"],
  "f": "先装它，再用它当 ripgrep / git 的前端"
}
```

`f`（选型建议）可省略；`t` 最多 2 个会显示在卡片上。

## 交互

- `/` 聚焦搜索，`j`/`k` 上下移动，`Enter` 打开详情，`f` 收藏，`c` 加入对比（最多 3 个），`1`–`5` 切榜单，`Esc` 关闭，`?` 快捷键面板
- 收藏存 `localStorage`（`toolradar.favs.v1`）
- 深链：`#b=week&s=terminal&q=git`、`#t=junegunn/fzf`（直接开详情）、`#c=a/repo,b/repo`（直接开对比）

## 设计

暖纸白（`#f2f1e8`）打底、发丝线分隔、一种强调色（琥珀 `#a5580a`），除此之外不引入颜色。

- 不用纯白：`--bg` 是带一点米黄的纸色，长页面盯着不刺眼；`--bg-soft` 只用于输入框和悬停
- 层级只靠字号和留白，不用阴影、不用卡片堆叠；分隔线一律 1px `#dad8cb`
- 字号比常规站大一档：正文 16px / 行高 1.75，列表标题 1.04rem（≈16.6px），最小的等宽标签也守住 0.74rem（≈11.8px）
- 字体走系统栈（Windows 上是微软雅黑，macOS 上是苹方），数字用等宽的 `tabular-nums` 对齐
- 中文标题一律不小于 1.2rem：雅黑的粗体在 20px 以下笔画会糊成一团（`并排对比` 的教训）
- 顶部那条 441 / 15 / 101 / 349 / 253 是等分的五栏数据带，不是并排的零散数字
- 场景前的圆点是页面上唯一的彩色元素，颜色来自 `curated.json` 的 `accent`
- 场景条在宽屏整行换行、一条不多不少；窄屏才退回横向滑动并加右缘渐隐
- 列表行不放星数条：数字本身已按序，条只会跟右边的元信息抢注意力

## 已知限制

- 快照只有一份（2026-11-14），所以**上升榜目前是空的**——这是诚实状态，不是 bug。再跑一次 `fetch-github.mjs` 就有。
- 441 个仓库里 109 个还没人工归类，落在「未归类新库」；它们只在周榜/月榜出现（老库不在抓取窗口里）。
- 周榜 × 单个场景经常只剩个位数甚至 0 条：7 天内新建的库本来就少。页面会明说，并给「看本月 / 看总榜」的出口。
- 星数是快照值，不实时。
