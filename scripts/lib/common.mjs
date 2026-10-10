/**
 * 公共工具：文件名解析、清单读取、TMDB 数据读取、命名构造与校验。
 * 这一层不与任何网盘耦合 —— 输入是纯 JSON / JSONL / 文本。
 */

import fs from 'node:fs';

/** 批量改名/整理接口最常见的非法字符集（半角逗号与百分号最容易被漏掉） */
export const ILLEGAL_CHARS = /[\\:<>|*?,/%]/;

/** 名称长度上限 */
export const MAX_NAME_LEN = 255;

/** 极简参数解析：--key value / --flag */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

/**
 * 从文件名解析季号与集号区间。
 * 支持：S01E05 / S01E05-E06 / S01E005 / s1e5 / S01E05~E06
 * @returns {{season:number, from:number, to:number}|null}
 */
export function parseEpisodeName(name) {
  const m = String(name).match(/S(\d{1,3})\s*E(\d{1,3})(?:\s*[-~]\s*E?(\d{1,3}))?/i);
  if (!m) return null;
  const season = Number(m[1]);
  const from = Number(m[2]);
  const to = m[3] ? Number(m[3]) : from;
  return { season, from, to };
}

/** 取扩展名（含点）；没有则返回空串 */
export function extname(name) {
  const m = String(name).match(/(\.[A-Za-z0-9]{1,5})$/);
  return m ? m[1] : '';
}

/** 标题归一化：NFKC + 小写 + & → and + 非字母数字折叠为空格 */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** 标题逐词比较：源标题的首词是否出现在目标标题里（容忍措辞差异） */
export function titleLooksLike(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const first = nb.split(' ')[0];
  return first.length >= 3 && na.includes(first);
}

/**
 * 读文件名清单。支持：
 *  - .jsonl / .ndjson  每行一个 JSON，取 filename / name 字段（网盘列表产物直接可用）
 *  - .json             {"files":[...]} 或 ["a.mp4", ...] 或 [{"filename":"..."}]
 *  - 其它             纯文本，每行一个文件名
 * @returns {string[]}
 */
export function loadNames(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const ext = file.toLowerCase().split('.').pop();

  if (ext === 'jsonl' || ext === 'ndjson') {
    return raw.split(/\r?\n/).filter(Boolean).map((line) => {
      try {
        const o = JSON.parse(line);
        return o.filename ?? o.name ?? null;
      } catch { return null; }
    }).filter(Boolean);
  }

  if (ext === 'json') {
    const o = JSON.parse(raw);
    const arr = Array.isArray(o) ? o : (o.files ?? o.names ?? []);
    return arr.map((x) => (typeof x === 'string' ? x : (x.filename ?? x.name))).filter(Boolean);
  }

  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * 读 TMDB 分集数据。接受四种形态：
 *  A) {"seasons":{"1":[[1,"Title"],...]}}
 *  B) {"1":[[1,"Title"],...]}
 *  C) [[1,"Title"], ...]                                    → 视为季 1
 *  D) {"seasons":{"1":[{"n":1,"title":"Title"}]}}
 *  也兼容 TMDB 官方 API 的原始响应：{"episodes":[{"episode_number":1,"name":"..."}]}
 * @returns {Map<string, Array<{n:number,title:string,runtime?:number}>>}
 */
export function loadTmdb(file) {
  const o = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = new Map();

  const toEntry = (e) => {
    if (Array.isArray(e)) return { n: Number(e[0]), title: String(e[1] ?? '') };
    return {
      n: Number(e.n ?? e.number ?? e.episode_number),
      title: String(e.title ?? e.name ?? ''),
      runtime: e.runtime ?? e.episode_run_time?.[0],
    };
  };
  const push = (key, arr) => {
    out.set(String(key), arr.map(toEntry).filter((e) => Number.isFinite(e.n)));
  };

  // TMDB 官方 API 单季响应
  if (o.episodes) { push(o.season_number ?? '1', o.episodes); return out; }
  if (Array.isArray(o)) { push('1', o); return out; }

  const seasons = o.seasons ?? o;
  if (Array.isArray(seasons)) { push('1', seasons); return out; }
  for (const [k, v] of Object.entries(seasons)) {
    if (Array.isArray(v)) push(k, v);
  }
  return out;
}

/** 清洗剧集/电影名里的非法字符（见 naming-spec.md 的字符表） */
export function sanitizeName(s) {
  return String(s)
    .replace(/:/g, ' -')
    .replace(/\?/g, '？')
    .replace(/[,%]/g, ' ')
    .replace(/[\\/*"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 数字补零 */
export function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

/** 构造集号片段：S01E05 或 S01E05-E06 */
export function episodeTag(season, from, to, pad = 2) {
  return from === to
    ? `S${pad_(season)}E${pad_(from)}`
    : `S${pad_(season)}E${pad_(from)}-E${pad_(to)}`;

  function pad_(n) { return String(n).padStart(pad, '0'); }
}

/** 构造规范文件名 */
export function buildName({ show, season, from, to, titles, ext, epPad = 2 }) {
  const tag = episodeTag(season, from, to, epPad);
  const t = titles.map(sanitizeName).filter(Boolean).join(' & ');
  return `${show} - ${tag} - ${t}${ext}`;
}

/**
 * 校验一个文件名是否合规。
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateName(name) {
  const errors = [];
  if (ILLEGAL_CHARS.test(name)) errors.push(`含非法字符: ${name.match(ILLEGAL_CHARS)[0]}`);
  if (name.length > MAX_NAME_LEN) errors.push(`超长 ${name.length} > ${MAX_NAME_LEN}`);
  if (!parseEpisodeName(name)) errors.push('缺少 SxxEyy 集号');
  return { ok: errors.length === 0, errors };
}

/** 打印对齐表格 */
export function printTable(rows, headers) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').length)));
  for (const r of all) {
    console.log(r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  '));
  }
}
