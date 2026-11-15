# Token Radar — method

## Thesis

Token launches are priced on size. Across this snapshot's 90 live-token
comparables, log market cap = 3.94 + 0.41 x log TVL, and the only adjustment
the forward test supports is chain breadth: each doubling of chain count
multiplies predicted market cap by 0.87x. Age, 7-day growth and category all
failed the forward test and were left out. The board is that curve, netted at
the low end of its own error band, against the real cost of farming.

## The method, in five steps

1. Fit the size curve on the snapshot's 90 live-token comparables (exchange
   and bridge tokens excluded: their tokens price on different economics).
2. Backtest it two ways: leave-one-out, and a forward time-split (fit on
   protocols listed before 2024, test on those listed after).
3. Rank the 198 clean pre-token protocols by implied value — the watchlist's
   own rule, applied to the whole snapshot, floor or not.
4. Net the farm economics at the low end of the value band, not the middle.
5. Say SKIP when the numbers say SKIP: 129 of 198 rows are SKIP.

## Evidence

- Curve: log10(mcap) = 3.9405 + 0.4092 x log10(TVL) - 0.1999 x log10(chains).
- Leave-one-out: median error x3.4652, 34.4% of predictions within 2x.
- Time-split: x2.1412, 47.5% within 2x (fit on 28, test on 40).
- 5-fold cross-validation: x3.5621, 35.6% within 2x.
- Live cross-check (CoinGecko + Dexscreener, 16 Nov, research only, grading
  is offline): the 20 largest comparables trade at 0.71-1.09x their snapshot
  market cap (median 0.926) — the snapshot is two days old and not stale. The
  chain coefficient keeps its sign live (-0.27 vs -0.20). Trading volume
  (r = -0.04) and DEX liquidity (r = -0.29, n = 9, not significant) do not
  predict the curve residual, so neither enters the model.
- Wallet counts, checked against real distributions: Arbitrum paid $1.97B to
  600,000+ wallets; Hyperliquid paid about 94,000 recipients, average $200+.
  The model (TVL / $2,000 per wallet, clamped 1,000-500,000) sits in the
  observed range.

## What we tested and rejected

Sixteen specifications were tried against the same 90 comparables. Only log
TVL + log chains improves leave-one-out and 5-fold CV without hurting the
forward time-split. The two that looked better and were rejected anyway:

- Category-median multiple: LOO x2.03, split x2.13, 5-fold x2.33 — until the
  median was computed from the training set only, when it collapsed to LOO
  x4.57, split x3.32, 5-fold x4.83. The win was leakage: each held-out
  protocol was predicted partly from itself. Rejected.
- Median-TVL hinge (the curve bends for giants): LOO x3.08, split x2.14,
  5-fold x3.35 — but the forward test is flat and the effect vanishes at
  other hinge points (split x2.96 at the first quartile, x2.55 at the third).
  Threshold-fragile. Not promoted.
- Old-protocol dummy (listed 3+ years ago): LOO x3.07, split x2.14, 5-fold
  x3.46 — but the split cannot test it at all: no old protocol sits in the
  post-2024 test set. Not promoted.
- Age, 7-day change, category dummies, quadratic TVL, Huber-robust,
  TVL-per-chain, sqrt-TVL weighting: all fail the time-split.

## Farm economics

Cost is 12 actions of gas on the protocol's first chain plus 4% a year on
the capital held. Value at the band's low end assumes 5% of a launch reaches
farmers, split over an estimated wallet count (TVL / $2,000 average deposit,
clamped 1,000-500,000). FARM when that value is at least 3x the cost, THIN
when it covers the cost, else SKIP. Best farm pick: Manifest Trade (rank 76,
Solana, TVL $9.1M) — about $23 per wallet against about $1 of cost, net
+$22. The pick is recomputed from the board, not hardcoded.

## What the curve cannot see

Points programs, team quality, tokenomics, unlocks and sybil filtering are
not in the snapshot, so they are not in the value. The band (x3.47) is the
honest size of that ignorance. One qualitative flag: token-holder rights vary
by category — derivatives tokens are the best aligned with holders, while
stablecoin and RWA tokens deliver almost nothing to theirs (DefiLlama
token-rights analysis). The snapshot has no fee or revenue fields, so this is
a flag for the farmer, not a model input.

## What would change our mind

A comparable set with fee and revenue fields would let us test a
revenue-based curve. A larger comparable set would let us test category
curves. Until then, the curve above is the strongest statement this snapshot
supports — and the board says SKIP for 129 of 198 rows because the numbers
say so, not because we are cautious.
