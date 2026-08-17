# Relic Power Budget

Measured 2026-08-13 with `Simulator/` against the real `CrapsResolver`.
200,000 rounds per config, fixed seed, baseline strategy **Pass $25 + Place 6/8 $30**,
**5 bullets × $100**. No Fold modelled (still undecided), so every figure is a
lower bound — but the *deltas* are fair, since baseline and relic runs share the
same omission and the same dice stream.

Sanity check: the harness reproduces the locked Ante 1 Small figure exactly
(70.3% clear at +$50), so these numbers sit on the same footing as the existing ladder.

---

## 1. The unit: Power Points (PP)

Round clear = `1 - (1-p)^N`, where `p` is the **single-bullet hit rate** and `N` the
bullet count. `p` is the only thing a relic can move, so it is the currency.

> **1 PP = +1 percentage point of single-bullet hit rate, at a stated target.**

PP is **target-dependent** — this is the whole point, not a caveat. Always quote a
relic's PP at the target it will be bought at.

**PP stacks linearly**, which is what makes it usable for pricing:

| Loadout | Measured | Sum of parts | Ratio |
|---|---|---|---|
| 2 relics | 6.13 PP | 5.65 PP | 1.08× |
| 3 relics | 10.15 PP | 10.39 PP | 0.98× |
| 4 relics | 17.50 PP | 19.55 PP | 0.90× |
| 5 relics | 38.77 PP | 34.74 PP | 1.12× |

No runaway compounding across a full 5-slot loadout. Add PP; don't multiply.

---

## 2. Measured values

Baseline: ROI **−2.6%**, p@+$50 = **21.6%**, round clear **70.3%**.

PP by target:

| Relic | +$50 | +$100 | +$300 | +$500 | ΔROI |
|---|---|---|---|---|---|
| Heavy ×1.5 (wrong face) | −0.54 | −0.45 | −0.14 | −0.03 | −1.8% |
| Economy: +$50/+$100 stake | 0.28 | 0.18 | 0.02 | 0.00 | 0.0% |
| Heavy ×1.5 (good face) | 0.47 | 0.38 | 0.11 | 0.02 | +1.5% |
| Heavy ×2.0 (good face) | 0.93 | 0.78 | 0.16 | 0.03 | +2.8% |
| Gold face $5 | 2.94 | 1.98 | 0.46 | 0.09 | +7.1% |
| Gold face $10 | 4.87 | 3.98 | 0.99 | 0.21 | +14.2% |
| Place 6/8 +25% | 5.07 | 3.68 | 1.34 | 0.33 | +14.2% |
| Glass 2× | 5.74 | 4.74 | 1.44 | 0.30 | +15.2% |
| Place 6/8 +50% | 7.47 | 6.74 | 3.29 | 0.85 | +28.4% |
| Glass 3× | 10.41 | 9.22 | 3.53 | 0.90 | +30.2% |
| Pass Line 2× | 11.22 | 9.16 | 3.14 | 0.86 | +31.1% |
| Place 6/8 2× | 17.98 | 15.71 | 6.71 | 2.58 | +56.8% |
| Pass Line 3× | 18.50 | 16.71 | 7.32 | 2.68 | +62.2% |
| Guardian (1 seven/hand) | 19.46 | 15.18 | 3.19 | 0.52 | +55.5% |

Voucher equivalence (round-level effects converted to PP via `1-(1-p)^N`):

| Voucher | +$50 | +$100 | +$300 |
|---|---|---|---|
| +1 bullet | +3.7 PP | +2.5 PP | +0.4 PP |
| +2 bullets | +6.9 PP | +4.7 PP | +0.8 PP |

---

## 3. Tier bands

| Tier | PP (at purchase target) | Examples |
|---|---|---|
| **Common** | 2–6 | Gold $5, Place 6/8 +25%, Glass 2× |
| **Uncommon** | 7–12 | Place 6/8 +50%, Glass 3×, Pass 2× |
| **Rare** | 15–20 | Place 6/8 2×, Pass 3×, Guardian |

Nothing should exceed ~20 PP in one slot. A full 5-slot rare loadout already clears
97.4% at +$100 — the ladder, not the relic cap, has to absorb late-game power.

**Marker prices** (ratios are the real output; absolute scale needs a per-round
Markers income figure, which isn't decided yet):

- Common — **5 Markers**
- Uncommon — **10 Markers**
- Rare — **20 Markers**
- Voucher — **15 Markers** (permanent, applies across all remaining rounds)

Roughly `price ≈ 1.2 × PP`, rounded. Set round income so a player affords about one
Common per shop early on, and re-derive once income exists.

---

## 4. Structural findings

### 4a. Only multiplicative relics survive the late game
Retention (PP at +$500 ÷ PP at +$50):

- Guardian **2.7%**, Gold $5 **3.1%**, Glass 2× **5.2%**
- Place 6/8 2× **14.4%**, Pass 3× **14.5%**

Flat and defensive relics keep ~3% of their power by +$500; multiplicative payout
relics keep ~14%. **A ~5× difference in scaling.** This mirrors Balatro's additive-vs-Mult
split, and it fell out of real craps math rather than being imposed.

Consequence for the shop: later shops must weight toward multiplicative payout relics,
or a player who bought well early still hits a wall.

### 4b. Guardian is a *rare*, and an early-game one
19.46 PP at +$50 — top of the scale, above Place 6/8 2×. But it collapses to 0.52 PP by
+$500. It extends the average hand from 8.5 to 13.3 rolls; surviving longer on a −EV
spread produces more rolls, not bigger wins. Price it as a rare, and expect players to
correctly sell it late. That's a good decision to hand them, not a bug.

### 4c. ⚠ Heavy is broken as designed — and the identity split makes it worse
Bare Heavy is worth **+0.47 PP** at ×1.5 bias, and **−0.54 PP** on the wrong face.
Every face pairs with something to make 7, so boosting any face also boosts sevens.

Combo test at +$100 (Heavy ×2.0 boosting Roxy's 3-face):

| Pairing | Sum of parts | Measured | Synergy |
|---|---|---|---|
| Heavy + **Place 6/8 +25%** (felt) | 4.46 | 4.52 | **1.01× — none** |
| Heavy + **Gold $5 on the boosted face** | 2.75 | 4.04 | **1.47×** |
| Heavy + **Glass 2× on the boosted face** | 5.47 | 8.08 | **1.48×** |

**This inverts the locked assumption.** The design has the everyday path as
"Roxy biases a number, a Felt enhancement on that bet spot cashes in," and the same-die
Heavy+payout-face pairing as the rare chase. The data says the everyday path has
**zero synergy** (purely additive) and the chase path is the only one that works.

Mechanically obvious in hindsight: Heavy boosts a *die face*, so a **face** enhancement
on that same face procs proportionally more often — direct multiplication. A **felt**
enhancement only cares about the *sum*, and boosting face 3 lifts 6 (3+3) and 8 (3+5)
while also lifting 7 (3+4), which cancels most of the gain.

Three ways out, no data preference between them — this is a design call:
1. **Flip the default.** Make same-die Heavy + face-enhancement the everyday combo, and
   soften the Roxy/Trixie split so both dice take both types. Costs the clean identity.
2. **Keep the split, re-role Heavy.** Accept Heavy as a cheap enabler that only pays off
   on the rare crossover, and price it as a Common at ~1 PP.
3. **Redefine Felt relics** to key off number *frequency* rather than flat payout, so
   Heavy's bias actually feeds them.

### 4d. Stake-boosting economy relics are dead on arrival
"+$50 starting stake" measures **+0.28 PP**, "+$100" measures the same. Under the locked
net-P/L rule the extra stake doesn't count toward the target, and the strategy's bet
sizes are fixed, so more ammo buys almost nothing. Either cut this archetype or give it
a different hook (e.g. scale bet sizes with stake).

---

## 5. What this unblocks

Ante 3–8 can now be calibrated honestly: pick a target per round, assume a realistic
relic count for that point in the run, and simulate. Reference points already measured
at 5 bullets:

| Loadout | +$50 | +$100 | +$150 | +$300 | +$500 |
|---|---|---|---|---|---|
| No relics | 70.3% | 50.4% | 34.4% | 8.4% | 1.1% |
| 5 mixed relics | 99.3% | 97.4% | 93.4% | 68.9% | 31.8% |
| 5 all-multiplicative | 99.9% | 99.6% | 98.6% | 92.1% | 70.1% |

A well-built endgame deck holds ~70–92% at +$500, so the Ante 8 target needs to sit
**well above +$500** for the last rounds to bite.
