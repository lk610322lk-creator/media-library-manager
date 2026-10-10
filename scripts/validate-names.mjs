#!/usr/bin/env node
/**
 * validate-names —— 校验一份文件名清单是否符合命名规范
 *
 * 检查项：① 是否符合「剧名 - SxxEyy - 标题.ext」 ② 非法字符 ③ 长度上限
 *         ④ 同季集号重复 ⑤ 集号空洞 ⑥ 剧名是否写对
 *
 * 用法：
 *   node scripts/validate-names.mjs --files names.txt --show "Bluey" [--ep-pad 2]
 */

import {
  parseArgs, parseEpisodeName, loadNames, ILLEGAL_CHARS, MAX_NAME_LEN,
} from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));

if (!args.files || args.help) {
  console.log(`用法: node scripts/validate-names.mjs --files <文件名清单> [--show "<剧名>"] [--ep-pad 2]

  --files    文件名清单：.jsonl / .json / .txt
  --show     期望的剧名前缀，给了就一起校验
  --ep-pad   期望的集号位数，默认 2`);
  process.exit(args.help ? 0 : 1);
}

const show = typeof args.show === 'string' ? args.show : null;
const epPad = Number(args['ep-pad'] ?? 2);
const names = loadNames(args.files);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = show
  ? new RegExp(`^${esc(show)}\\s+-\\s+S\\d{${epPad}}E\\d{${epPad}}(?:-E\\d{${epPad}})?\\s+-\\s+.+\\.[A-Za-z0-9]{1,5}$`)
  : new RegExp(`^.+\\s+-\\s+S\\d{${epPad}}E\\d{${epPad}}(?:-E\\d{${epPad}})?\\s+-\\s+.+\\.[A-Za-z0-9]{1,5}$`);

const problems = [];
const bySeason = new Map();

for (const n of names) {
  if (!pattern.test(n)) problems.push([n, '不符合「剧名 - SxxEyy - 标题.ext」']);
  const bad = n.match(ILLEGAL_CHARS);
  if (bad) problems.push([n, `含非法字符 "${bad[0]}"`]);
  if (n.length > MAX_NAME_LEN) problems.push([n, `超长 ${n.length} > ${MAX_NAME_LEN}`]);

  const p = parseEpisodeName(n);
  if (p) {
    if (!bySeason.has(p.season)) bySeason.set(p.season, []);
    for (let i = p.from; i <= p.to; i++) bySeason.get(p.season).push({ ep: i, name: n });
  }
}

// 集号重复 / 空洞
for (const [season, list] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
  const counts = new Map();
  for (const { ep, name } of list) {
    if (!counts.has(ep)) counts.set(ep, []);
    counts.get(ep).push(name);
  }
  for (const [ep, arr] of counts) {
    if (arr.length > 1) {
      problems.push([`S${String(season).padStart(2, '0')}E${String(ep).padStart(2, '0')}`, `集号重复 ${arr.length} 次：${arr.join(' | ')}`]);
    }
  }
  const nums = [...counts.keys()].sort((a, b) => a - b);
  const holes = [];
  for (let i = nums[0]; i <= nums[nums.length - 1]; i++) if (!counts.has(i)) holes.push(i);
  if (holes.length) {
    problems.push([`S${String(season).padStart(2, '0')}`, `集号空洞：${holes.map((h) => 'E' + String(h).padStart(2, '0')).join(', ')}（须能解释，见 pitfalls.md）`]);
  }
}

console.log(`=== 命名校验 ===`);
console.log(`文件数 ${names.length}${show ? `   剧名期望 "${show}"` : ''}   集号位数 ${epPad}\n`);

if (!problems.length) {
  console.log('✅ 全部通过');
} else {
  console.log(`❌ ${problems.length} 处问题：`);
  for (const [where, why] of problems) console.log(`   ${where}\n      ↳ ${why}`);
}

process.exit(problems.length ? 1 : 0);
