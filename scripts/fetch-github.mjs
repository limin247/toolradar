#!/usr/bin/env node
// 抓取 GitHub 真实仓库元数据 -> data/raw/*.json + data/snapshots/<date>.json
// 用法: node scripts/fetch-github.mjs [--pages=1] [--pace=7000]
// 无 token 时走公共搜索 API（10 次/分钟），自带节流与 403/429 退避重试。
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const SNAP = path.join(ROOT, 'data', 'snapshots');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const PACE = Number(args.pace ?? 7000);
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const dayAgo = (n) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - n);
  return iso(d);
};
const WEEK = dayAgo(7);
const MONTH = dayAgo(30);

// 每个 query 抓 100 条（搜索 API 单页上限）
const QUERIES = [
  { id: 'hall-of-fame', q: `stars:>60000` },
  { id: 'new-week', q: `created:>${WEEK} stars:>10` },
  { id: 'new-month', q: `created:>${MONTH} stars:>80` },
  { id: 'cli', q: `topic:cli stars:>1500` },
  { id: 'developer-tools', q: `topic:developer-tools stars:>2000` },
  { id: 'productivity', q: `topic:productivity stars:>1200` },
  { id: 'llm', q: `topic:llm stars:>2500` },
  { id: 'devops', q: `topic:devops stars:>2000` },
  { id: 'frontend', q: `topic:frontend stars:>2000` },
  { id: 'testing', q: `topic:testing stars:>800` },
  { id: 'security', q: `topic:security stars:>2500` },
  { id: 'database', q: `topic:database stars:>2000` },
  { id: 'self-hosted', q: `topic:self-hosted stars:>3000` },
  { id: 'design', q: `topic:design stars:>800` },
  { id: 'agents', q: `topic:ai-agents stars:>800` },
  { id: 'docs', q: `topic:documentation stars:>1000` },
  { id: 'awesome', q: `topic:awesome stars:>15000` },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(q, page = 1) {
  const url = new URL('https://api.github.com/search/repositories');
  url.searchParams.set('q', q);
  url.searchParams.set('sort', 'stars');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', '100');
  url.searchParams.set('page', String(page));
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'toolradar-fetch',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const json = await res.json();
      return { items: json.items ?? [], total: json.total_count ?? 0 };
    }
    const body = await res.text();
    const wait = 15000 * (attempt + 1);
    console.warn(`  ! ${res.status} ${q} -> 等待 ${wait}ms 重试 (${body.slice(0, 120)})`);
    if (res.status !== 403 && res.status !== 429 && res.status < 500) {
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    await sleep(wait);
  }
  throw new Error(`放弃: ${q}`);
}

// 只留页面真正会用的字段，压缩体积
function slim(r) {
  return {
    full_name: r.full_name,
    name: r.name,
    owner: r.owner?.login,
    html_url: r.html_url,
    description: r.description ?? '',
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    open_issues: r.open_issues_count ?? 0,
    language: r.language ?? null,
    license: r.license?.spdx_id ?? null,
    topics: r.topics ?? [],
    created_at: r.created_at,
    pushed_at: r.pushed_at,
    archived: !!r.archived,
    homepage: r.homepage ?? null,
  };
}

const main = async () => {
  await fs.mkdir(RAW, { recursive: true });
  await fs.mkdir(SNAP, { recursive: true });
  const store = {};
  const meta = { fetchedAt: new Date().toISOString(), queries: {}, tokenUsage: TOKEN ? 'token' : 'anonymous' };

  for (const [i, { id, q }] of QUERIES.entries()) {
    if (i > 0) await sleep(PACE);
    process.stdout.write(`[${i + 1}/${QUERIES.length}] ${id}: ${q} … `);
    const { items, total } = await search(q);
    const rows = items.map(slim);
    store[id] = rows;
    meta.queries[id] = { q, returned: rows.length, total };
    console.log(`${rows.length} 条 (total ${total})`);
    await fs.writeFile(path.join(RAW, `${id}.json`), JSON.stringify(rows, null, 0));
  }

  await fs.writeFile(path.join(SNAP, `${iso(today)}.json`), JSON.stringify(store));

  // 历史快照索引：用于页面上的「真实上升榜」（Δstars）
  const files = (await fs.readdir(SNAP)).filter((f) => f.endsWith('.json')).sort();
  meta.snapshots = files.map((f) => f.replace(/\.json$/, ''));
  await fs.writeFile(path.join(RAW, '_meta.json'), JSON.stringify(meta, null, 2));

  // 跨快照增量的原始数据（只保留能在两个快照里同时出现的仓库）
  if (files.length >= 2) {
    const prev = JSON.parse(await fs.readFile(path.join(SNAP, files.at(-2)), 'utf8'));
    const cur = JSON.parse(await fs.readFile(path.join(SNAP, files.at(-1)), 'utf8'));
    const flat = (s) => {
      const m = new Map();
      for (const rows of Object.values(s)) for (const r of rows) if (!m.has(r.full_name)) m.set(r.full_name, r);
      return m;
    };
    const a = flat(prev), b = flat(cur);
    const delta = [];
    for (const [k, v] of b) {
      const old = a.get(k);
      if (!old) continue;
      const d = v.stars - old.stars;
      if (d !== 0) delta.push({ full_name: k, delta: d, prev: old.stars, now: v.stars });
    }
    delta.sort((x, y) => y.delta - x.delta);
    await fs.writeFile(
      path.join(RAW, '_delta.json'),
      JSON.stringify({ from: files.at(-2).replace(/\.json$/, ''), to: files.at(-1).replace(/\.json$/, ''), delta }, null, 2),
    );
    console.log(`Δ stars: ${delta.length} 个仓库在两个快照间有变化`);
  }

  const uniq = new Set();
  for (const rows of Object.values(store)) for (const r of rows) uniq.add(r.full_name);
  console.log(`\n去重后 ${uniq.size} 个仓库，原始数据在 data/raw/`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
