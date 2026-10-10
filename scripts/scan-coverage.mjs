#!/usr/bin/env node
/**
 * scan-coverage —— 库内覆盖度 vs TMDB 对照报告
 *
 * 输出：每季的文件数 / TMDB 集数 / 覆盖集号数 / 缺失集号 / 越界集号 / 标题存疑条目
 *
 * 用法：
 *   node scripts/scan-coverage.mjs --library local.jsonl --tmdb tmdb.json [--out report.json]
 *
 * --library 可以是网盘列表产物(.jsonl)、{"files":[...]}(.json) 或纯文本清单(.txt)
 */

import fs from 'node:fs';
import {
  parseArgs, parseEpisodeName, loadNames, loadTmdb,
  titleLooksLike, printTable,
} from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));

if (!args.library || !args.tmdb || args.help) {
  console.log(`用法: node scripts/scan-coverage.mjs --library <库内清单> --tmdb <TMDB分集> [--out report.json]

  --library   库内文件清单：.jsonl（网盘列表产物）/.json/.txt
  --tmdb      TMDB 分集数据，格式见 references/data-formats.md
  --out       可选，把结构化结果写成 JSON`);
  process.exit(args.help ? 0 : 1);
}

/**
 * 从规范文件名里取集标题部分。
 * 分隔符要求「空格-空格」，这样双集写法 S02E01-E02 里的连字符
 * 不会被误当成「集号与标题」的分隔符。
 */
function titleOf(name) {
  const m = String(name).match(
    /S\d{1,3}E\d{1,3}(?:\s*[-~]\s*E?\d{1,3})?\s+-\s+(.+?)\.[A-Za-z0-9]{1,5}$/i,
  );
  return m ? m[1].trim() : null;
}

/** 把 [5,6,7,10] 压缩成 "E05-E07, E10" */
function rangeStr(nums) {
  if (!nums.length) return '-';
  const s = [...nums].sort((a, b) => a - b);
  const out = [];
  let start = s[0], prev = s[0];
  const pad = (n) => String(n).padStart(2, '0');
  for (let i = 1; i <= s.length; i++) {
    const cur = s[i];
    if (cur === prev + 1) { prev = cur; continue; }
    out.push(start === prev ? `E${pad(start)}` : `E${pad(start)}-E${pad(prev)}`);
    start = prev = cur;
  }
  return out.join(', ');
}

const names = loadNames(args.library);
const tmdb = loadTmdb(args.tmdb);

// 按季分组
const bySeason = new Map();
const unparsed = [];
for (const n of names) {
  const p = parseEpisodeName(n);
  if (!p) { unparsed.push(n); continue; }
  if (!bySeason.has(p.season)) bySeason.set(p.season, []);
  bySeason.get(p.season).push({ name: n, ...p });
}

const seasons = [...new Set([
  ...bySeason.keys(),
  ...[...tmdb.keys()].map(Number).filter(Number.isFinite),
])].sort((a, b) => a - b);

const rows = [];
const report = { seasons: [], unparsed, totalMissing: 0 };

for (const s of seasons) {
  const files = bySeason.get(s) ?? [];
  const eps = tmdb.get(String(s)) ?? [];
  const tmdbNums = eps.map((e) => e.n);

  const covered = new Set();
  for (const f of files) for (let i = f.from; i <= f.to; i++) covered.add(i);

  const missing = tmdbNums.filter((n) => !covered.has(n));
  const extra = [...covered].filter((n) => !tmdbNums.includes(n)).sort((a, b) => a - b);

  const mismatch = [];
  for (const f of files) {
    const t = eps.find((e) => e.n === f.from);
    if (!t || !t.title) continue;
    const mine = titleOf(f.name);
    if (mine && !titleLooksLike(mine, t.title)) {
      mismatch.push(`E${String(f.from).padStart(2, '0')} 文件="${mine}" / TMDB="${t.title}"`);
    }
  }

  report.totalMissing += missing.length;
  report.seasons.push({
    season: s, files: files.length, tmdbEpisodes: eps.length,
    covered: covered.size, missing, extra, mismatch,
  });

  rows.push([
    `S${String(s).padStart(2, '0')}`,
    files.length,
    eps.length || '?',
    covered.size,
    rangeStr(missing),
    extra.length ? rangeStr(extra) : '-',
    mismatch.length || '-',
  ]);
}

console.log('=== 覆盖度报告 ===');
console.log(`库内清单: ${args.library}   文件数: ${names.length}`);
console.log(`TMDB 数据: ${args.tmdb}\n`);
printTable(rows, ['季', '库内文件', 'TMDB集数', '覆盖集号', '缺失集号', '越界集号', '标题存疑']);

if (unparsed.length) {
  console.log(`\n⚠️ ${unparsed.length} 个文件无法解析出 SxxEyy（未计入统计）：`);
  unparsed.slice(0, 10).forEach((n) => console.log('   ' + n));
  if (unparsed.length > 10) console.log(`   … 另有 ${unparsed.length - 10} 个`);
}

const anyMismatch = report.seasons.filter((r) => r.mismatch.length);
if (anyMismatch.length) {
  console.log('\n⚠️ 标题存疑明细（编号对但标题不像；确认是否只是措辞差异）：');
  for (const r of anyMismatch) {
    console.log(`  S${String(r.season).padStart(2, '0')}:`);
    r.mismatch.slice(0, 5).forEach((m) => console.log('    ' + m));
    if (r.mismatch.length > 5) console.log(`    … 另有 ${r.mismatch.length - 5} 条`);
  }
}

console.log(`\n合计缺失集数: ${report.totalMissing}`);

if (args.out) {
  fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
  console.log(`已写出结构化报告: ${args.out}`);
}

// 报告里若存在「越界集号」，提示口径问题
if (report.seasons.some((r) => r.extra.length)) {
  console.log('\n提示：出现越界集号 ⇒ 库内季划分与 TMDB 口径不一致，'
    + '先把逐季集数对照表摊给用户确认口径，再决定是否重排。');
}
