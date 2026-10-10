---
name: media-library-manager
description: 网盘影视库管家：把剧集/电影资源按 TMDB 的季集结构整理成 Jellyfin / Emby / Plex / 夸克 TV 端能正确刮削的形态。做三件事 —— ① 找资源（按用户指令找剧集/电影，在网盘建好「剧名 (年份)/Season NN」目录、定向转存、按 TMDB 改名）；② 整理现有库（梳理出正确文件结构 + 批量改名对齐 TMDB 集序）；③ 补齐缺集（比对出缺失集号 → 定向转存 → 按 TMDB 整理命名）。当用户说「找 XX 的资源/剧集」「刮削不出来」「TV 端识别不了/没影片信息」「按 TMDB 改名」「集号对不上」「缺的集能不能补上」「整理一下影视库/媒体库命名」时使用。含 TMDB 本体被 Cloudflare 拦时的镜像取数通路、双集文件的命名与四家刮削器差异、特辑/迷你剧的挂靠口径、以及一批实测踩坑与验证方法。
agent_created: true
---

# 网盘影视库管家（TMDB 口径）

把散乱、命名各异的影视资源，整理成媒体服务器**能正确刮削**的形态：目录结构对齐 TMDB 的季边界，文件名对齐 TMDB 的集号与标题。

## 三件事，先选路

| 用户要的 | 走哪条 | 核心动作 |
|---|---|---|
| 找资源 | [① 找资源](references/workflow-find.md) | 检索 → 建 `剧名 (年份)/Season NN` 目录 → 定向转存 → 按 TMDB 改名 |
| 理现有库 | [② 整理现有库](references/workflow-organize.md) | 取现状 + 取 TMDB 口径 → 摊开口径差异 → 生成方案 → 执行 → 回读 |
| 补缺集 | [③ 补齐缺集](references/workflow-fill-gaps.md) | 定缺口 → **先对齐口径** → 寻源 → 定向转存 → 整理命名 |

三条路共用同一套骨架（见文末「共同骨架」），差别只在起点和目标。

## 五条铁律（先读，能省掉 80% 返工）

1. **先对齐口径，再谈改名。** 「缺哪几集」这个问题本身可能不唯一 —— 网盘自制的「第 N 季」与 TMDB 的 `S0N` 集数经常不等。不先摊开差异就动手，等于在错的地基上盖楼。
2. **TMDB 是唯一权威，且只按标题映射、不按编号搬运。** 资源分享方自己排的集号与 TMDB 常差几十位，按编号对齐必然整体错位。
3. **命名合规 ≠ 刮削正确。** 名字没毛病、刮削照样错位，根因是元数据源的集号口径。先对齐口径，再谈文件名。
4. **转存 ≠ 归位。** 把文件搬进网盘只完成一半，必须再跑一次整理把文件移进目标季目录并按规范改名，才算补完。
5. **交付前必须回读验证。** 不看工具返回的「成功」，看目录里实际有什么。

## 命名规范（一页速查）

完整规则与边缘情况见 [references/naming-spec.md](references/naming-spec.md)。

**剧集**
```
剧名 (首播年份)/Season NN/剧名 - SxxEyy - 集标题.ext
Bluey (2018)/Season 02/Bluey - S02E07 - The Quiet Game.mkv
```
- 年份取 TMDB 的**首播年**，不是资源标题里那个。
- `SxxEyy` 用**两位**集号；部分老资源用三位（`S01E001`），**改前先确认目标刮削器吃哪种**。

**电影**
```
片名 (年份)/片名 (年份).ext
Dune (2021)/Dune (2021).mkv
```

**双集连播文件**（一个文件装两集）
```
剧名 - S01E01-E02 - 标题1 & 标题2.mkv
```
- 两个标题之间用 **` & `**，**不要用半角逗号**（逗号是 Jellyfin/Emby 的保留字符）。

**特辑 / 迷你剧**
- 特辑进 `Season 00`；迷你剧、跨剧联动在 TMDB 常是**独立条目**，单独建目录，别塞进母剧某一季。

**文件名字符处理**（几乎所有批量改名接口都卡这些）

| 原字符 | 处理 |
|---|---|
| `:` | → ` -`（`Fire Rescue: Pups` → `Fire Rescue - Pups`） |
| `?` | → `？`（全角） |
| `,` `%` | → 空格 |
| `\ / * " < > \|` | 删除 |
| 多空格 | 合并为单空格 |

## 三条工作流的共同骨架

```
① 取数      列出库内现状（逐层展开，读落盘产物，不看预览）
② 取口径    取 TMDB 权威的季/集/标题
③ 比对      摊开口径差异 → 确认或让用户选 → 得出「要做什么」
④ 生成方案  写成结构化方案（移动 + 改名），本地先校验一遍
⑤ 执行      交工具执行（先校验 check，再 apply）
⑥ 回读      重新列目录，断言目标条数对得上、来源零残留
```

## 依赖与前置

| 依赖 | 说明 |
|---|---|
| 一个**能操作网盘文件的命令行工具** | 本 skill 的示例以**夸克网盘 CLI** 的语义书写（`browse` / `search` / `saveas` / `file-organize`）。换别的网盘时，把对应能力套进「共同骨架」即可，流程本身不变 |
| **TMDB 的分集数据** | 优先官方 API；被 Cloudflare 拦时走镜像法，见 [references/tmdb-data.md](references/tmdb-data.md) |
| Node.js ≥ 16 | 跑 `scripts/` 下的辅助脚本 |

`scripts/` 下的脚本**只吃 JSON/JSONL 输入、输出报告与方案**，不和具体网盘耦合 —— 换网盘也能用。

## 脚本速查

```bash
# ① 查覆盖度：库内 vs TMDB，输出每季文件数 / 覆盖集号 / 缺号 / 越界集号 / 标题不符
node scripts/scan-coverage.mjs --library library.json --tmdb tmdb.json

# ② 生成改名方案 + 本地校验（非法字符、长度、同目录重名、长度>255）
node scripts/gen-rename-plan.mjs --library library.json --tmdb tmdb.json \
  --show "<剧名>" --year 2018 --out plan.csv

# ③ 只校验一份文件名清单是否合规
node scripts/validate-names.mjs --files names.txt --show "<剧名>"
```

输入格式见 [references/data-formats.md](references/data-formats.md)。脚本会自己检查字符集与重名，**在交给改名接口之前就把错误挡掉**，避免一轮轮试错。

## 交付纪律

- **先把差异摊开给用户看，再动手。** 尤其是季边界不一致、集号错位这类需要用户拍板的情况，不要自作主张。
- **只说做了什么，不说「成功」。** 报「目标季目录 26 项、来源目录 0 残留」，不报「任务成功」。
- **承认能力边界。** 整理类接口通常**不提供删除**（网盘尤其如此），需要用户自己在 App 里点掉多余文件 —— 别承诺做不到的事，见 [references/pitfalls.md](references/pitfalls.md)。
- **涉及版权与片源质量。** 只给方案与路径，不擅自替用户下载或转存受版权保护的内容；片源混搭（码率/字幕/音轨不一致）如实说明。

## 参考文档

- [references/workflow-find.md](references/workflow-find.md) —— ① 找资源
- [references/workflow-organize.md](references/workflow-organize.md) —— ② 整理现有库
- [references/workflow-fill-gaps.md](references/workflow-fill-gaps.md) —— ③ 补齐缺集
- [references/naming-spec.md](references/naming-spec.md) —— 命名规范（含双集、特辑、电影）
- [references/tmdb-data.md](references/tmdb-data.md) —— TMDB 分集数据获取（含镜像法）
- [references/data-formats.md](references/data-formats.md) —— 脚本输入输出格式
- [references/pitfalls.md](references/pitfalls.md) —— 实测踩坑库
