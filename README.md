# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sylaxai/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sylaxai/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar: every pre-token protocol priced off the ones that already trade. A log-log size curve (log10 market cap on log10 TVL) is fitted at run time on the snapshot's 90 live-token comparables and backtested two ways — leave-one-out x3.648 and time-split x2.1396 median factor error — then each protocol's implied value is the curve's prediction for its TVL times growth and maturity multipliers. The clean board holds 198 rows (the watchlist's own rule applied to the whole snapshot), and every farm plan is netted to the dollar at the low end of the value band with a FARM / THIN / SKIP verdict.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=wgbpxxkc&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
