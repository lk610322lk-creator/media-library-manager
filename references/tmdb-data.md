# TMDB 分集数据获取

命名与缺口判定的**唯一权威**是 TMDB。这份文档解决「怎么稳定拿到它的季/集/标题」。

## 方式 1（首选）· TMDB 官方 API

有 API Key 时最省事、最稳，**不会遇到网页版的 Cloudflare 拦截**。

```bash
# 1) 搜剧，拿 TMDB id
curl -s "https://api.themoviedb.org/3/search/tv?api_key=<KEY>&query=<剧名>&language=en-US"

# 2) 拿季列表（每季集数、首播年）
curl -s "https://api.themoviedb.org/3/tv/<id>?api_key=<KEY>&language=en-US"

# 3) 拿某一季的全部分集（集号 + 标题 + 时长）
curl -s "https://api.themoviedb.org/3/tv/<id>/season/<N>?api_key=<KEY>&language=en-US"
```

第 3 步返回的 `episodes[]` 里取 `episode_number` / `name` / `runtime`，就是我们要的权威口径。

- **电影**用 `/3/search/movie` + `/3/movie/<id>`。
- 本地缓存一份 JSON，避免重复请求。

## 方式 2 · 网页版

`https://www.themoviedb.org/tv/<id>-<slug>/season/<N>`

⚠️ **它会对非浏览器请求返回 403，抓取工具也常被 Cloudflare 拦。** 别在这里硬碰。

## 方式 3 · 镜像站（网页版被拦时的取数通路）

TMDB 有一批**模板相同、数据同源**的镜像站，分集数据就是 TMDB 自己的口径。

**已知镜像族**：`cinefound.com`、`gowatching.com`、`www.flicksmore.com`（同一套模板、同一批数据）。同类站点可用相同方法试探。

```bash
# ① 搜条目拿 vid
curl -s "https://<mirror>/siteinfo/search/?search=<剧名>" -A "Mozilla/5.0" \
  | grep -oE '/tv/vid-[0-9]+-[a-z0-9-]+\.html'

# ② 条目页里提取季 ID：找 c_season(<sid>,<vid>,<'海报URL'>,<channel_type>)
curl -s "https://<mirror>/tv/vid-<vid>-<slug>.html" -A "Mozilla/5.0"

# ③ 打 ajax 拿该季分集（★实测只有 flicksmore 域名的接口可用）
curl -s -X POST "https://www.flicksmore.com/ajax/episode/" \
  -H "X-Requested-With: XMLHttpRequest" \
  -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
  -H "Referer: https://www.flicksmore.com/tv/vid-<vid>-<slug>.html" \
  --data-urlencode "vid=<vid>" --data-urlencode "sid=<sid>" \
  --data-urlencode "img=<条目页里那条海报图 URL>" \
  --data-urlencode "channel_type=1"
```

返回 HTML 里分集有两种标记，解析时都要吃：

```
<span>Episode N - Title</span>
<span>EPN&nbsp;&nbsp;Title</span>
```

**镜像法必知的几点**：

- 实测 `cinefound` 与 `gowatching` 的 `/ajax/episode/` **一律 500**（季页也 500），只有 `flicksmore` 返回 200。
- 季页 HTML 里**只内嵌当前默认季**的分集，其余季必须打 ajax。
- **条目页默认内嵌的那一季不一定是 S01**（实测有默认内嵌 S03 的）。
- **Specials（Season 0）在镜像站常为空**（有页面、零分集），必须走 ajax；也有镜像站干脆不列 Season 0，换个镜像就能看到。
- `govatching` 这类站点还提供**季页直达 URL**：`/season/<vid>-<slug>-season-<sid>.html`（不是所有镜像都支持）。

## 方式 4 · 交叉验证源（口径可能不同，慎用）

- **TVmaze**：`https://api.tvmaze.com/singlesearch/shows?q=<剧名>&embed=episodes` —— 免费、可达、无拦，但它有**自己的一套编号**，与 TMDB 常有出入（实测同一部迷你剧，TVmaze 20 集 vs TMDB 18 集）。
- **Wikipedia** 的分集表：适合做人名/年份佐证，集号口径也未必与 TMDB 一致。

⚠️ **只用它们做交叉验证，不要拿来做命名依据。** 命名必须回到 TMDB 口径。

## 口径差异：必须知道的三件事

1. **不同数据源的集数与集号可能不同。** 报缺口前先确认用哪套口径，并**在交付里写明**。
2. **TMDB 自己也会「串季」** —— 把下一季开头的几集**同时挂在本季**。后果是全季补齐后本季仍有几个空集号。**属数据源问题，不是漏补。**
3. **同一批短片可能挂在两个条目下**（母剧的 Specials + 独立的迷你剧条目）。于是「特辑缺 N 集」里一大半其实就是迷你剧的内容。

## 兜底

拿不到任何权威数据时：**宁可保留原有编号**（文件自身编号与内容绑定更强），并向用户说明残余风险，不要凭猜测改名。
