/* 工具雷达 — 交互层
   状态：board / scene / q / sort / favOnly，全部可写进 URL hash。
   数据：window.TOOLRADAR_DATA（由 scripts/build-data.mjs 生成） */
(() => {
  'use strict';

  const D = window.TOOLRADAR_DATA;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  if (!D || !D.tools) {
    document.body.innerHTML =
      '<div style="padding:4rem;font:16px/1.7 system-ui;color:#ccc;background:#07080a;min-height:100vh">' +
      '<h1 style="font-size:1.4rem">数据没加载</h1><p>先跑 <code>node scripts/build-data.mjs</code> 生成 ' +
      '<code>data/tools.js</code>，再刷新。</p></div>';
    return;
  }

  // ---------- 基础工具 ----------
  const SNAP = new Date(D.snapshot + 'T00:00:00Z');
  const DAY = 864e5;
  const daysSince = (iso) => (iso ? Math.floor((SNAP - new Date(iso)) / DAY) : 9999);

  const fmt = (n) =>
    n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
      : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
        : String(n ?? 0);

  const ago = (d) =>
    d <= 0 ? '今天' : d === 1 ? '昨天' : d < 30 ? `${d} 天前`
      : d < 365 ? `${Math.floor(d / 30)} 个月前` : `${Math.floor(d / 365)} 年前`;

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SCEN = new Map(D.scenarios.map((s) => [s.id, s]));
  const accentOf = (id) => SCEN.get(id)?.accent || '#ffb454';
  const scenName = (id) => SCEN.get(id)?.name || id;

  // ---------- 榜单定义 ----------
  const BOARDS = [
    { id: 'stars', name: '星标总榜', note: '全站存量，按星数', test: () => true },
    { id: 'week', name: '本周新星', note: '7 天内创建的新仓库', test: (t) => daysSince(t.created) <= 7 },
    { id: 'month', name: '本月新星', note: '30 天内创建的新仓库', test: (t) => daysSince(t.created) <= 30 },
    { id: 'active', name: '活跃榜', note: '7 天内有提交，按星数', test: (t) => daysSince(t.pushed) <= 7 },
    { id: 'rising', name: '上升榜', note: '两次快照之间的 Δstars', test: () => true },
  ];
  const boardOf = (id) => BOARDS.find((b) => b.id === id) || BOARDS[0];

  // 预计算：每个榜单的候选集合（不含搜索/场景筛选，用于 tab 上的数字）
  const poolCache = new Map();
  function pool(boardId) {
    if (poolCache.has(boardId)) return poolCache.get(boardId);
    const b = boardOf(boardId);
    const list = D.tools.filter(b.test);
    poolCache.set(boardId, list);
    return list;
  }

  const deltaOf = (repo) => {
    if (!D.delta) return null;
    const map = D.delta.delta || D.delta.stars || D.delta;
    const v = map?.[repo];
    if (typeof v === 'number') return v;
    if (v && typeof v.delta === 'number') return v.delta;
    return null;
  };

  // ---------- 状态 ----------
  const LS = 'toolradar.favs.v1';
  const favs = new Set(safeParse(localStorage.getItem(LS), []));
  const cmp = []; // 对比列表，最多 3

  const state = { board: 'stars', scene: 'all', q: '', sort: 'board', favOnly: false };

  function safeParse(s, fb) { try { return JSON.parse(s) ?? fb; } catch { return fb; } }

  // ---------- 派生 ----------
  function derive() {
    const b = boardOf(state.board);
    let list = pool(state.board);

    if (state.scene !== 'all') {
      list = state.scene === 'uncategorized'
        ? list.filter((t) => !t.curated)
        : list.filter((t) => t.scenario === state.scene);
    }
    if (state.favOnly) list = list.filter((t) => favs.has(t.repo));

    if (state.q.trim()) {
      const toks = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((t) => {
        const hay = `${t.repo} ${t.name} ${t.zh || ''} ${t.desc || ''} ${(t.tags || []).join(' ')} ${(t.topics || []).join(' ')} ${scenName(t.scenario)}`.toLowerCase();
        return toks.every((k) => hay.includes(k));
      });
    }

    const mode = state.sort === 'board' ? (state.board === 'rising' ? 'delta' : 'stars') : state.sort;
    const cmpFn = {
      stars: (a, b2) => b2.stars - a.stars,
      delta: (a, b2) => (deltaOf(b2.repo) ?? -1e9) - (deltaOf(a.repo) ?? -1e9) || b2.stars - a.stars,
      recent: (a, b2) => (b2.pushed || '').localeCompare(a.pushed || ''),
      new: (a, b2) => (b2.created || '').localeCompare(a.created || ''),
      name: (a, b2) => a.name.localeCompare(b2.name, 'en'),
    }[mode] || ((a, b2) => b2.stars - a.stars);

    return list.sort(cmpFn);
  }

  // ---------- 渲染：统计 ----------
  function renderStats() {
    const week = pool('week').length;
    const active = pool('active').length;
    const cells = [
      [D.stats.total, '收录仓库'],
      [D.scenarios.length, '工作场景'],
      [week, '本周新建'],
      [active, '近 7 天有提交'],
      [D.stats.curated, '人工策展'],
    ];
    $('#stats').innerHTML = cells
      .map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`)
      .join('');
    $('#footSnap').textContent = D.snapshot;
    // 数据会过时，那就让它显形：超过 4 天没刷新就把快照 pill 标成琥珀色
    // 注意：daysSince 是相对「快照日」算的（用来显示「更新 2 天前」），判断新鲜度必须用真实今天
    const age = Math.floor((Date.now() - new Date(D.snapshot)) / 864e5);
    const stale = age >= 4;
    const pill = $('#snapshotPill');
    pill.innerHTML = `快照 <b>${D.snapshot}</b>${stale ? ` · 已 ${age} 天` : ''}`;
    pill.classList.toggle('stale', stale);
    pill.title = stale
      ? `数据已经 ${age} 天没更新。跑 node scripts/fetch-github.mjs && node scripts/build-data.mjs 刷新，或让 .github/workflows/refresh-data.yml 每天自动跑。`
      : '数据抓取时间';
  }

  // ---------- 渲染：榜单 tab ----------
  function renderBoards() {
    $('#boards').innerHTML = BOARDS.map((b, i) => {
      const n = b.id === 'rising' ? (D.delta ? pool('rising').filter((t) => deltaOf(t.repo) !== null).length : 0) : pool(b.id).length;
      return `<button class="board-tab" role="tab" data-board="${b.id}" title="${esc(b.note)} · 按 ${i + 1}"
        aria-selected="${state.board === b.id}">${b.name}<span class="n">${n}</span></button>`;
    }).join('');
  }

  // ---------- 渲染：场景条 ----------
  function renderRail() {
    const counts = new Map();
    for (const t of D.tools) counts.set(t.scenario, (counts.get(t.scenario) || 0) + 1);
    const items = [
      `<button class="scene" data-scene="all" aria-pressed="${state.scene === 'all'}"><i></i>全部<b>${D.tools.length}</b></button>`,
      ...D.scenarios
        .filter((s) => counts.get(s.id))
        .map((s) => `<button class="scene" data-scene="${s.id}" style="--dot:${s.accent}" aria-pressed="${state.scene === s.id}"><i></i>${esc(s.name)}<b>${counts.get(s.id)}</b></button>`),
    ];
    $('#rail').innerHTML = items.join('');
  }

  // ---------- 渲染：场景说明 ----------
  function renderNote(count) {
    const el = $('#sceneNote');
    const s = state.scene === 'all' ? null : SCEN.get(state.scene);
    if (!s) { el.hidden = true; return; }
    el.hidden = false;
    el.style.setProperty('--a', s.accent);
    // 周榜/月榜 × 单个场景本来就只剩个位数，少于 4 条时明说并给出口，而不是让页面显得像坏了
    const thin = count > 0 && count < 4 && (state.board === 'week' || state.board === 'month') && !state.q.trim();
    const alts = state.board === 'week'
      ? [['month', '本月新星'], ['stars', '星标总榜']]
      : [['stars', '星标总榜'], ['active', '活跃榜']];
    el.innerHTML = `<div><h2>${esc(s.name)}<em>${esc(s.en)}</em></h2><p>${esc(s.blurb)}</p></div>`
      + (thin
        ? `<div class="note-alt"><span>这里只有 ${count} 个仓库 —— 7 天/30 天内新建的项目本来就少，不是页面坏了。</span>`
          + alts.map(([id, label]) => `<button class="note-btn" data-goto-board="${id}">看${label}</button>`).join('')
          + `</div>`
        : '');
  }

  // ---------- 渲染：主列表 ----------
  function render() {
    const list = derive();
    const maxStars = list.reduce((m, t) => Math.max(m, t.stars), 1);
    const showSpot = !state.q.trim() && !state.favOnly && list.length >= 3;
    const spot = showSpot ? list.slice(0, 3) : [];
    const rest = showSpot ? list.slice(3) : list;

    // 场景说明
    renderNote(list.length);

    // top3
    const spotEl = $('#spotlight');
    spotEl.hidden = spot.length === 0;
    spotEl.innerHTML = spot
      .map((t, i) => {
        const a = accentOf(t.scenario);
        return `<button class="spot" data-repo="${esc(t.repo)}" data-rank="0${i + 1}" style="--a:${a}">
        <div class="spot-top">
          <span class="spot-badge">${'0' + (i + 1)} · ${esc(scenName(t.scenario))}</span>
          <span class="spot-stars"><span>★</span>${fmt(t.stars)}</span>
        </div>
        <h3>${esc(t.name)}</h3>
        <p class="zh">${t.zh ? esc(t.zh) : esc(t.desc || '—')}</p>
        <div class="tags">${(t.tags || []).slice(0, 2).map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>
        <div class="spot-foot">${esc(t.owner)} · 更新 ${ago(daysSince(t.pushed))}</div>
      </button>`;
      })
      .join('');

    // 列表
    const listEl = $('#list');
    listEl.innerHTML = rest
      .map((t, i) => {
        const rank = i + (showSpot ? 4 : 1);
        const a = accentOf(t.scenario);
        const w = Math.max(3, Math.round(Math.sqrt(t.stars / maxStars) * 100));
        const fav = favs.has(t.repo);
        const inCmp = cmp.includes(t.repo);
        const dal = deltaOf(t.repo);
        return `<li class="row${rank <= 3 ? ' top3' : ''}" tabindex="0" data-repo="${esc(t.repo)}" style="--a:${a}">
        <span class="rank">${rank}</span>
        <div class="row-main">
          <div class="row-title">
            <span class="row-name">${esc(t.name)}</span>
            <span class="row-id">${esc(t.owner)}${t.archived ? ' · 已归档' : ''}</span>
          </div>
          <p class="row-zh${t.zh ? '' : ' raw'}">${t.zh ? esc(t.zh) : `<span class="raw-tag">原厂描述</span>${esc(t.desc || '暂无描述')}`}</p>
          ${t.tags && t.tags.length ? `<div class="tags">${t.tags.slice(0, 3).map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="row-side">
          <div class="meta">
            <span class="star">★ ${fmt(t.stars)}</span>
            ${dal !== null ? `<span style="color:var(--good)">${dal > 0 ? '+' : ''}${fmt(dal)}</span>` : ''}
            ${t.lang ? `<span class="lang"><i></i>${esc(t.lang)}</span>` : ''}
            <span>${ago(daysSince(t.pushed))}</span>
          </div>
          <div class="bar"><i style="width:${w}%"></i></div>
          <div class="row-foot">
            <button class="act${fav ? ' on' : ''}" data-act="fav" aria-pressed="${fav}" title="收藏 (f)">${fav ? '★' : '☆'}</button>
            <button class="act${inCmp ? ' on cmp' : ''}" data-act="cmp" title="加入对比 (c)">${inCmp ? '✓ 对比' : '⧉ 对比'}</button>
            <a class="act" href="${esc(t.url)}" target="_blank" rel="noopener" data-act="gh" title="在 GitHub 打开">↗</a>
          </div>
        </div>
      </li>`;
      })
      .join('');

    // 空 / 上升榜说明
    const empty = list.length === 0;
    $('#empty').hidden = !empty;
    $('#list').hidden = empty;
    $('#spotlight').hidden = empty || !showSpot;

    const risingBlocked = state.board === 'rising' && !D.delta;
    $('#risingHelp').hidden = !risingBlocked;
    if (risingBlocked) { $('#empty').hidden = true; $('#list').hidden = true; spotEl.hidden = true; }

    if (empty && !risingBlocked) {
      const acts = [];
      if (state.q.trim()) acts.push(['clear-q', '清空搜索']);
      if (state.favOnly) acts.push(['fav-off', '关掉「只看收藏」']);
      if (state.scene !== 'all') acts.push(['all-scene', '看全部场景']);
      if (state.board === 'week') acts.push(['board-month', '看本月新星'], ['board-stars', '看星标总榜']);
      else if (state.board === 'month') acts.push(['board-stars', '看星标总榜'], ['board-active', '看活跃榜']);

      $('#emptyTitle').textContent = state.board === 'week' || state.board === 'month'
        ? '这个场景这个时间段没有新库'
        : '这个组合下没有工具';
      $('#emptyBody').textContent = state.favOnly
        ? '你还没收藏这个范围里的工具。点列表右侧的 ☆ 收藏，或者关掉「只看收藏」。'
        : state.board === 'week' || state.board === 'month'
          ? `快照日 ${D.snapshot} 往前推 ${state.board === 'week' ? 7 : 30} 天，这个场景没有新仓库进榜——不是页面坏了，是新库本来就少。`
          : state.q.trim()
            ? state.scene === 'all'
              ? `没有找到匹配“${state.q}”的工具。换个关键词试试。`
              : `“${state.q}”在「${(D.scenarios.find((s) => s.id === state.scene) || {}).name || '这个场景'}」里没有匹配。`
            : '这个组合下没有工具。';
      $('#emptyActs').innerHTML = acts
        .map(([k, label]) => `<button class="note-btn" data-quick="${k}">${label}</button>`)
        .join('');
    }

    // 对比条
    renderCompareBar();
    updateFavCount();
    syncHash();
    renderBoards();
    $('#sort').value = state.sort;
    $('#favOnly').setAttribute('aria-pressed', String(state.favOnly));
  }

  function updateFavCount() {
    $('#favCount').textContent = favs.size;
  }

  // ---------- 详情抽屉 ----------
  function openTool(repo) {
    const t = D.tools.find((x) => x.repo === repo);
    if (!t) return;
    const a = accentOf(t.scenario);
    const idx = derive().findIndex((x) => x.repo === repo);
    const rankTxt = idx >= 0 ? `当前榜单第 ${idx + 1} 位` : '不在当前榜单内';
    const fav = favs.has(repo);

    $('#drawerBody').innerHTML = `
      <div class="d-head" style="--a:${a}">
        <div class="d-eyebrow">${esc(scenName(t.scenario))} · ${rankTxt}</div>
        <h2 class="d-title" id="drawerTitle">${esc(t.name)}</h2>
        <div class="d-repo">${esc(t.repo)}</div>
        ${t.zh ? `<p class="d-zh">${esc(t.zh)}</p>` : ''}
        ${t.desc ? `<p class="d-desc">${t.zh ? '原厂描述：' : ''}${esc(t.desc)}</p>` : ''}
        ${t.fit ? `<div class="d-fit"><h5>怎么选</h5><p>${esc(t.fit)}</p></div>` : ''}
      </div>
      <dl class="d-grid">
        <div><dt>Stars</dt><dd>${t.stars.toLocaleString()}</dd></div>
        <div><dt>Forks</dt><dd>${t.forks.toLocaleString()}</dd></div>
        <div><dt>创建</dt><dd style="font-size:.8rem">${esc(t.created)}</dd></div>
        <div><dt>最近提交</dt><dd style="font-size:.8rem">${esc(t.pushed)}<small style="color:var(--ink-4)"> · ${ago(daysSince(t.pushed))}</small></dd></div>
        <div><dt>语言</dt><dd>${esc(t.lang || '—')}</dd></div>
        <div><dt>许可</dt><dd style="font-size:.78rem">${esc(t.license || '未标注')}</dd></div>
      </dl>
      ${(t.topics || []).length ? `<div class="tags">${t.topics.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : ''}
      <div class="d-actions">
        <a class="d-link" href="${esc(t.url)}" target="_blank" rel="noopener">在 GitHub 打开 ↗</a>
        <button class="btn btn-ghost" data-dact="fav">${fav ? '★ 已收藏' : '☆ 收藏'}</button>
        <button class="btn btn-ghost" data-dact="cmp">${cmp.includes(repo) ? '✓ 在对比里' : '⧉ 对比'}</button>
        <button class="btn btn-ghost" data-dact="copy">复制链接</button>
      </div>
      <p class="dim" style="margin-top:1.6rem;font-size:.72rem;font-family:var(--mono)">
        数据快照 ${D.snapshot} · ${t.curated ? '人工策展' : '未归类，保留原厂描述'}</p>`;

    $('#drawer').dataset.repo = repo;
    $('#drawer').hidden = false;
    $('#scrim').hidden = false;
    // 把辅助技术的焦点移进面板，但不让关闭按钮常亮一圈 focus 环
    const drawerEl = $('#drawer');
    drawerEl.setAttribute('tabindex', '-1');
    drawerEl.focus({ preventScroll: true });
  }

  function closeDrawer() {
    $('#drawer').hidden = true;
    if ($('#compareSheet').hidden && $('#helpSheet').hidden) $('#scrim').hidden = true;
  }

  // ---------- 对比 ----------
  function toggleCompare(repo, silent) {
    const i = cmp.indexOf(repo);
    if (i >= 0) cmp.splice(i, 1);
    else {
      if (cmp.length >= 3) { toast('最多同时对比 3 个'); return; }
      cmp.push(repo);
    }
    if (!silent) toast(i >= 0 ? '已移出对比' : '已加入对比');
    render();
    if (!$('#drawer').hidden) openTool($('#drawer').dataset.repo);
    if (!$('#compareSheet').hidden) openCompare();
  }

  function renderCompareBar() {
    const bar = $('#compareBar');
    // 注意：不要清 innerHTML —— #compareItems / #compareOpen / #compareClear 是静态节点，
    // 清掉它们会让后面的 innerHTML 赋值和已绑定的点击事件全部失效（踩过一次）
    if (!cmp.length) { bar.hidden = true; return; }
    bar.hidden = false;
    $('#compareItems').innerHTML = cmp.map((r) => `<span>${esc(r.split('/')[1] || r)}</span>`).join('');
  }

  function openCompare() {
    if (!cmp.length) return;
    const ts = cmp.map((r) => D.tools.find((t) => t.repo === r)).filter(Boolean);
    const row = (k, fn) => `<tr><td class="k">${k}</td>${ts.map((t) => `<td>${fn(t)}</td>`).join('')}</tr>`;
    $('#compareBody').innerHTML = `
      <h3 style="margin-bottom:1.2rem">并排对比</h3>
      <div style="overflow-x:auto">
      <table class="cmp">
        <thead><tr><th></th>${ts.map((t) => `<th><span class="cname">${esc(t.name)}<small>${esc(t.repo)}</small></span></th>`).join('')}</tr></thead>
        <tbody>
          ${row('场景', (t) => esc(scenName(t.scenario)))}
          ${row('定位', (t) => esc(t.zh || t.desc || '—'))}
          ${ts.some((t) => t.fit) ? row('怎么选', (t) => esc(t.fit || '—')) : ''}
          ${row('Stars', (t) => `<b>${t.stars.toLocaleString()}</b>`)}
          ${row('Forks', (t) => t.forks.toLocaleString())}
          ${row('语言', (t) => esc(t.lang || '—'))}
          ${row('许可', (t) => esc(t.license || '未标注'))}
          ${row('创建', (t) => esc(t.created))}
          ${row('最近提交', (t) => `${esc(t.pushed)} <span style="color:var(--ink-4)">(${ago(daysSince(t.pushed))})</span>`)}
          ${row('标签', (t) => (t.tags || []).map(esc).join(' · ') || '—')}
          ${row('', (t) => `<a class="act" style="color:var(--ink)" href="${esc(t.url)}" target="_blank" rel="noopener">打开 ↗</a>`)}
        </tbody>
      </table></div>`;
    $('#compareSheet').hidden = false;
    $('#scrim').hidden = false;
  }

  // ---------- toast ----------
  let toastT;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('on'), 1800);
  }

  // ---------- 收藏 ----------
  function toggleFav(repo) {
    if (favs.has(repo)) favs.delete(repo); else favs.add(repo);
    localStorage.setItem(LS, JSON.stringify([...favs]));
    render();
    if (!$('#drawer').hidden) openTool($('#drawer').dataset.repo);
    toast(favs.has(repo) ? '已收藏' : '已取消收藏');
  }

  // ---------- hash ----------
  function syncHash() {
    const p = new URLSearchParams();
    if (state.board !== 'stars') p.set('b', state.board);
    if (state.scene !== 'all') p.set('s', state.scene);
    if (state.q) p.set('q', state.q);
    if (state.sort !== 'board') p.set('o', state.sort);
    if (state.favOnly) p.set('f', '1');
    const h = p.toString() ? '#' + p.toString() : location.pathname;
    history.replaceState(null, '', h);
  }

  let pendingTool = null;
  let pendingCompare = null;

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('t')) pendingTool = p.get('t');
    if (p.get('c')) pendingCompare = p.get('c').split(',').filter(Boolean);
    if (p.get('b') && BOARDS.some((b) => b.id === p.get('b'))) state.board = p.get('b');
    if (p.get('s')) state.scene = p.get('s');
    if (p.get('q')) { state.q = p.get('q'); $('#q').value = state.q; }
    if (p.get('o')) state.sort = p.get('o');
    if (p.get('f') === '1') state.favOnly = true;
  }

  // ---------- 事件 ----------
  function bind() {
    $('#boards').addEventListener('click', (e) => {
      const b = e.target.closest('[data-board]');
      if (!b) return;
      state.board = b.dataset.board;
      render();
      window.scrollTo({ top: $('.sticky').offsetTop - 0, behavior: 'smooth' });
    });

    $('#rail').addEventListener('click', (e) => {
      const s = e.target.closest('[data-scene]');
      if (!s) return;
      state.scene = s.dataset.scene;
      render();
    });

    let qT;
    $('#q').addEventListener('input', (e) => {
      clearTimeout(qT);
      const v = e.target.value;
      qT = setTimeout(() => { state.q = v; render(); }, 90);
    });

    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

    $('#favOnly').addEventListener('click', () => {
      state.favOnly = !state.favOnly;
      render();
      if (state.favOnly && !favs.size) toast('还没有收藏，点 ☆ 试试');
    });

    $('#randomBtn').addEventListener('click', () => {
      const list = derive();
      if (!list.length) return toast('当前筛选是空的');
      const t = list[Math.floor(Math.random() * list.length)];
      openTool(t.repo);
    });

    // 列表交互
    const onRow = (e) => {
      const row = e.target.closest('.row');
      if (!row) return;
      const repo = row.dataset.repo;
      const act = e.target.closest('[data-act]');
      if (act) {
        e.stopPropagation();
        const kind = act.dataset.act;
        if (kind === 'gh') return; // 让链接自己跳转
        e.preventDefault();
        if (kind === 'fav') return toggleFav(repo);
        if (kind === 'cmp') return toggleCompare(repo);
        return;
      }
      openTool(repo);
    };
    $('#list').addEventListener('click', onRow);
    $('#list').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('row')) openTool(e.target.dataset.repo);
    });

    $('#spotlight').addEventListener('click', (e) => {
      const s = e.target.closest('[data-repo]');
      if (s) openTool(s.dataset.repo);
    });

    // 抽屉
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#scrim').addEventListener('click', () => { closeDrawer(); closeSheets(); });
    $('#drawer').addEventListener('click', (e) => {
      const a = e.target.closest('[data-dact]');
      if (!a) return;
      const repo = $('#drawer').dataset.repo;
      if (a.dataset.dact === 'fav') toggleFav(repo);
      if (a.dataset.dact === 'cmp') toggleCompare(repo);
      if (a.dataset.dact === 'copy') {
        navigator.clipboard?.writeText(location.origin + location.pathname + '#' + new URLSearchParams({ q: repo.split('/')[1] }).toString())
          .then(() => toast('链接已复制'), () => toast('复制失败'));
      }
    });

    // 对比
    $('#compareOpen').addEventListener('click', openCompare);
    $('#compareClear').addEventListener('click', () => { cmp.length = 0; render(); });
    $('#compareClose').addEventListener('click', closeSheets);

    // 帮助
    const openHelp = () => { $('#helpSheet').hidden = false; $('#scrim').hidden = false; };
    $('#helpBtn').addEventListener('click', openHelp);
    $('#helpClose').addEventListener('click', closeSheets);

    function closeSheets() {
      $('#compareSheet').hidden = true;
      $('#helpSheet').hidden = true;
      if ($('#drawer').hidden) $('#scrim').hidden = true;
    }

    // 键盘
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

      if (e.key === 'Escape') {
        if (!$('#compareSheet').hidden || !$('#helpSheet').hidden) return closeSheets();
        if (!$('#drawer').hidden) return closeDrawer();
        if (typing && $('#q').value) { $('#q').value = ''; state.q = ''; render(); }
        return;
      }
      if (typing) return;

      if (e.key === '/') { e.preventDefault(); $('#q').focus(); $('#q').select(); return; }
      if (e.key === '?') { e.preventDefault(); openHelp(); return; }

      if (/^[1-5]$/.test(e.key)) {
        const b = BOARDS[Number(e.key) - 1];
        if (b) { state.board = b.id; render(); }
        return;
      }

      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const rows = $$('.row');
        if (!rows.length) return;
        const cur = document.querySelector('.row[data-active="true"]');
        let i = cur ? rows.indexOf(cur) : -1;
        i = e.key === 'j' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
        rows.forEach((r) => r.removeAttribute('data-active'));
        rows[i].dataset.active = 'true';
        rows[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
        rows[i].focus({ preventScroll: true });
        return;
      }

      const active = document.querySelector('.row[data-active="true"]');
      if (!active) return;
      if (e.key === 'Enter') { openTool(active.dataset.repo); }
      if (e.key === 'f') { toggleFav(active.dataset.repo); }
      if (e.key === 'c') { toggleCompare(active.dataset.repo); }
    });

    window.addEventListener('hashchange', () => { readHash(); render(); });
  }

  // ---------- 启动 ----------
  window.RADAR = {
    setQuery(v) { state.q = v || ''; $('#q').value = state.q; render(); },
    state,
  };

  readHash();
  renderStats();
  renderRail();
  bind();
  render();
  if (pendingCompare) {
    pendingCompare.slice(0, 3).forEach((r) => { if (D.tools.some((t) => t.repo === r) && !cmp.includes(r)) cmp.push(r); });
    renderCompareBar();
    openCompare();
  }
  if (pendingTool) openTool(pendingTool);

  // 空状态 / 少结果提示里的快捷出口
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto-board]');
    if (b) {
      state.board = b.dataset.gotoBoard;
      render();
      $('#list').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const q = e.target.closest('[data-quick]');
    if (!q) return;
    const k = q.dataset.quick;
    if (k === 'clear-q') { $('#q').value = ''; state.q = ''; }
    else if (k === 'fav-off') state.favOnly = false;
    else if (k === 'all-scene') state.scene = 'all';
    else if (k === 'board-month') state.board = 'month';
    else if (k === 'board-stars') state.board = 'stars';
    else if (k === 'board-active') state.board = 'active';
    render();
    renderRail();
    $('#list').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
})();
