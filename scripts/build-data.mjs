#!/usr/bin/env node
// 合并「人工策展的编辑信息」+「抓取到的真实元数据」-> data/tools.json
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data', 'tools.json');

const curated = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'curated.json'), 'utf8'));
const meta = JSON.parse(await fs.readFile(path.join(RAW, '_meta.json'), 'utf8'));

// 1. 收集所有抓到的仓库
const pool = new Map();
for (const f of await fs.readdir(RAW)) {
  if (!f.endsWith('.json') || f.startsWith('_')) continue;
  for (const r of JSON.parse(await fs.readFile(path.join(RAW, f), 'utf8'))) {
    const prev = pool.get(r.full_name);
    if (!prev || r.stars > prev.stars) pool.set(r.full_name, { ...r, _src: f.replace('.json', '') });
  }
}

// 2. 未策展的新仓库（周榜/月榜原始条目）：按 topic 猜场景，猜不到就归入 collections 之外的「其他」
// 只做「高置信」猜测，宁可不归类也不乱归类（未归类的进 misc，并在页面上说明）
const KEYS = [
  ['security', /\b(security|pentest|malware|exploit|ctf|cryptography|osint|vulnerabilit(y|ies)|zero-trust)\b/i],
  ['database', /\b(database|sql|postgres|postgresql|sqlite|redis|orm|vector-database|key-value)\b/i],
  ['devops', /\b(devops|docker|kubernetes|k8s|ci-cd|deployment|infrastructure|terraform|monitoring|observability)\b/i],
  ['testing', /\b(testing|test-runner|e2e|end-to-end|unit-test|linter|fuzzing)\b/i],
  ['docs', /\b(documentation|wiki|markdown|note-taking|knowledge-base)\b/i],
  ['frontend', /\b(react|vue|svelte|nextjs|webgl|canvas|web-components|tailwind|design-system|figma|ui-kit|icons|typography|css-framework|svg|animation)\b/i],
  ['ai-coding', /\b(coding-agent|claude-code|codex|copilot|llm-coding|code-assistant)\b/i],
  ['dataai', /\b(llm|agents?|rag|fine-?tuning|inference|machine-learning|deep-learning|diffusion|embeddings?)\b/i],
  ['terminal', /\b(cli|shell|terminal|tui|command-line|dotfiles)\b/i],
  ['selfhosted', /\b(self-hosted|selfhosted|homelab|nas|personal-cloud)\b/i],
  ['productivity', /\b(productivity|todo|task-management|calendar|launcher|note-taking)\b/i],
  ['learn', /\b(tutorial|course|learning|roadmap|interview|cheat-?sheet|awesome-list)\b/i],
];
const guess = (r) => {
  // 只信「仓库名 + topics」这类有人主动打的标签；description 是营销文案，噪声太大
  const hay = `${r.name} ${r.topics.join(' ')}`;
  for (const [id, re] of KEYS) if (re.test(hay)) return id;
  return 'misc';
};

const today = new Date().toISOString();

// 未归类条目单独成组，不假装它们属于某个工作场景
const scenarios = [...curated.scenarios];
if (!scenarios.some((s) => s.id === 'misc')) {
  scenarios.push({
    id: 'misc',
    name: '未归类新库',
    en: 'Unsorted',
    blurb: '本周/本月榜单里还没做人工归类的仓库。它们大多是刚冒头的新项目，只保留 GitHub 原厂描述——归类留给下一轮编辑。',
    accent: '#8b949e',
  });
}
const toTool = (r, extra) => ({
  repo: r.full_name,
  name: r.name,
  owner: r.owner,
  url: r.html_url,
  desc: r.description || '',
  stars: r.stars,
  forks: r.forks,
  lang: r.language,
  license: r.license,
  topics: r.topics.slice(0, 8),
  created: r.created_at.slice(0, 10),
  pushed: r.pushed_at.slice(0, 10),
  homepage: r.homepage,
  archived: r.archived,
  ...extra,
});

// 3. 策展条目
const missing = [];
const tools = [];
const seen = new Set();
for (const c of curated.tools) {
  const r = pool.get(c.r);
  if (!r) { missing.push(c.r); continue; }
  if (seen.has(c.r)) { console.warn(`重复: ${c.r}`); continue; }
  seen.add(c.r);
  tools.push(toTool(r, { scenario: c.s, zh: c.z, tags: c.t || [], fit: c.f || null, curated: true }));
}

// 4. 周榜 / 月榜的原始条目（未被策展的也保留，保证榜单是「真·抓取结果」）
const boardOnly = new Set();
for (const src of ['new-week', 'new-month']) {
  const rows = JSON.parse(await fs.readFile(path.join(RAW, `${src}.json`), 'utf8'));
  for (const r of rows) {
    if (seen.has(r.full_name)) continue;
    if (boardOnly.has(r.full_name)) continue;
    const hit = pool.get(r.full_name) ?? r;
    boardOnly.add(r.full_name);
    tools.push(toTool(hit, {
      scenario: guess(hit),
      zh: null,
      tags: hit.topics.slice(0, 3),
      fit: null,
      curated: false,
    }));
  }
}

// 5. Δstars（需要两次以上快照）
let delta = null;
try {
  const d = JSON.parse(await fs.readFile(path.join(RAW, '_delta.json'), 'utf8'));
  delta = d;
} catch {}

const ids = new Set(scenarios.map((s) => s.id));
const orphans = tools.filter((t) => !ids.has(t.scenario));
if (orphans.length) {
  console.warn(`警告: ${orphans.length} 条场景 id 不在 scenarios 里 -> ${[...new Set(orphans.map((o) => o.scenario))].join(',')}`);
  for (const o of orphans) o.scenario = 'misc';
}

const out = {
  generatedAt: today,
  snapshot: meta.fetchedAt.slice(0, 10),
  queries: meta.queries,
  snapshots: meta.snapshots || [],
  scenarios,
  delta,
  stats: {
    curated: tools.filter((t) => t.curated).length,
    total: tools.length,
    sources: Object.keys(meta.queries).length,
  },
  tools,
};

const json = JSON.stringify(out);
await fs.writeFile(OUT, json);

// 同时写一份 JS：让它能被 <script src> 直接加载，双击 index.html 也能用（file:// 下 fetch 本地 json 会被 CORS 挡）
await fs.writeFile(
  path.join(ROOT, 'data', 'tools.js'),
  `/* 自动生成，勿手改 — 由 scripts/build-data.mjs 输出 */\nwindow.TOOLRADAR_DATA = ${json};\n`,
);

console.log(`tools.json + tools.js: ${out.stats.total} 个仓库（策展 ${out.stats.curated}），${(json.length / 1024).toFixed(0)}KB`);
if (missing.length) {
  console.error(`\n!! curated 里这些仓库没抓到，需要改名或删除（${missing.length}）:`);
  for (const m of missing.sort()) console.error('   ' + m);
  process.exitCode = 2;
}
