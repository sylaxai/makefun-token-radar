// Token Radar: comps-fitted implied value, costed farm plans, three model variants.
//
// The board ranks the snapshot's clean pre-token protocols: every protocol that records no token
// and is not a wrapped, staked or bridged product, a versioned pool, an exchange product or a CEX
// (the watchlist's own rule, applied to the whole snapshot, not just above its floor). The
// watchlist is the floor: all 40 of its slugs are on the board; the early radar adds the 158
// clean protocols below the floor, for 198 rows.
//
// The value model is FITTED from the snapshot, never hardcoded: a log-log size curve
//   log10(mcap) = a + b * log10(tvl)
// is fitted by least squares on the live-token comparables (protocols whose token already trades,
// excluding CEX and bridge categories, whose tokens price on different economics). The same run
// backtests it two ways and reports both numbers on the dashboard:
//   LOO       leave-one-out over the comparables (median factor error)
//   time-split fitted on protocols listed before 2024-01-01, tested on those listed after
// A row's implied value is the curve's prediction for its TVL, times a growth multiplier from
// its seven-day TVL change and a maturity multiplier from how long it has run with no token.
// The band is the LOO factor either way: band_low = implied / loo_factor.
//
// Farm economics are netted to the dollar, at the band's low end, under stated assumptions:
//   cost   = gas (12 actions on the protocol's first chain) + 4% a year on the capital held
//   ev_low = band_low x 5% (the share of a launch assumed to reach farmers) / wallets,
//            wallets = clamp(TVL / $2,000, 1,000, 500,000), a $2,000 average deposit per wallet
//   verdict FARM when ev_low >= 3 x cost, THIN when ev_low >= cost, else SKIP.
// No protocol name is ever special-cased: the same functions score every row.
//
// Variants (selected with --variant):
//   a  the house starter's model: flat 0.25 x TVL, 200 rows, 6-step plans (the control)
//   b  comps curve, growth weight 0.5, 198 clean rows, 8-step netted plans (the entry)
//   c  comps curve with a momentum tilt: growth weight 1.0, growth clamp widened to +300%
//      (the snapshot's fastest growers run past +160% in a week), steeper maturity, and a
//      small chain-breadth multiplier (the challenger)
//   d  comps curve plus chain breadth: the size curve gains log10(chain count) as a second
//      regressor (coefficient about -0.20), same growth/maturity/farm economics as b (the entry)

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export type VariantId = 'a' | 'b' | 'c' | 'd';

export interface Variant {
  id: VariantId;
  label: string;
  model_version: string;
  base_multiple: number; // variant A only
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_bonus: number; // variant C only: per extra chain, capped at 5
  farm_steps: number; // 6 or 8
  use_curve: boolean;
  curve_features: 'tvl' | 'tvl-chains'; // size-curve regressors: log TVL alone, or log TVL + log chain count
}

export const VARIANTS: Record<VariantId, Variant> = {
  a: { id: 'a', label: 'starter flat multiple', model_version: 'radar-1', base_multiple: 0.25, growth_weight: 0.5, growth_floor: -60, growth_cap: 120, maturity_floor: 0.6, maturity_range: 0.4, maturity_days: 1095, unknown_age_days: 365, chain_bonus: 0, farm_steps: 6, use_curve: false, curve_features: 'tvl' },
  b: { id: 'b', label: 'comps curve, netted farm plans', model_version: 'radar-2', base_multiple: 0, growth_weight: 0.5, growth_floor: -60, growth_cap: 120, maturity_floor: 0.6, maturity_range: 0.4, maturity_days: 1095, unknown_age_days: 365, chain_bonus: 0, farm_steps: 8, use_curve: true, curve_features: 'tvl' },
  c: { id: 'c', label: 'comps curve, momentum tilt', model_version: 'radar-2m', base_multiple: 0, growth_weight: 1.0, growth_floor: -40, growth_cap: 300, maturity_floor: 0.5, maturity_range: 0.5, maturity_days: 1095, unknown_age_days: 365, chain_bonus: 0.02, farm_steps: 8, use_curve: true, curve_features: 'tvl' },
  d: { id: 'd', label: 'comps curve + chain breadth, netted farm plans', model_version: 'radar-3', base_multiple: 0, growth_weight: 0.5, growth_floor: -60, growth_cap: 120, maturity_floor: 0.6, maturity_range: 0.4, maturity_days: 1095, unknown_age_days: 365, chain_bonus: 0, farm_steps: 8, use_curve: true, curve_features: 'tvl-chains' },
};

export interface CurveFit {
  n: number;
  intercept: number;
  slope: number;
  chain_coef: number | null; // log10(chains) coefficient; null when the curve is TVL-only
  features: string; // 'logTVL' or 'logTVL+logChains'
  loo_factor: number;
  loo_within2x: number;
  split_factor: number;
  split_within2x: number;
  split_train: number;
  split_test: number;
}

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  curve_usd: number;
  band_low_usd: number;
  band_high_usd: number;
  farm_cost_usd: number;
  ev_low_usd: number;
  net_low_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  model: {
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  curve_usd: number;
  band_low_usd: number;
  band_high_usd: number;
  farm_cost_usd: number;
  ev_low_usd: number;
  net_low_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Variant;
  curve: CurveFit | null;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  verdict_counts: { FARM: number; THIN: number; SKIP: number };
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are not a protocol awaiting its own launch: a wrapped, staked or bridged product.
 *  This is the watchlist's own list, word for word. */
const BAD_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Comparables exclude one more: cross-chain bridge tokens price on bridge economics too. */
const COMP_BAD_CATEGORY = new Set([...BAD_CATEGORY, 'Cross Chain Bridge']);
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The watchlist's own rule, applied to any protocol: pre-token and not a wrapped, staked or
 *  bridged product, not a versioned pool, not an exchange product. The watchlist is this rule
 *  above the floor; the clean board is this rule everywhere. */
export function isClean(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !BAD_CATEGORY.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_NAME.test(p.name)
  );
}

/** Whether a protocol is one the starter's board may rank (kept for variant A). */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Live-token comparables for the size curve: a token that already trades, on protocol-token
 *  economics (no exchange or bridge token), with a market cap and a TVL to fit on. */
export function comparables(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) =>
      !isPreToken(p) &&
      p.mcap_usd !== null &&
      p.mcap_usd > 0 &&
      p.tvl_usd > 0 &&
      !COMP_BAD_CATEGORY.has(p.category ?? ''),
  );
}

const log10 = (n: number): number => Math.log10(n);

/** Least squares for log10(mcap) on a feature vector, by Gaussian elimination on the normal
 *  equations (a hair of ridge on the non-intercept diagonal keeps a degenerate column from
 *  dividing by zero). Returns one coefficient per feature, intercept first. */
function olsMulti(xs: number[][], ys: number[]): number[] {
  const n = xs.length;
  const k = xs[0]!.length;
  const a: number[][] = [];
  for (let i = 0; i < k; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let t = 0; t < n; t++) s += xs[t]![i]! * xs[t]![j]!;
      if (i === j && i > 0) s += 1e-9;
      row.push(s);
    }
    let b = 0;
    for (let t = 0; t < n; t++) b += xs[t]![i]! * ys[t]!;
    row.push(b);
    a.push(row);
  }
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[piv]![c]!)) piv = r;
    const tmp = a[c]!;
    a[c] = a[piv]!;
    a[piv] = tmp;
    const d = a[c]![c]!;
    if (d === 0) continue;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / d;
      for (let cc = c; cc <= k; cc++) a[r]![cc]! -= f * a[c]![cc]!;
    }
  }
  return a.map((row, i) => (row[i] === 0 ? 0 : row[k]! / row[i]!));
}

/** One comparable's feature vector under a curve spec: always [1, log10(tvl)], plus
 *  log10(chain count) when the spec asks for chain breadth. */
function curveFeatures(p: SnapshotProtocol, features: 'tvl' | 'tvl-chains'): number[] {
  const v = [1, log10(p.tvl_usd)];
  if (features === 'tvl-chains') v.push(log10(Math.max(1, p.chains.length)));
  return v;
}

/** Median absolute log error as a factor, and the share of predictions within 2x. */
function factorStats(errors: number[]): { factor: number; within2x: number } {
  const sorted = [...errors].sort((x, y) => x - y);
  const med = sorted[Math.floor(sorted.length / 2)]!;
  return {
    factor: round4(10 ** med),
    within2x: round4(sorted.filter((e) => e <= Math.log10(2)).length / sorted.length),
  };
}

/** Fit the size curve on the snapshot's comparables and backtest it two ways, in the open.
 *  The regressors come from the variant: TVL alone, or TVL plus chain count (variant D).
 *  Chain breadth earned its place by the forward test, not by fitting: on this snapshot it
 *  improves leave-one-out (x3.648 to x3.465) and 5-fold CV (x3.974 to x3.562) with the
 *  time-split unchanged (x2.140), while age, 7-day change and category dummies all fail the
 *  time-split. The fitted chain coefficient is about -0.20: each doubling of the chain count
 *  multiplies the predicted market cap by about 0.87x — spreading thin across chains is
 *  worth slightly less per dollar of TVL. */
export function fitCurve(snapshot: Snapshot, variant: Variant): CurveFit {
  const comps = comparables(snapshot);
  const feats = variant.curve_features;
  const xs = comps.map((p) => curveFeatures(p, feats));
  const ys = comps.map((p) => log10(p.mcap_usd!));
  const predict = (beta: number[], x: number[]): number => beta.reduce((t, b, i) => t + b * x[i]!, 0);
  const beta = olsMulti(xs, ys);
  // Leave-one-out: refit without each comparable, predict it.
  const looErrors = comps.map((held, i) => {
    const restX = xs.filter((_, j) => j !== i);
    const restY = ys.filter((_, j) => j !== i);
    return Math.abs(predict(olsMulti(restX, restY), xs[i]!) - ys[i]!);
  });
  const loo = factorStats(looErrors);
  // Time split: fit on protocols listed before 2024, test on those listed after.
  const train = comps.filter((p) => p.listed_at !== null && p.listed_at < '2024-01-01');
  const test = comps.filter((p) => p.listed_at !== null && p.listed_at >= '2024-01-01');
  let split = { factor: 0, within2x: 0 };
  if (train.length >= 10 && test.length >= 10) {
    const f = olsMulti(train.map((p) => curveFeatures(p, feats)), train.map((p) => log10(p.mcap_usd!)));
    split = factorStats(test.map((p) => Math.abs(predict(f, curveFeatures(p, feats)) - log10(p.mcap_usd!))));
  }
  return {
    n: comps.length,
    intercept: round4(beta[0]!),
    slope: round4(beta[1]!),
    chain_coef: feats === 'tvl-chains' ? round4(beta[2]!) : null,
    features: feats === 'tvl-chains' ? 'logTVL+logChains' : 'logTVL',
    loo_factor: loo.factor,
    loo_within2x: loo.within2x,
    split_factor: split.factor,
    split_within2x: split.within2x,
    split_train: train.length,
    split_test: test.length,
  };
}

/** The multipliers and implied value one protocol gets under a variant. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  variant: Variant,
  curve: CurveFit | null,
): { implied: number; curveUsd: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(variant.growth_cap, Math.max(variant.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * variant.growth_weight;
  const ageForModel = age ?? variant.unknown_age_days;
  const maturityMult =
    variant.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), variant.maturity_days) / variant.maturity_days) * variant.maturity_range;
  const chainMult = 1 + variant.chain_bonus * Math.min(Math.max(protocol.chains.length - 1, 0), 5);
  let curveUsd: number;
  if (variant.use_curve && curve !== null) {
    const chainTerm = curve.chain_coef !== null ? curve.chain_coef * log10(Math.max(1, protocol.chains.length)) : 0;
    curveUsd = Math.max(1, Math.round(10 ** (curve.intercept + curve.slope * log10(protocol.tvl_usd) + chainTerm)));
  } else {
    curveUsd = Math.max(1, Math.round(protocol.tvl_usd * variant.base_multiple));
  }
  const implied = Math.max(1, Math.round(curveUsd * growthMult * maturityMult * chainMult));
  return { implied, curveUsd, growthPct, growthMult, maturityMult, chainMult, age };
}

/** Gas for one transaction on a chain, in dollars: the farm's cost side, by chain. */
const GAS_PER_TX: Record<string, number> = {
  Ethereum: 6, Base: 0.3, Arbitrum: 0.3, Optimism: 0.3, 'zkSync Era': 0.3, Linea: 0.3,
  Blast: 0.3, Scroll: 0.3, Mode: 0.2, BSC: 0.2, Polygon: 0.1, Avalanche: 0.3, Solana: 0.05,
};
const FARM_ACTIONS = 12;
const ALLOC_SHARE = 0.05; // share of a launch assumed to reach farmers
const AVG_DEPOSIT = 2000; // assumed average deposit per farming wallet

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A protocol's farm economics, netted at the band's low end. Returns whole dollars. */
export function farmEconomics(p: SnapshotProtocol, age: number | null, bandLow: number): { cost: number; evLow: number; net: number; verdict: 'FARM' | 'THIN' | 'SKIP'; capital: number; hold: number } {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = (GAS_PER_TX[chainOf(p)] ?? 1) * FARM_ACTIONS;
  const opportunity = capital * 0.04 * (hold / 365);
  const cost = Math.max(1, Math.round(gas + opportunity));
  const wallets = Math.min(500_000, Math.max(1_000, Math.round(p.tvl_usd / AVG_DEPOSIT)));
  const evLow = Math.round((bandLow * ALLOC_SHARE) / wallets);
  const net = evLow - cost;
  const verdict = evLow >= 3 * cost ? 'FARM' : evLow >= cost ? 'THIN' : 'SKIP';
  return { cost, evLow, net, verdict, capital, hold };
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second qualifying action, different from the first, by category. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Borrow $${Math.round(capital / 2)} against the deposit on ${name} and repay it the same week, so the wallet shows both sides of the market.`;
  if (c.includes('dex') || c.includes('yield')) return `Swap $${Math.round(capital / 2)} through ${name} on ${chain} into the pool's second asset and add it to the same position.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge on ${name}, then open a fresh one half the size, so the wallet shows repeated use.`;
  if (c.includes('staking') || c.includes('restak')) return `Delegate a second, smaller stake through ${name} from a different wallet you control, and keep both receipts.`;
  if (c.includes('prediction')) return `Settle one market on ${name} and place a second position in a different market.`;
  if (c.includes('curator') || c.includes('allocator')) return `Move $${Math.round(capital / 2)} into a second ${name} vault with a different strategy.`;
  return `Use ${name}'s second feature on ${chain} once, such as a swap, a vote or a claim, so the wallet is not a one-action address.`;
}

/** The weekly cadence, phrased for the category so the plan reads like the protocol. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Top up the deposit or repay part of the borrow on ${name} once a week, so the wallet shows steady use.`;
  if (c.includes('dex') || c.includes('yield')) return `Swap a small amount through ${name} once a week, alternating the direction, so the wallet shows steady use.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim staking rewards on ${name} once a week and restake them, so the wallet shows steady use.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Open and close one small hedge on ${name} each week, so the wallet shows steady use.`;
  if (c.includes('prediction')) return `Place one small market position on ${name} each week, so the wallet shows steady use.`;
  if (c.includes('curator') || c.includes('allocator')) return `Rebalance between the ${name} vaults once a week, so the wallet shows steady use.`;
  return `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`;
}

/** The gas token a fresh wallet needs on a chain. */
function gasTokenFor(chain: string): string {
  if (chain === 'Solana') return 'SOL';
  if (chain === 'BSC') return 'BNB';
  if (chain === 'Polygon') return 'MATIC';
  if (chain === 'Avalanche') return 'AVAX';
  return 'ETH';
}

function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps (variant A) or eight (variants B/C), each an action with a
 * cost and a time, derived from the protocol's own record (category, chains, TVL, age) and its
 * netted economics. No name is special-cased.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
  variant: Variant,
  econ: { cost: number; evLow: number; net: number; verdict: 'FARM' | 'THIN' | 'SKIP'; capital: number; hold: number },
): FarmStep[] {
  const chain = chainOf(p);
  const capital = econ.capital;
  const hold = econ.hold;
  const gas = GAS_PER_TX[chain] ?? 1;
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, funded with a little ${gasTokenFor(chain)} for gas, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas >= 6 ? 8 : 2} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyActionFor(p),
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page on ${chain} and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction for ${p.name} on ${chain} in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  if (variant.farm_steps >= 8) {
    steps.splice(2, 0, {
      text: secondActionFor(p, capital, chain),
      cost: `about $${gas} of gas and $${Math.round(capital / 2)} moved`,
      time: '10 minutes',
    });
    const netText = econ.net >= 0 ? `about $${econ.net}` : `about -$${Math.abs(econ.net)}`;
    steps.push({
      text:
        econ.verdict === 'FARM'
          ? `Verdict FARM: at the low end of the value band this position is worth about $${econ.evLow} against about $${econ.cost} of cost, a net of ${netText}, so farm it and keep the log.`
          : econ.verdict === 'THIN'
            ? `Verdict THIN: at the low end of the value band this position is worth about $${econ.evLow} against about $${econ.cost} of cost, a net of ${netText}, so farm it only with the minimum capital.`
            : `Verdict SKIP: at the low end of the value band this position is worth about $${econ.evLow} against about $${econ.cost} of cost, a net of ${netText}, so skip it unless you already use the protocol.`,
      cost: `about $${econ.cost} all in`,
      time: '2 minutes to decide',
    });
  }
  return steps;
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, variant: Variant, curve: CurveFit | null): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  let pool: SnapshotProtocol[];
  if (variant.use_curve) {
    // The clean board: every protocol the watchlist rule keeps, floor or not.
    pool = snapshot.protocols.filter((p) => !chosen.has(p.slug) && isClean(p));
  } else {
    // Variant A: the starter's early radar, by TVL, capped.
    pool = snapshot.protocols
      .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
      .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
      .slice(0, 160);
  }
  for (const p of pool) chosen.set(p.slug, p);

  const factor = curve !== null ? curve.loo_factor : 1;
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, variant, curve);
    const bandLow = Math.max(1, Math.round(v.implied / factor));
    const bandHigh = Math.round(v.implied * factor);
    const econ = farmEconomics(p, v.age, bandLow);
    return { p, v, bandLow, bandHigh, econ };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    curve_usd: s.v.curveUsd,
    band_low_usd: s.bandLow,
    band_high_usd: s.bandHigh,
    farm_cost_usd: s.econ.cost,
    ev_low_usd: s.econ.evLow,
    net_low_usd: s.econ.net,
    verdict: s.econ.verdict,
    model: {
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      chain_multiplier: round4(s.v.chainMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age, variant, s.econ).map(stepText),
  }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    curve_usd: row.curve_usd,
    band_low_usd: row.band_low_usd,
    band_high_usd: row.band_high_usd,
    farm_cost_usd: row.farm_cost_usd,
    ev_low_usd: row.ev_low_usd,
    net_low_usd: row.net_low_usd,
    verdict: row.verdict,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, variant: Variant): { board: BoardRow[]; radar: RadarData; curve: CurveFit | null } {
  const curve = variant.use_curve ? fitCurve(snapshot, variant) : null;
  const board = buildBoard(snapshot, variant, curve);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const verdict_counts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) verdict_counts[r.verdict]++;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: variant,
    curve,
    model_version: variant.model_version,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    verdict_counts,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, curve };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
