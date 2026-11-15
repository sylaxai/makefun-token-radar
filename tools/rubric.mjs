// Rubric evaluation for token-radar variants. Usage:
//   node tools/rubric.mjs <out-dir> [<out-dir> ...]
// Each out dir is one variant's MAKEFUN_OUTPUT_DIR. Prints the 7 gate rows and a 0-5 score
// per judge criterion, plus model stats. Exit 0 when every gate row passes.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from '../vendor/makefun-board.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP = JSON.parse(readFileSync(resolve(HERE, '..', '..', 'makefun', 'token-radar-01-kit', 'input', 'snapshot.json'), 'utf8'));
const SNAP_SLUGS = new Set(SNAP.protocols.map((p) => p.slug));

function imgInfo(buf) {
  // PNG: 8-byte sig, width/height at bytes 16/20 BE. JPEG: scan SOF markers.
  if (buf[0] === 0x89 && buf[1] === 0x50) return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 1) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { type: 'jpeg', w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return { type: 'unknown', w: 0, h: 0 };
}

function renderCheck(outDir, hash) {
  // Headless render via Playwright (the Hatch-managed Chromium refuses a direct launch):
  // load the page, count table rows, catch JS errors.
  try {
    const url = `file://${resolve(outDir, 'dashboard', 'index.html')}${hash || ''}`;
    const out = execFileSync('python3', [join(HERE, 'render_check.py'), url], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
    const r = JSON.parse(out);
    return { ok: r.rows > 10 && r.errors.length === 0, rows: r.rows, err: r.errors.join('; ') || null };
  } catch (e) {
    return { ok: false, rows: 0, err: String(e.message).slice(0, 200) };
  }
}

function evaluate(outDir) {
  const label = outDir;
  const res = { label, gate: {}, judge: {}, stats: {} };
  const boardPath = join(outDir, 'board.json');
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  const rows = Array.isArray(board) ? board : board.rows;
  const dashDir = join(outDir, 'dashboard');
  const dashFiles = readdirSync(dashDir).filter((f) => statSync(join(dashDir, f)).isFile());
  const dashBytes = dashFiles.reduce((t, f) => t + statSync(join(dashDir, f)).size, 0);
  const dashText = dashFiles.map((f) => readFileSync(join(dashDir, f), 'utf8')).join('\n');
  const shotDir = join(outDir, 'screenshots');
  const shots = existsSync(shotDir) ? readdirSync(shotDir).filter((f) => !f.startsWith('.')) : [];

  // --- gate 1: dashboard_files ---
  const hasHtml = dashFiles.includes('index.html');
  const hasCss = dashFiles.some((f) => f.endsWith('.css'));
  const hasJs = dashFiles.some((f) => f.endsWith('.js'));
  const netRe = /(?:href|src|action)\s*=\s*["']https?:|@import\s+["']https?:|import\s+[^'"]*["']https?:|from\s+["']https?:|require\(\s*["']https?:/i;
  const netOffender = dashFiles.find((f) => netRe.test(readFileSync(join(dashDir, f), 'utf8')));
  const badName = dashFiles.find((f) => !/^[A-Za-z0-9._-]{1,128}$/.test(f) || f.startsWith('.') || f.startsWith('-'));
  res.gate.dashboard_files = hasHtml && hasCss && hasJs && dashFiles.length <= 400 && dashBytes <= 4_194_304 && !netOffender && !badName
    ? 'PASS' : `FAIL html=${hasHtml} css=${hasCss} js=${hasJs} files=${dashFiles.length} bytes=${dashBytes} net=${netOffender || '-'} badname=${badName || '-'}`;

  // --- gate 2: board_file ---
  const boardBytes = statSync(boardPath).size;
  let boardOk = rows.length >= 100 && rows.length <= 4000 && boardBytes <= 8_388_608;
  let boardDetail = '';
  for (const r of rows) {
    if (!SNAP_SLUGS.has(r.slug)) { boardOk = false; boardDetail = `unknown slug ${r.slug}`; break; }
    if (typeof r.name !== 'string' || !r.name) { boardOk = false; boardDetail = `empty name ${r.slug}`; break; }
    if (!Number.isSafeInteger(r.rank) || r.rank <= 0) { boardOk = false; boardDetail = `bad rank ${r.slug}`; break; }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) { boardOk = false; boardDetail = `bad implied ${r.slug}`; break; }
    if (!Array.isArray(r.farm_steps)) { boardOk = false; boardDetail = `no farm_steps ${r.slug}`; break; }
  }
  res.gate.board_file = boardOk ? 'PASS' : `FAIL ${boardDetail} rows=${rows.length} bytes=${boardBytes}`;

  // --- gate 3: sorted_by_value ---
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  const ranksOk = ranks.every((v, i) => v === i + 1);
  const sortedOk = rows.every((r, i) => i === 0 || rows[i - 1].implied_value_usd >= r.implied_value_usd);
  const allSame = rows.length >= 2 && rows[0].implied_value_usd === rows[rows.length - 1].implied_value_usd;
  res.gate.sorted_by_value = ranksOk && sortedOk && !allSame ? 'PASS' : `FAIL ranks=${ranksOk} sorted=${sortedOk} allSame=${allSame}`;

  // --- gate 4: coverage ---
  const have = new Set(rows.map((r) => r.slug));
  const missing = SNAP.watchlist.filter((s) => !have.has(s));
  res.gate.coverage = missing.length === 0 ? 'PASS' : `FAIL missing ${missing.length}: ${missing.slice(0, 5).join(', ')}`;

  // --- gate 5: farm_steps ---
  let stepsOk = true; let stepsDetail = '';
  let withCost = 0; let totalSteps = 0; const stepTexts = new Set();
  for (const r of rows) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) { stepsOk = false; stepsDetail = `${r.slug} has ${r.farm_steps.length} steps`; break; }
    for (const s of r.farm_steps) {
      totalSteps++;
      stepTexts.add(s);
      if (s.includes('Cost:') && s.includes('Time:')) withCost++;
      if (s.trim().length < 20 || s.trim().length > 600) { stepsOk = false; stepsDetail = `${r.slug} step ${s.trim().length} chars`; break; }
    }
    if (!stepsOk) break;
  }
  res.gate.farm_steps = stepsOk ? 'PASS' : `FAIL ${stepsDetail}`;
  res.stats.steps_per_row = rows[0].farm_steps.length;
  res.stats.steps_with_cost_time_pct = +(100 * withCost / Math.max(1, totalSteps)).toFixed(1);
  res.stats.unique_step_texts_pct = +(100 * stepTexts.size / Math.max(1, totalSteps)).toFixed(1);

  // --- gate 6: screenshots ---
  let shotsOk = shots.length >= 3 && shots.length <= 4;
  let shotsDetail = '';
  const shotInfos = [];
  for (const f of shots) {
    const p = join(shotDir, f);
    const st = statSync(p);
    const info = imgInfo(readFileSync(p));
    shotInfos.push({ f, bytes: st.size, ...info });
    if (st.size > 524_288) { shotsOk = false; shotsDetail = `${f} ${st.size} bytes`; }
    if (info.type === 'unknown') { shotsOk = false; shotsDetail = `${f} not PNG/JPEG`; }
    const long = Math.max(info.w, info.h), short = Math.min(info.w, info.h);
    if (long > 1440 || short < 800) { shotsOk = false; shotsDetail = `${f} ${info.w}x${info.h}`; }
  }
  res.gate.screenshots = shotsOk ? 'PASS' : `FAIL ${shotsDetail} count=${shots.length}`;
  res.stats.screenshots = shotInfos.map((s) => `${s.f} ${s.type} ${s.w}x${s.h} ${Math.round(s.bytes / 1024)}KB`);

  // --- gate 7: dossier_matches ---
  try {
    const expected = readFileSync(join(outDir, 'dossier.json'));
    const rebuilt = buildDossier(outDir, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } });
    res.gate.dossier_matches = Buffer.compare(Buffer.from(rebuilt), expected) === 0 ? 'PASS' : `FAIL rebuilt ${rebuilt.length} bytes vs stored ${expected.length}`;
  } catch (e) {
    res.gate.dossier_matches = `FAIL ${String(e.message).slice(0, 160)}`;
  }
  res.stats.dossier_bytes = statSync(join(outDir, 'dossier.json')).size;

  // --- model stats ---
  const dataJs = readFileSync(join(outDir, 'data.js'), 'utf8');
  const m = dataJs.match(/window\.RADAR=(\{.*\});\s*$/s);
  const radar = m ? JSON.parse(m[1]) : null;
  res.stats.rows = rows.length;
  res.stats.top_implied = rows[0].implied_value_usd;
  res.stats.bottom_implied = rows[rows.length - 1].implied_value_usd;
  res.stats.spread_x = +(rows[0].implied_value_usd / rows[rows.length - 1].implied_value_usd).toFixed(1);
  res.stats.verdicts = rows.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {});
  res.stats.curve = radar && radar.curve ? `log10(mcap)=${radar.curve.intercept}+${radar.curve.slope}*log10(tvl) n=${radar.curve.n} LOO x${radar.curve.loo_factor} split x${radar.curve.split_factor}` : 'flat multiple (variant A)';
  res.stats.data_rows_match = radar ? radar.rows.length === rows.length : false;

  // --- judge proxies 0-5 ---
  const render = renderCheck(outDir, '');
  const renderDetail = renderCheck(outDir, '#p=' + rows[0].slug);
  const renderFiltered = renderCheck(outDir, '#verdict=FARM');
  res.stats.render = { board_rows_dom: render.rows, detail_rows_dom: renderDetail.rows, filtered_rows_dom: renderFiltered.rows };
  const noHardcodedNames = !/steakhouse|gauntlet|sentora|polymarket/i.test(readFileSync(resolve(HERE, '..', 'lib', 'model.ts'), 'utf8').replace(/\/\/[^\n]*/g, ''));
  const sortCols = (dashText.match(/sortHeader\(/g) || []).length;
  const filters = ['state.q', 'state.category', 'state.chain', 'state.verdict', 'state.wl'].filter((k) => dashText.includes(k)).length;
  const j1 = (missing.length === 0 ? 2 : 0) + (rows.length >= 198 ? 1 : rows.length >= 100 ? 0.5 : 0) + (res.stats.data_rows_match ? 1 : 0) + (render.ok && renderDetail.ok && renderFiltered.ok ? 1 : 0);
  const j2 = (radar && radar.curve ? 1 : 0) + (radar && radar.curve && radar.curve.loo_factor > 1 && radar.curve.split_factor > 1 ? 1 : 0) + (noHardcodedNames ? 1 : 0) + (radar && radar.live && radar.live.length > 0 ? 1 : 0) + (res.stats.spread_x >= 5 ? 1 : 0);
  const verdictSpread = res.stats.verdicts.FARM > 0 && res.stats.verdicts.THIN > 0 && res.stats.verdicts.SKIP > 0;
  const j3 = (res.stats.steps_per_row >= 8 ? 1 : res.stats.steps_per_row >= 6 ? 0.5 : 0) + (res.stats.steps_with_cost_time_pct >= 99 ? 1 : 0) + (verdictSpread ? 1 : 0) + (res.stats.unique_step_texts_pct >= 50 ? 1 : 0) + (dashText.includes('Verdict') ? 1 : 0);
  const j4 = (sortCols >= 5 ? 1 : sortCols / 5) + (filters >= 4 ? 1 : filters / 4) + (dashText.includes('showModal') ? 1 : 0) + (dashText.includes('Model sandbox') ? 1 : 0) + (dashText.includes('Research note') && dashText.includes('Audit') ? 1 : 0);
  const shotInRange = shotInfos.length > 0 && shotInfos.every((s) => s.bytes >= 300 * 1024 && s.bytes <= 350 * 1024);
  const j5 = (dashText.includes('--acc:') ? 1 : 0) + (!/cdn|unpkg|jsdelivr|fonts\.google/i.test(dashText) ? 1 : 0) + (dashBytes <= 55000 ? 1 : 0) + (shotInRange ? 1 : 0) + 0; // +1 manual visual check, added by hand
  res.judge = { '1 working radar': +j1.toFixed(1), '2 value model': +j2.toFixed(1), '3 farm plans': +j3.toFixed(1), '4 dashboard': +j4.toFixed(1), '5 looks made (ex-visual)': +j5.toFixed(1) };
  res.judge_total_ex_visual = +(j1 + j2 + j3 + j4 + j5).toFixed(1);
  return res;
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) { console.error('usage: node tools/rubric.mjs <out-dir> [...]'); process.exit(2); }
let allPass = true;
for (const d of dirs) {
  const r = evaluate(d);
  console.log(`\n===== ${r.label} =====`);
  console.log('GATE:');
  for (const [k, v] of Object.entries(r.gate)) { console.log(`  ${k}: ${v}`); if (!String(v).startsWith('PASS')) allPass = false; }
  console.log('JUDGE (0-5 per criterion, ex-visual for #5):');
  for (const [k, v] of Object.entries(r.judge)) console.log(`  ${k}: ${v}`);
  console.log(`  TOTAL ex-visual: ${r.judge_total_ex_visual} / 25`);
  console.log('STATS:', JSON.stringify(r.stats, null, 1));
}
console.log(`\nGATE OVERALL: ${allPass ? 'ALL PASS' : 'FAILURES PRESENT'}`);
process.exit(allPass ? 0 : 1);
