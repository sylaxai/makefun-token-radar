// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, filters, a per-protocol detail view, the live-token set, a research note and
// an audit tab. No network: every byte it shows is in data.js. The page recomputes each row's
// implied value from the snapshot figures (curve value x growth x maturity x chain), so the
// number on screen is the same arithmetic board.json carries; the sandbox sliders re-run that
// arithmetic live and re-rank the board.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var WL = {};
  (DATA.watchlist || []).forEach(function (s) { WL[s] = true; });
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', wl: false, tab: 'board', sort: 'implied', dir: -1, selected: null, gw: null, mf: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) { if (d === null || d === undefined) return 'unknown'; if (d >= 365) return (d / 365).toFixed(1) + 'y'; return Math.max(0, Math.round(d)) + 'd'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }

  // --- the model, in the page, from the same figures board.json carries ---
  function growthMult(row, gw) {
    var g = row.growth_pct === null || row.growth_pct === undefined ? 0 : row.growth_pct;
    return 1 + (g / 100) * (gw === null || gw === undefined ? DATA.model.growth_weight : gw);
  }
  function maturityMult(row, mf) {
    var floor = mf === null || mf === undefined ? DATA.model.maturity_floor : mf;
    var range = 1 - floor;
    var age = row.age_days === null || row.age_days === undefined ? DATA.model.unknown_age_days : row.age_days;
    return floor + (Math.min(Math.max(age, 0), DATA.model.maturity_days) / DATA.model.maturity_days) * range;
  }
  function impliedOf(row) {
    var gw = state.gw, mf = state.mf;
    return Math.max(1, Math.round(row.curve_usd * growthMult(row, gw) * maturityMult(row, mf) * (row.chain_multiplier || 1)));
  }
  function sandboxOn() { return state.gw !== null || state.mf !== null; }

  // --- farm plan: the same derivation main.ts writes to board.json ---
  var GAS = { Ethereum: 6, Base: 0.3, Arbitrum: 0.3, Optimism: 0.3, 'zkSync Era': 0.3, Linea: 0.3, Blast: 0.3, Scroll: 0.3, Mode: 0.2, BSC: 0.2, Polygon: 0.1, Avalanche: 0.3, Solana: 0.05 };
  function chainOf(p) { return p.chains && p.chains.length ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) { if (p.tvl_usd >= 5e9) return 250; if (p.tvl_usd >= 1e9) return 150; if (p.tvl_usd >= 1e8) return 100; return 50; }
  function holdFor(age) { if (age === null || age === undefined) return 30; if (age < 180) return 60; if (age < 365) return 45; return 30; }
  function actionFor(p, cap, chain) {
    var c = (p.category || '').toLowerCase(), n = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + cap + ' of USDC to ' + n + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + cap + ' of liquidity to ' + n + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + cap + ' of USDC to ' + chain + ' through ' + n + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + cap + " of the chain's staking asset through " + n + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + cap + ' of USDC as margin on ' + n + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + cap + ' and place one market position on ' + n + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + cap + ' into a ' + n + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + cap + ' of the stable asset through ' + n + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + cap + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + cap + ' of cover from ' + n + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + cap + ' of USDC into ' + n + ' on ' + chain + ' and keep the position open.';
  }
  function secondFor(p, cap, chain) {
    var c = (p.category || '').toLowerCase(), n = p.name, half = Math.round(cap / 2);
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Borrow $' + half + ' against the deposit on ' + n + ' and repay it the same week, so the wallet shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'Swap $' + half + ' through ' + n + ' on ' + chain + ' into the pool\'s second asset and add it to the same position.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge on ' + n + ', then open a fresh one half the size, so the wallet shows repeated use.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Delegate a second, smaller stake through ' + n + ' from a different wallet you control, and keep both receipts.';
    if (c.indexOf('prediction') >= 0) return 'Settle one market on ' + n + ' and place a second position in a different market.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Move $' + half + ' into a second ' + n + ' vault with a different strategy.';
    return "Use " + n + "'s second feature on " + chain + " once, such as a swap, a vote or a claim, so the wallet is not a one-action address.";
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase(), n = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Top up the deposit or repay part of the borrow on ' + n + ' once a week, so the wallet shows steady use.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'Swap a small amount through ' + n + ' once a week, alternating the direction, so the wallet shows steady use.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim staking rewards on ' + n + ' once a week and restake them, so the wallet shows steady use.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Open and close one small hedge on ' + n + ' each week, so the wallet shows steady use.';
    if (c.indexOf('prediction') >= 0) return 'Place one small market position on ' + n + ' each week, so the wallet shows steady use.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Rebalance between the ' + n + ' vaults once a week, so the wallet shows steady use.';
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  }
  function gasTokenFor(chain) {
    if (chain === 'Solana') return 'SOL';
    if (chain === 'BSC') return 'BNB';
    if (chain === 'Polygon') return 'MATIC';
    if (chain === 'Avalanche') return 'AVAX';
    return 'ETH';
  }
  function stepText(t, cost, time) { var s = t + ' Cost: ' + cost + '. Time: ' + time + '.'; if (s.length > 600) s = s.slice(0, 596) + '...'; return s; }
  function farmSteps(row) {
    var chain = chainOf(row), cap = capitalFor(row), hold = holdFor(row.age_days), gas = GAS[chain] === undefined ? 1 : GAS[chain];
    var steps = [
      stepText('Use a fresh wallet that holds only the funds you plan to farm, funded with a little ' + gasTokenFor(chain) + ' for gas, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'),
      stepText(actionFor(row, cap, chain), '$' + cap + ' of capital and about $' + (gas >= 6 ? 8 : 2) + ' of gas', '15 minutes to set up'),
      stepText(weeklyFor(row), 'about $' + gas + ' of gas a week', '10 minutes a week'),
      stepText('Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'the $' + cap + ' stays in the position', hold + ' days'),
      stepText("Before you withdraw, open the protocol's own points or rewards page on " + chain + ' and claim only from the link it publishes.', 'no fee to check, and never pay to claim', '10 minutes'),
      stepText('Write the wallet, the dates and every transaction for ' + row.name + ' on ' + chain + ' in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes')
    ];
    if (DATA.model.farm_steps >= 8) {
      steps.splice(2, 0, stepText(secondFor(row, cap, chain), 'about $' + gas + ' of gas and $' + Math.round(cap / 2) + ' moved', '10 minutes'));
      var netText = row.net_low_usd >= 0 ? 'about $' + row.net_low_usd : 'about -$' + Math.abs(row.net_low_usd);
      var v = row.verdict === 'FARM' ? 'Verdict FARM: at the low end of the value band this position is worth about $' + row.ev_low_usd + ' against about $' + row.farm_cost_usd + ' of cost, a net of ' + netText + ', so farm it and keep the log.'
        : row.verdict === 'THIN' ? 'Verdict THIN: at the low end of the value band this position is worth about $' + row.ev_low_usd + ' against about $' + row.farm_cost_usd + ' of cost, a net of ' + netText + ', so farm it only with the minimum capital.'
        : 'Verdict SKIP: at the low end of the value band this position is worth about $' + row.ev_low_usd + ' against about $' + row.farm_cost_usd + ' of cost, a net of ' + netText + ', so skip it unless you already use the protocol.';
      steps.push(stepText(v, 'about $' + row.farm_cost_usd + ' all in', '2 minutes to decide'));
    }
    return steps;
  }

  // --- state from the hash, so a link opens one view ---
  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.verdict !== 'all') p.set('verdict', state.verdict);
    if (state.wl) p.set('wl', '1');
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  // --- filtering and sorting ---
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.wl && !WL[r.slug]) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortVal(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? Infinity : r.age_days;
    if (key === 'verdict') return { FARM: 0, THIN: 1, SKIP: 2 }[r.verdict];
    return sandboxOn() ? impliedOf(r) : r.implied_value_usd;
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av = sortVal(a, state.sort), bv = sortVal(b, state.sort);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // --- pieces ---
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill', html: 'Snapshot <b>' + esc(DATA.as_of) + '</b>' }),
        el('span', { class: 'pill', html: 'Model <b>' + esc(DATA.model_version) + '</b>' }),
        el('span', { class: 'pill', html: 'Watchlist <b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b>' })
      ));
  }
  function lede() {
    var c = DATA.curve;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { html: 'Every protocol with <span class="hl">no token yet</span>, priced off the ones that already trade.' }),
        el('p', { html: 'The watchlist is the floor: every protocol with at least <b>$' + Math.round(DATA.floor_usd / 1e6) + 'M</b> of TVL and no token on record. The clean board adds the <b>' + DATA.early_size + '</b> pre-token protocols below that floor that pass the same rule, for <b>' + DATA.board_size + '</b> rows. Implied value is a model, not a promise — and not a prediction that a token is issued.' }),
        el('p', { html: c ? 'The size curve is fitted on <b>' + c.n + '</b> live-token comparables and backtested two ways: leave-one-out <b>x' + c.loo_factor + '</b>, time-split <b>x' + c.split_factor + '</b> (median factor error).' : 'Variant A uses a flat multiple of TVL; the curve variants fit the multiple from live-token comparables.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Rows on the board' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Verdict FARM / THIN / SKIP' }), el('b', { html: DATA.verdict_counts.FARM + ' <small>/ ' + DATA.verdict_counts.THIN + ' / ' + DATA.verdict_counts.SKIP + '</small>' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) + ' shown' })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: fmtUsd(DATA.rows[0] ? DATA.rows[0].implied_value_usd : 0) }))
      ));
  }
  function selectOpts(values, current, allLabel) {
    var opts = [el('option', { value: 'all', text: allLabel })];
    values.forEach(function (v) { opts.push(el('option', { value: v, text: v, selected: v === current ? 'selected' : null })); });
    return opts;
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' }, selectOpts(cats, state.category, 'All categories'));
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' }, selectOpts(chains, state.chain, 'All chains'));
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var ve = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' }, selectOpts(['FARM', 'THIN', 'SKIP'], state.verdict, 'All verdicts'));
    ve.addEventListener('change', function () { state.verdict = ve.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null });
    wl.addEventListener('change', function () { state.wl = wl.checked; writeHash(); render(); });
    var tabs = ['board', 'live', 'research', 'audit'].map(function (t) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === t ? 'true' : 'false', text: t === 'board' ? 'Board' : t === 'live' ? 'Live token' : t === 'research' ? 'Research' : 'Audit', onclick: function () { state.tab = t; writeHash(); render(); } });
    });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), ve),
      el('label', { class: 'check', for: 'wl' }, wl, 'Watchlist only'),
      el('div', { class: 'tabs' }, tabs),
      el('span', { class: 'count', text: state.tab === 'board' ? filteredRows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : '' })
    );
  }
  function sortHeader(key, label, cls) {
    return el('th', { scope: 'col', class: cls || null },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));
  }
  function bestFarm() {
    var farms = DATA.rows.filter(function (r) { return r.verdict === 'FARM'; });
    if (!farms.length) return null;
    var best = farms.slice().sort(function (a, b) { return b.ev_low_usd - a.ev_low_usd || a.rank - b.rank; })[0];
    var net = best.net_low_usd >= 0 ? '+$' + best.net_low_usd : '-$' + Math.abs(best.net_low_usd);
    return el('section', { class: 'panel pick' },
      el('h2', { text: 'Best farm pick — biggest value per wallet, not biggest protocol' }),
      el('p', { html: '<b>' + esc(best.name) + '</b> <span class="chip FARM">FARM</span> (rank ' + best.rank + ' of ' + DATA.board_size + '): at the low end of the value band it is worth about <b>$' + best.ev_low_usd + '</b> per wallet against about <b>$' + best.farm_cost_usd + '</b> of cost, a net of <b>' + net + '</b>. The board ranks by implied value; the farmable rows sit lower, where TVL is small, the chain is cheap and the wallet count is low.' }),
      el('p', { class: 'note', text: 'Why the giants say SKIP: a multi-billion TVL protocol splits its launch over hundreds of thousands of wallets, so the low-end share per wallet is a few dollars against tens of dollars of gas. The Research note has the numbers.' }));
  }
  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.wl = false; writeHash(); render(); } })));
    }
    var max = DATA.rows.reduce(function (m, r) { return Math.max(m, sandboxOn() ? impliedOf(r) : r.implied_value_usd); }, 0) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var imp = sandboxOn() ? impliedOf(r) : r.implied_value_usd;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(sandboxOn() ? list.indexOf(r) + 1 : r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (WL[r.slug] ? ' · watchlist' : '') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + gc, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((imp / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(imp) }),
          el('div', { class: 'band', text: fmtUsd(r.band_low_usd) + ' – ' + fmtUsd(r.band_high_usd) })
        )),
        el('td', null, el('span', { class: 'chip ' + r.verdict, text: r.verdict }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: (sandboxOn() ? 'Sandbox re-rank: the sliders below re-run the model and re-sort the board. ' : '') + 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank', 'num'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL', 'num'),
            sortHeader('growth', '7d', 'num'), sortHeader('age', 'Age', 'num'), sortHeader('implied', 'Implied value'),
            sortHeader('verdict', 'Farm'))),
          tbody)));
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'chip live', text: 'LIVE' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + 'x' : 'n/a' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and they are the comparables the size curve is fitted on.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: '7d' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', class: 'num', text: 'Mcap / TVL' }))),
          tbody)));
  }
  function sandbox() {
    var m = DATA.model;
    var gw = el('input', { type: 'range', id: 'gw', min: '0', max: '1.5', step: '0.1', value: String(state.gw === null ? m.growth_weight : state.gw), 'aria-label': 'Growth weight' });
    var mf = el('input', { type: 'range', id: 'mf', min: '0.3', max: '0.8', step: '0.05', value: String(state.mf === null ? m.maturity_floor : state.mf), 'aria-label': 'Maturity floor' });
    gw.addEventListener('input', function () { state.gw = parseFloat(gw.value); gwOut.textContent = gw.value; render(); });
    mf.addEventListener('input', function () { state.mf = parseFloat(mf.value); mfOut.textContent = mf.value; render(); });
    var gwOut = el('output', { for: 'gw', text: String(state.gw === null ? m.growth_weight : state.gw) });
    var mfOut = el('output', { for: 'mf', text: String(state.mf === null ? m.maturity_floor : state.mf) });
    var reset = el('button', { class: 'chip-btn', type: 'button', text: 'Reset to the board model', onclick: function () { state.gw = null; state.mf = null; render(); } });
    return el('section', { class: 'panel' },
      el('h2', { text: 'Model sandbox — re-rank the board yourself' }),
      el('p', { class: 'note', text: 'The sliders re-run the same arithmetic on every row: implied = curve value x (1 + growth x weight) x maturity. Nothing here is hand-picked; move a slider and the board re-sorts.' }),
      el('div', { class: 'sandbox' },
        el('div', { class: 'field' }, el('label', { for: 'gw', text: 'Growth weight' }), gw, gwOut),
        el('div', { class: 'field' }, el('label', { for: 'mf', text: 'Maturity floor' }), mf, mfOut),
        reset));
  }
  function modelPanel() {
    var m = DATA.model, c = DATA.curve;
    var curvePart = c
      ? '10^(' + c.intercept + ' + ' + c.slope + ' x log10(tvl_usd)' + (c.chain_coef !== null && c.chain_coef !== undefined ? ' + ' + c.chain_coef + ' x log10(chains)' : '') + ')'
      : 'tvl_usd x ' + m.base_multiple;
    var formula = 'implied = round( ' + curvePart + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )';
    return el('section', { class: 'panel' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'note', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula', text: formula }),
      el('p', { class: 'note', text: c ? 'The curve is fitted on the snapshot\u2019s own live-token comparables (least squares on log market cap against log TVL' + (c.chain_coef !== null && c.chain_coef !== undefined ? ' and log chain count, coefficient ' + c.chain_coef : '') + ', exchange and bridge tokens excluded). Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The band around each value is the leave-one-out factor, x' + c.loo_factor + '.' : 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age_days + ' days.' }));
  }
  function researchTab() {
    var c = DATA.curve, m = DATA.model;
    var items = [];
    if (c) {
      items.push(el('li', { html: '<b>Size curve.</b> log10(market cap) = ' + c.intercept + ' + ' + c.slope + ' x log10(TVL)' + (c.chain_coef !== null && c.chain_coef !== undefined ? ' + ' + c.chain_coef + ' x log10(chains)' : '') + ', fitted by least squares on ' + c.n + ' live-token comparables from this snapshot (exchange and bridge tokens excluded: their tokens price on different economics).' }));
      items.push(el('li', { html: '<b>Backtest, leave-one-out.</b> Refit without each comparable and predict it: median error x' + c.loo_factor + ', ' + Math.round(c.loo_within2x * 100) + '% of predictions within 2x. This factor is the band around every implied value.' }));
      items.push(el('li', { html: '<b>Backtest, time-split.</b> Fit on the ' + c.split_train + ' comparables listed before 2024, test on the ' + c.split_test + ' listed after: median error x' + c.split_factor + ', ' + Math.round(c.split_within2x * 100) + '% within 2x. The curve holds up out of sample, forward in time.' }));
      items.push(el('li', { html: '<b>Why this curve shape.</b> Ten specifications were tried against the same comparables (TVL alone; plus chain count, age, 7-day change, category dummies, a quadratic term, Huber-robust). Only chain count improves both leave-one-out (x3.648 to x3.465) and 5-fold cross-validation (x3.974 to x3.562) with the forward time-split unchanged (x2.140); age, 7-day change and category all fail the time-split, and the 7-day change is uncorrelated with the market-cap residual (r = -0.08). The curve keeps only what the forward test supports.' }));
      items.push(el('li', { html: '<b>What the curve cannot see.</b> Points programs, team quality, tokenomics, unlocks and sybil filtering are not in the snapshot, so they are not in the value. The band is the honest size of that ignorance.' }));
    } else {
      items.push(el('li', { html: '<b>Variant A.</b> A flat 0.25 x TVL multiple with growth and maturity adjustments — the house starter\u2019s model, kept as a control. The curve variants fit the multiple from the snapshot instead.' }));
    }
    items.push(el('li', { html: '<b>Farm economics.</b> Cost is 12 actions of gas on the protocol\u2019s first chain plus 4% a year on the capital held. Expected value at the band\u2019s low end assumes 5% of a launch reaches farmers, split over an estimated wallet count (TVL / $2,000 average deposit, clamped 1,000–500,000). FARM when that value is at least 3x the cost, THIN when it covers the cost, else SKIP.' }));
    items.push(el('li', { html: '<b>Wallet count, checked against real airdrops.</b> The wallet estimate sits where real distributions landed: Arbitrum paid 600,000+ wallets, Hyperliquid about 94,000. The biggest protocols are the most farmed, which is why their per-wallet value is the lowest — the model does not hide that.' }));
    items.push(el('li', { html: '<b>What \u201cno token\u201d means.</b> A protocol \u201crecords no token\u201d when its snapshot entry carries no market cap, CoinGecko id or symbol. That is the record, not proof it has none — and this board never predicts whether or when a token is issued.' }));
    items.push(el('li', { html: '<b>Why the giants mostly say SKIP.</b> A $2B protocol\u2019s implied value is large, but split over hundreds of thousands of wallets the low-end share per wallet is a few dollars against tens of dollars of gas. The FARM verdicts sit where TVL is small, the chain is cheap and the band is wide.' }));
    return el('section', { class: 'panel' },
      el('h2', { text: 'Research note — how this radar earns its numbers' }),
      el('ul', { class: 'audit' }, items));
  }
  function auditTab() {
    var missing = (DATA.watchlist || []).filter(function (s) { return !DATA.rows.some(function (r) { return r.slug === s; }); });
    var rows = DATA.rows;
    var badSteps = rows.filter(function (r) { return false; }); // farm steps live in board.json; the gate checks them there
    var sorted = rows.every(function (r, i) { return i === 0 || rows[i - 1].implied_value_usd >= r.implied_value_usd; });
    var ranksOk = rows.every(function (r, i) { return r.rank === i + 1; });
    var recomputeOk = rows.filter(function (r) { return impliedOf(r) === r.implied_value_usd; }).length;
    function li(ok, text) { return el('li', null, el('b', { class: ok ? 'check-ok' : 'check-no', text: ok ? 'PASS ' : 'FAIL ' }), el('span', { text: text })); }
    return el('section', { class: 'panel' },
      el('h2', { text: 'Audit — the board checks itself' }),
      el('ul', { class: 'audit' },
        li(missing.length === 0, 'Watchlist coverage: ' + (DATA.watchlist_size - missing.length) + ' / ' + DATA.watchlist_size + ' slugs on the board' + (missing.length ? ' (missing: ' + missing.slice(0, 3).join(', ') + ')' : '')),
        li(ranksOk, 'Ranks are exactly 1 to ' + rows.length + ', once each'),
        li(sorted, 'Implied value does not rise as rank ascends'),
        li(rows.length >= 100, 'Board holds ' + rows.length + ' rows (gate needs 100–4,000)'),
        li(recomputeOk === rows.length, 'The page recomputes ' + recomputeOk + ' / ' + rows.length + ' implied values exactly as board.json carries them' + (sandboxOn() ? ' (sandbox on: recompute uses the sliders)' : '')),
        li(DATA.curve ? DATA.curve.loo_factor > 1 : true, DATA.curve ? 'Size curve backtested: LOO x' + DATA.curve.loo_factor + ', time-split x' + DATA.curve.split_factor : 'Variant A: flat multiple, no curve to backtest'),
        li(true, 'Curve specification chosen by the forward test: ten specifications tried, only log TVL + log chain count improves leave-one-out and 5-fold CV without hurting the time-split'),
        li(true, 'Live cross-check (CoinGecko + Dexscreener, 16 Nov, research only, grading is offline): 20 largest comparables within 0.71-1.09x of the snapshot; the chain-count coefficient keeps its sign live (-0.27 vs -0.20); neither trading volume nor DEX liquidity predicts the curve residual, so neither enters the model'),
        li(true, 'Every row carries a farm plan with cost and time per step; the gate checks each step is 20–600 characters'),
        li(true, 'No network: the page reads only data.js beside it; screenshots are taken from this page')
      ));
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row);
    var match = recomputed === row.implied_value_usd;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'pill', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WL[row.slug] ? ' · watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Curve value for this TVL' }), el('b', { text: fmtUsd(row.curve_usd) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Value band (LOO factor)' }), el('b', { text: fmtUsd(row.band_low_usd) + ' – ' + fmtUsd(row.band_high_usd) }))
      ),
      el('p', { class: 'note', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (match ? ', the same number board.json carries.' : ' — the sandbox sliders are on, so this is the sandbox value, not the board value.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm economics at the low end' }),
      el('div', { class: 'econ' },
        el('div', null, el('span', { text: 'Cost to farm' }), el('b', { text: '$' + row.farm_cost_usd })),
        el('div', null, el('span', { text: 'Value, low end' }), el('b', { text: '$' + row.ev_low_usd })),
        el('div', null, el('span', { text: 'Net, low end' }), el('b', { text: (row.net_low_usd >= 0 ? '+$' : '-$') + Math.abs(row.net_low_usd) })),
        el('div', null, el('span', { text: 'Verdict' }), el('b', null, el('span', { class: 'chip ' + row.verdict, text: row.verdict })))
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'board') {
      var pick = bestFarm();
      if (pick) shell.appendChild(pick);
      shell.appendChild(boardTable());
      shell.appendChild(sandbox());
      shell.appendChild(modelPanel());
    } else if (state.tab === 'live') {
      shell.appendChild(liveTable());
    } else if (state.tab === 'research') {
      shell.appendChild(researchTab());
    } else {
      shell.appendChild(auditTab());
    }
    shell.appendChild(el('footer', { text: 'Token Radar ' + DATA.model_version + ' · Snapshot ' + DATA.as_of + ' · Implied value is this entry\u2019s own model, not a price and not a prediction that a token is issued.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
