# 脚本输入输出格式

`scripts/` 下三个脚本都只吃文件清单 + TMDB 数据，**不与任何网盘耦合**。

## 输入 A · 库内文件清单（`--library` / `--files`）

三种形态任选，脚本自动识别：

**① `.jsonl` —— 网盘列表产物（推荐，功能最全）**

一行一个 JSON。只要能取到 `filename`（或 `name`）就会被读入；若还带 `fid` / `parent_fid`，就可以额外产出整理方案。

```jsonl
{"filename":"Bluey - S01E01 - Magic Xylophone.mp4","fid":"...","parent_fid":"...","size":123}
{"filename":"Bluey - S01E02 - Hospital.mp4","fid":"...","parent_fid":"...","size":123}
```

> 网盘 CLI 通常会把「列出目录」的**全量结果落盘**成这种 JSONL —— 直接喂给脚本即可。
> ⚠️ 注意用**落盘产物**，不要用命令行回显的「预览」（预览常被封顶，会漏文件）。

**② `.json`**

```json
{ "files": ["Bluey - S01E01 - Magic Xylophone.mp4", "Bluey - S01E02 - Hospital.mp4"] }
```
也接受直接是字符串数组，或对象数组（取 `filename` / `name`）。

**③ `.txt` —— 纯文本清单**

每行一个文件名。

## 输入 B · TMDB 分集数据（`--tmdb`）

四种形态任选：

```json
// A) 推荐：按季组织
{ "seasons": { "1": [[1,"Magic Xylophone"],[2,"Hospital"]], "2": [[1,"Dance Mode"]] } }

// B) 省掉 seasons 层
{ "1": [[1,"Magic Xylophone"],[2,"Hospital"]] }

// C) 只有一季
[[1,"Magic Xylophone"],[2,"Hospital"]]

// D) 对象式（带时长）
{ "seasons": { "1": [ {"n":1,"title":"Magic Xylophone","runtime":7} ] } }
```

**也直接兼容 TMDB 官方 API 的单季响应**（含 `episodes` 数组的那种），所以可以原样保存：

```bash
# 把 TMDB 官方 API 的季响应转成本地 tmdb.json
KEY="<你的 API Key>"; ID="<剧的 TMDB id>"; N=1
curl -s "https://api.themoviedb.org/3/tv/$ID/season/$N?api_key=$KEY&language=en-US" \
  > "tmdb_s$N.raw.json"
# 直接把各季 raw 文件拼成一个 {"seasons":{"1":[...],...}} 即可，或逐个传 --tmdb
```

> **特殊季的季号**：特辑用 `"0"`。
> **电影**不需要这份文件 —— 电影的命名规则只有「片名 (年份)」，直接手工做。

## 输出

| 文件 | 来自 | 内容 |
|---|---|---|
| `report.json` | `scan-coverage --out` | 每季的文件数 / TMDB 集数 / 覆盖数 / 缺失集号 / 越界集号 / 标题存疑 |
| `plan.tsv` | `gen-rename-plan --out` | 三列：`season`、`old_name`、`new_name` |
| `plan.json` | `gen-rename-plan --proposal` | 可直接提交给整理接口的方案（见下） |

### 整理方案形态

```json
{
  "version": 4,
  "new_folders": [],
  "operations": [{
    "op": "move",
    "to": "<目标 Season 目录 FID>",
    "items": [{ "fid": "...", "parent_fid": "...", "origin_name": "...", "new_name": "..." }]
  }]
}
```

- `parent_fid` / `origin_name` **每项必填**（服务端三元组校验），所以 `--proposal` 要求输入是带这两个字段的 `.jsonl`。
- 需要新建季目录时，在 `new_folders` 里声明，并把 `to` 写成该条目的 `plan_id`。
- **提交前先跑一次 check（校验）、再 apply（执行）**，并且 check/apply 都要带任务目录参数。
- 若某些项 `new_name` 与 `origin_name` 相同，属幂等项，可留可去。

## 退出码

| 脚本 | 0 | 非 0 |
|---|---|---|
| `scan-coverage` | 正常完成 | 参数缺失 |
| `gen-rename-plan` | 正常完成 | 参数缺失 / `--proposal` 缺 `--to-fid` |
| `validate-names` | **全部通过** | **存在问题（可用于 CI / 提交门禁）** |

`validate-names` 的退出码可以直接当门禁用：改成 0 才算这一步做完。
