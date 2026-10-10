#!/usr/bin/env node
/**
 * gen-rename-plan —— 生成「原名 → TMDB 规范名」的改名方案，并在本地先校验一遍
 *
 * 只处理剧集（需要 SxxEyy）。电影改名规则很简单，手工做即可。
 *
 * 用法：
 *   node scripts/gen-rename-plan.mjs --library local.jsonl --tmdb tmdb.json \
 *        --show "Bluey" [--ep-pad 2] [--out plan.tsv]
 *
 * 可选（输入是网盘列表产物 .jsonl、且想直接产出整理方案时）：
 *   --proposal plan.json --to-fid "<目标 Season 目录 FID>"
 *
 * 输出：TSV（season / 原名 / 新名），以及跳过清单与原因。
 */

import fs from 'node:fs';
import {
  parseArgs, parseEpisodeName, loadNames, loadTmdb, buildName, extname,
  ILLEGAL_CHARS, MAX_NAME_LEN,
} from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));

if (!args.library || !args.tmdb || !args.show || args.help) {
  console.log(`用法: node scripts/gen-rename-plan.mjs --library <库内清单> --tmdb <TMDB分集> --show "<剧名>" [选项]

  --library   库内文件清单：.jsonl（网盘列表产物）/.json/.txt
  --tmdb      TMDB 分集数据
  --show      剧名（会写进新文件名，如 "Bluey"）
  --ep-pad    集号位数，默认 2（老资源可能要 3）
  --out       把映射表写成 TSV
  --proposal  额外输出整理方案 JSON（需 .jsonl 输入且带 fid/parent_fid）
  --to-fid    整理方案的目标目录 FID（配合 --proposal 使用）`);
  process.exit(args.help ? 0 : 1);
}

const epPad = Number(args['ep-pad'] ?? 2);
const names = loadNames(args.library);
const tmdb = loadTmdb(args.tmdb);

const planned = [];
const skipped = [];
const conflicts = [];
const warnings = [];
const unchanged = [];
const seen = new Map(); // "season::newName" -> oldName

for (const name of names) {
  const p = parseEpisodeName(name);
  if (!p) { skipped.push([name, '没有 SxxEyy 集号']); continue; }

  const eps = tmdb.get(String(p.season));
  if (!eps) { skipped.push([name, `TMDB 数据里没有第 ${p.season} 季`]); continue; }

  const titles = [];
  const missing = [];
  for (let n = p.from; n <= p.to; n++) {
    const e = eps.find((x) => x.n === n);
    if (!e || !e.title) { missing.push(n); continue; }
    titles.push(e.title);
  }
  if (missing.length) {
    skipped.push([name, `TMDB 第 ${p.season} 季没有集号 ${missing.join(',')}`]);
    continue;
  }

  const newName = buildName({
    show: args.show, season: p.season, from: p.from, to: p.to,
    titles, ext: extname(name), epPad,
  });

  const bad = newName.match(ILLEGAL_CHARS);
  if (bad) { skipped.push([name, `新名含非法字符 "${bad[0]}"`]); continue; }
  if (newName.length > MAX_NAME_LEN) { skipped.push([name, `新名超长 ${newName.length}`]); continue; }

  // 原文件名同样是接口的校验对象，而我们无法改写它 —— 提前预警，
  // 否则整批会被拒，且校验器一次只报第一个错，很难排查。
  const badOrigin = name.match(ILLEGAL_CHARS);
  if (badOrigin) {
    warnings.push([
      name,
      `原文件名含非法字符 "${badOrigin[0]}"；新名已清洗，但提交前需先对原名做一次预清洗改名`,
    ]);
  }

  if (newName === name) { unchanged.push(name); continue; }

  const key = `${p.season}::${newName}`;
  if (seen.has(key)) { conflicts.push([name, seen.get(key), newName]); continue; }
  seen.set(key, name);

  planned.push({ season: p.season, old: name, new: newName });
}

planned.sort((a, b) => a.season - b.season || a.old.localeCompare(b.old));

console.log(`=== 改名方案 ===`);
console.log(`输入 ${names.length} 个文件 → 需改 ${planned.length} 个，已合规 ${unchanged.length} 个，`
  + `跳过 ${skipped.length} 个，预警 ${warnings.length} 条，冲突 ${conflicts.length} 个\n`);

const width = Math.min(120, Math.max(20, ...planned.map((r) => r.old.length)));
for (const r of planned) {
  console.log(`S${String(r.season).padStart(2, '0')}  ${r.old.padEnd(width)}  →  ${r.new}`);
}

if (skipped.length) {
  console.log(`\n⚠️ 跳过 ${skipped.length} 个（未生成改名计划）：`);
  for (const [n, why] of skipped) console.log(`   ${n}\n      ↳ ${why}`);
}

if (warnings.length) {
  console.log(`\n⚠️ 预警 ${warnings.length} 条（不阻断，但提交前要处理）：`);
  for (const [n, why] of warnings) console.log(`   ${n}\n      ↳ ${why}`);
}

if (conflicts.length) {
  console.log(`\n❌ 同季重名冲突 ${conflicts.length} 组（映射可疑，先查清再提交）：`);
  for (const [a, b, n] of conflicts) console.log(`   "${n}"\n      ← ${a}\n      ← ${b}`);
}

// 可选：产出整理方案
if (args.proposal) {
  if (!args['to-fid']) {
    console.error('\n❌ --proposal 需要同时提供 --to-fid（目标目录 FID）');
    process.exit(2);
  }
  const raw = fs.readFileSync(args.library, 'utf8').split(/\r?\n/).filter(Boolean);
  const byName = new Map();
  for (const line of raw) {
    try {
      const o = JSON.parse(line);
      if (o.filename) byName.set(o.filename, o);
    } catch { /* 忽略 */ }
  }

  const items = [];
  const noFid = [];
  for (const r of planned) {
    const rec = byName.get(r.old);
    if (!rec || !rec.fid || !rec.parent_fid) { noFid.push(r.old); continue; }
    items.push({ fid: rec.fid, parent_fid: rec.parent_fid, origin_name: r.old, new_name: r.new });
  }
  const proposal = { version: 4, new_folders: [], operations: [{ op: 'move', to: args['to-fid'], items }] };
  fs.writeFileSync(args.proposal, JSON.stringify(proposal, null, 2));
  console.log(`\n已写出整理方案: ${args.proposal}（${items.length} 项）`);
  if (noFid.length) {
    console.log(`⚠️ ${noFid.length} 项因清单里没有 fid/parent_fid 被排除 —— 请确认输入是网盘列表产物（.jsonl）`);
  }
  console.log('提示：提交前先跑工具的 check（校验）再 apply（执行）；注意原文件名也不能含非法字符。');
}

if (args.out) {
  const tsv = ['season\told_name\tnew_name', ...planned.map((r) => `${r.season}\t${r.old}\t${r.new}`)].join('\n');
  fs.writeFileSync(args.out, tsv + '\n');
  console.log(`\n已写出映射表: ${args.out}`);
}
