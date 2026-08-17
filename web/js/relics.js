/* relics.js — the shop, the relic catalog, and how relics change a roll.
 * PURE: no DOM. craps.html owns the felt/dice; this owns relic data + effects.
 *
 * Effect logic is a faithful JS port of the C# Simulator (Simulator/Program.cs),
 * so the in-game numbers match the measured relic power budget
 * (DESIGN/RelicPowerBudget.md). Prices/tiers come straight from that doc:
 *   Common 2-6 PP -> 5 Markers · Uncommon 7-12 PP -> 10 · Rare 15-20 PP -> 20
 *   Vouchers -> 15. Roughly price ~= 1.2 x PP.
 *
 * Relic families (from project memory):
 *   payout  — occupies a shared relic slot; multiplies a bet's winnings globally.
 *   felt    — installs onto ONE bet spot, spent (no slot); multiplies that spot.
 *   face    — installs onto ONE die face (Roxy=die1 / Trixie=die2), spent (no slot).
 *   economy — occupies a slot; meta effects (interest, discount).
 *   voucher — permanent run upgrade, no slot (+relic slot, +bullet, cheaper reroll).
 *   table   — unlocks a new bet type on the felt (Place, ...).
 *   consumable — single-use, held in a small separate inventory.
 *
 * HEAVY CAVEAT: the budget found Heavy has ~zero synergy with felt/payout relics
 * and only ~1.48x with a same-die FACE relic; that design call is unresolved.
 * Heavy is included with its measured bias so the roster is complete, but don't
 * treat its balance as settled.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Relics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SLOTS = 5;
  const REROLL_BASE = 5, REROLL_STEP = 5;
  const MAX_CONSUMABLES = 2;
  const STARTER_UNLOCKS = ['pass', 'dp', 'come', 'field'];

  // die 1 = Roxy (physics lean), die 2 = Trixie (payout lean)
  const DIE = { ROXY: 1, TRIXIE: 2 };

  // ---- catalog ----------------------------------------------------------
  // pref: the die a face relic leans toward (soft, player can override).
  const CATALOG = [
    // -- payout relics (occupy a slot) --
    { id: 'pay_place68_25', name: 'Hot Sixes',   type: 'payout', tier: 'common',   price: 5,  mult: { place6: 1.25, place8: 1.25 }, desc: 'Place 6 & 8 pay +25%.' },
    { id: 'pay_place68_50', name: 'Corner Heat', type: 'payout', tier: 'uncommon', price: 10, mult: { place6: 1.5, place8: 1.5 },   desc: 'Place 6 & 8 pay +50%.' },
    { id: 'pay_place68_2x', name: 'Inside Job',  type: 'payout', tier: 'rare',     price: 20, mult: { place6: 2, place8: 2 },       desc: 'Place 6 & 8 pay DOUBLE.' },
    { id: 'pay_pass_2x',    name: 'Line Drive',  type: 'payout', tier: 'uncommon', price: 10, mult: { pass: 2 },                    desc: 'Pass Line pays DOUBLE.' },
    { id: 'pay_pass_3x',    name: 'Frontrunner', type: 'payout', tier: 'rare',     price: 20, mult: { pass: 3 },                    desc: 'Pass Line pays TRIPLE.' },
    { id: 'pay_field_2x',   name: 'Open Range',  type: 'payout', tier: 'uncommon', price: 10, mult: { field: 2 },                   desc: 'Field wins pay DOUBLE.' },

    // -- felt relics (install on a bet spot, spent) --
    { id: 'felt_boost',     name: 'Loaded Spot', type: 'felt',   tier: 'common',   price: 6,  mult: 1.5, desc: 'Install on any bet spot: it pays +50%.' },

    // -- face relics: each is FIXED to a die (Roxy=1 / Trixie=2); the player still
    //    chooses WHICH of that die's 6 faces to install it on. Spent on install, no slot.
    { id: 'face_gold_t',  name: 'Golden Pips', type: 'face', tier: 'common',   price: 5,  die: DIE.TRIXIE, face: { kind: 'gold', mult: 1 }, desc: '+$(current Min Bet) to your stake every time this face lands.' },
    { id: 'face_gold_r',  name: 'Golden Pips', type: 'face', tier: 'rare',     price: 20, die: DIE.ROXY,   face: { kind: 'gold', mult: 1 }, desc: '+$(current Min Bet) to your stake every time this face lands.' },
    { id: 'face_bullion', name: 'Bullion',     type: 'face', tier: 'uncommon', price: 10, die: DIE.TRIXIE, face: { kind: 'gold', mult: 2 }, desc: '+2x (current Min Bet) to your stake every time this face lands.' },
    { id: 'face_glass_t', name: 'Glass Pips',  type: 'face', tier: 'common',   price: 5,  die: DIE.TRIXIE, face: { kind: 'glass', mult: 2, brk: 0.25, diamond: 0.5 }, desc: 'DOUBLE a win this face helps make. 25% to break after; on break, 50% the next shop offers Diamond Pips.' },
    { id: 'face_glass_r', name: 'Glass Pips',  type: 'face', tier: 'rare',     price: 20, die: DIE.ROXY,   face: { kind: 'glass', mult: 2, brk: 0.25, diamond: 0.5 }, desc: 'DOUBLE a win this face helps make. 25% to break after; on break, 50% the next shop offers Diamond Pips.' },
    { id: 'face_crystal', name: 'Crystal Pips', type: 'face', tier: 'uncommon', price: 10, die: DIE.TRIXIE, face: { kind: 'glass', mult: 3, brk: 0.25, diamond: 1.0 }, desc: 'TRIPLE a win this face helps make. 25% to break after; on break, the next shop offers Diamond Pips.' },
    { id: 'face_diamond', name: 'Diamond Pips', type: 'face', tier: 'rare',    price: 25, die: DIE.TRIXIE, unique: true, face: { kind: 'glass', mult: 4, brk: 0, diamond: 0 }, desc: 'QUADRUPLE a win this face helps make. Only appears after a Glass/Crystal Pips breaks.' },
    { id: 'face_weighted', name: 'Weighted Side', type: 'face', tier: 'common', price: 5,  die: DIE.ROXY, face: { kind: 'heavy', bias: 1.0, adj: 0 }, desc: 'Weights this die so the OPPOSITE face lands more often (no adjacent boost). Best paired with a face relic on that opposite face, SAME die.' },
    { id: 'face_heavy',    name: 'Heavy Side',   type: 'face', tier: 'rare',   price: 20, die: DIE.ROXY, face: { kind: 'heavy', bias: 1.6, adj: 0.25 }, desc: 'Weights the OPPOSITE face even more than Weighted Side (+slight boost to adjacent faces). Best paired on the opposite face, SAME die.' },
    { id: 'face_magnet_r', name: 'Magnet Side', type: 'face', tier: 'uncommon', price: 10, die: DIE.ROXY,   face: { kind: 'magnet' }, desc: "This side can't be rolled while Magnet Side (Trixie) is also active." },
    { id: 'face_magnet_t', name: 'Magnet Side', type: 'face', tier: 'rare',     price: 20, die: DIE.TRIXIE, face: { kind: 'magnet' }, desc: "This side can't be rolled while Magnet Side (Roxy) is also active." },
    { id: 'face_guardian', name: 'Guardian',   type: 'face', tier: 'common',  price: 5,  die: DIE.TRIXIE, face: { kind: 'guardian' }, desc: 'If this side would make a 7 on a non-come-out roll, it becomes the OPPOSITE side instead (once per bullet).' },
    { id: 'face_critical', name: 'Critical Pips', type: 'face', tier: 'rare',  price: 20, die: DIE.TRIXIE, face: { kind: 'critical', chance: 0.05 }, desc: '5% chance to immediately WIN THE ANTE when this face comes up.' },
    { id: 'face_abbott',  name: 'Abbott',      type: 'face', tier: 'uncommon', price: 10, die: DIE.ROXY,   face: { kind: 'field', role: 'abbott' }, desc: 'Doubles Field payouts if this side is used to win a Field bet (Abbott + Costello together = 10x).' },
    { id: 'face_costello', name: 'Costello',   type: 'face', tier: 'rare',     price: 20, die: DIE.TRIXIE, face: { kind: 'field', role: 'costello' }, desc: 'Doubles Field payouts if this side is used to win a Field bet (Abbott + Costello together = 10x).' },

    // -- economy relics (occupy a slot) --
    { id: 'eco_interest', name: 'Interest',    type: 'economy', tier: 'uncommon', price: 10, economy: { kind: 'interest', per: 5, cap: 5 }, desc: 'At each shop, +1 Marker for every 5 Markers you hold (max +5).' },
    { id: 'eco_discount', name: 'Regular',     type: 'economy', tier: 'uncommon', price: 10, economy: { kind: 'discount', amount: 1 }, desc: 'Relics cost 1 Marker less.' },

    // -- vouchers (permanent, no slot) --
    { id: 'vou_slot',   name: 'Private Table', type: 'voucher', tier: 'rare', price: 15, voucher: { kind: 'slot', amount: 1 },   desc: '+1 relic slot, permanently this run.' },
    { id: 'vou_bullet', name: 'Extra Chamber', type: 'voucher', tier: 'rare', price: 15, voucher: { kind: 'bullet', amount: 1 }, desc: '+1 bullet every round, permanently this run.' },
    { id: 'vou_reroll', name: 'House Regular', type: 'voucher', tier: 'rare', price: 15, voucher: { kind: 'reroll', amount: 3 }, desc: 'Shop rerolls cost 3 Markers less (min 1).' },

    // -- table access (unlock a bet type) --
    { id: 'tbl_place', name: 'Place Bets', type: 'table', tier: 'uncommon', price: 10, table: { unlock: 'place' }, desc: 'Unlock Place bets on the number boxes (4·5·6·8·9·10) for the rest of the run.' },
    { id: 'tbl_buy',   name: 'Buy Bets',   type: 'table', tier: 'rare',     price: 15, table: { unlock: 'buy' },   desc: 'Unlock Buy bets (true odds, 5% vig) on the number boxes for the rest of the run.' },

    // -- consumables (single-use, held) --
    { id: 'con_comp',   name: 'Comp Chip',   type: 'consumable', tier: 'common', price: 4, consumable: { kind: 'comp', amount: 50 }, desc: 'Use anytime: +$50 to your current bullet stake.' },
    { id: 'con_loaded', name: 'Loaded Dice', type: 'consumable', tier: 'common', price: 5, consumable: { kind: 'loaded' }, desc: 'Arm it: your next roll cannot seven-out.' },
  ];

  const BY_ID = {};
  CATALOG.forEach((r) => { BY_ID[r.id] = r; });
  const def = (id) => BY_ID[id];

  // ---- run relic state --------------------------------------------------
  function initRun(run) {
    run.relics = [];                              // installed payout/economy relic ids (occupy slots)
    run.faces = { 1: [null, null, null, null, null, null], 2: [null, null, null, null, null, null] }; // die -> 6 face slots
    run.feltMult = {};                            // betKey -> product of felt installs
    run.vouchers = [];                            // voucher ids owned
    run.unlocks = {};                             // bet-type -> true
    STARTER_UNLOCKS.forEach((u) => { run.unlocks[u] = true; });
    run.consumables = [];                         // consumable ids held (<= MAX_CONSUMABLES)
    run.diamondOffer = false;                     // set when a Glass/Crystal breaks -> next shop offers Diamond Pips
    return run;
  }

  const slotsMax = (run) => DEFAULT_SLOTS + run.vouchers.filter((v) => def(v).voucher.kind === 'slot').reduce((a, v) => a + def(v).voucher.amount, 0);
  const slotsUsed = (run) => run.relics.length;
  const extraBullets = (run) => run.vouchers.filter((v) => def(v).voucher.kind === 'bullet').reduce((a, v) => a + def(v).voucher.amount, 0);
  const rerollDiscount = (run) => run.vouchers.filter((v) => def(v).voucher.kind === 'reroll').reduce((a, v) => a + def(v).voucher.amount, 0);
  const priceDiscount = (run) => run.relics.filter((id) => def(id).economy && def(id).economy.kind === 'discount').reduce((a, id) => a + def(id).economy.amount, 0);

  function priceOf(run, relic) {
    let p = relic.price;
    if (relic.type === 'payout' || relic.type === 'felt' || relic.type === 'face' || relic.type === 'economy') p -= priceDiscount(run);
    return Math.max(1, p);
  }
  const rerollCost = (run, rerollsThisVisit) => Math.max(1, REROLL_BASE + rerollsThisVisit * REROLL_STEP - rerollDiscount(run));

  const faceEmptyCount = (run) => run.faces[1].filter((x) => !x).length + run.faces[2].filter((x) => !x).length;

  // Can the player buy/accept this offer right now (slots / face room / dupes / already-unlocked)?
  function canAcquire(run, relic) {
    if (relic.type === 'payout' || relic.type === 'economy') return slotsUsed(run) < slotsMax(run);
    if (relic.type === 'face') return faceEmptyCount(run) > 0;
    if (relic.type === 'voucher') return !run.vouchers.includes(relic.id) || relic.voucher.kind === 'slot' || relic.voucher.kind === 'bullet';
    if (relic.type === 'table') return !run.unlocks[relic.table.unlock];
    if (relic.type === 'consumable') return run.consumables.length < MAX_CONSUMABLES;
    if (relic.type === 'felt') return true;
    return true;
  }

  // ---- acquiring --------------------------------------------------------
  function acquireSimple(run, relic) {
    // Everything except face + felt, which need an install target chosen by the caller.
    if (relic.type === 'payout' || relic.type === 'economy') run.relics.push(relic.id);
    else if (relic.type === 'voucher') run.vouchers.push(relic.id);
    else if (relic.type === 'table') run.unlocks[relic.table.unlock] = true;
    else if (relic.type === 'consumable') run.consumables.push(relic.id);
  }
  function installFace(run, relic, die, faceIdx) {
    if (relic.die && relic.die !== die) return false;   // this relic is fixed to its die
    if (run.faces[die][faceIdx]) return false;
    run.faces[die][faceIdx] = { id: relic.id, kind: relic.face.kind, die };
    return true;
  }
  // First installed face slot of a given kind (any die). Returns {die, idx, id} or null.
  function findFace(run, kind) {
    for (const die of [1, 2]) for (let idx = 0; idx < 6; idx++) {
      const s = run.faces[die][idx];
      if (s && s.kind === kind) return { die, idx, id: s.id };
    }
    return null;
  }
  function magnetIdx(run, die) { for (let i = 0; i < 6; i++) { const s = run.faces[die][i]; if (s && s.kind === 'magnet') return i; } return -1; }
  function installFelt(run, relic, betKey) {
    run.feltMult[betKey] = (run.feltMult[betKey] || 1) * relic.mult;
    return true;
  }

  // ---- effect logic -----------------------------------------------------
  // Per-die weights. A Heavy/Weighted face on face f boosts the OPPOSITE face
  // (7-f) by its bias, plus its four adjacent faces by bias*adj (Weighted adj=0,
  // Heavy adj=0.25). Magnet: if BOTH dice carry a Magnet face, each magnet face's
  // weight is zeroed so it can't be rolled (single Magnet does nothing).
  function diceWeights(run) {
    const w = { 1: [1, 1, 1, 1, 1, 1], 2: [1, 1, 1, 1, 1, 1] };
    [1, 2].forEach((die) => {
      run.faces[die].forEach((slot, idx) => {
        if (slot && slot.kind === 'heavy') {
          const f = idx + 1, opp = 7 - f, fc = def(slot.id).face, bias = fc.bias, adj = fc.adj || 0;
          w[die][opp - 1] += bias;
          if (adj > 0) for (let v = 1; v <= 6; v++) if (v !== f && v !== opp) w[die][v - 1] += bias * adj;
        }
      });
    });
    const m1 = magnetIdx(run, 1), m2 = magnetIdx(run, 2);
    if (m1 >= 0 && m2 >= 0) { w[1][m1] = 0; w[2][m2] = 0; }
    return w;
  }
  function rollWeighted(w, rng) {
    let total = 0; for (const x of w) total += x;
    let r = rng() * total;
    for (let i = 0; i < 6; i++) { r -= w[i]; if (r <= 0) return i + 1; }
    return 6;
  }
  // Roll both dice honouring Heavy/Magnet weights, then two seven-savers:
  //  - Loaded Dice (opts.noSeven): full redraw until it isn't a point-phase 7.
  //  - Guardian: if the guardian's OWN face made a point-phase 7, that die flips
  //    to its opposite face instead (once per bullet). bulletState.lastSwap flags
  //    that a swap happened (for the message). Returns [d1,d2].
  function rollDice(run, rng, bulletState, opts) {
    const w = diceWeights(run);
    let d1 = rollWeighted(w[1], rng), d2 = rollWeighted(w[2], rng);
    const pointPhase = !!(opts && opts.pointPhase);
    if (bulletState) bulletState.lastSwap = false;
    if (pointPhase && d1 + d2 === 7 && opts && opts.noSeven) {
      if (bulletState) bulletState.lastSwap = true;
      do { d1 = rollWeighted(w[1], rng); d2 = rollWeighted(w[2], rng); } while (d1 + d2 === 7);
      return [d1, d2];
    }
    if (pointPhase && d1 + d2 === 7 && bulletState && !bulletState.guardianUsed) {
      const g = findFace(run, 'guardian');
      if (g) {
        const fv = g.idx + 1;
        if ((g.die === 1 ? d1 : d2) === fv) {   // the guardian's own face is what made the 7
          if (g.die === 1) d1 = 7 - fv; else d2 = 7 - fv;
          bulletState.guardianUsed = true;
          bulletState.lastSwap = true;
        }
      }
    }
    return [d1, d2];
  }

  const shows = (die, faceIdx, d1, d2) => (die === 1 ? d1 : d2) === (faceIdx + 1);

  // Face on `die` at `idx` matching (kind, role) is currently showing?
  function faceShowing(run, kind, role, d1, d2) {
    for (const die of [1, 2]) for (let idx = 0; idx < 6; idx++) {
      const s = run.faces[die][idx];
      if (s && s.kind === kind && shows(die, idx, d1, d2) && def(s.id).face.role === role) return true;
    }
    return false;
  }

  // Post-resolution modifiers. `minBet` scales Gold faces. Returns
  // { extra, events, winAnte, diamondBreak }.
  function postResolve(run, res, d1, d2, bulletState, rng, minBet) {
    let extra = 0, winAnte = false, diamondBreak = false;
    const events = [];
    let baseWin = 0;
    for (const k in res.wins) baseWin += res.wins[k];

    // payout + felt multipliers (additive, per the budget)
    for (const k in res.wins) {
      let bonusMult = 0;
      run.relics.forEach((id) => { const m = def(id).mult; if (m && m[k]) bonusMult += m[k] - 1; });
      if (run.feltMult[k]) bonusMult += run.feltMult[k] - 1;
      if (bonusMult > 0) { const add = res.wins[k] * bonusMult; extra += add; events.push(`${k} +$${add.toFixed(0)}`); }
    }

    // face relics
    [1, 2].forEach((die) => {
      run.faces[die].forEach((slot, idx) => {
        if (!slot || !shows(die, idx, d1, d2)) return;
        const f = def(slot.id).face;
        if (f.kind === 'gold') { const amt = (f.mult || 1) * (minBet || 0); if (amt > 0) { extra += amt; events.push(`Gold +$${amt}`); } }
        else if (f.kind === 'critical') { if (rng() < f.chance) { winAnte = true; events.push('CRITICAL - Ante won!'); } }
        else if (f.kind === 'glass') {
          const bk = die + ':' + idx;
          bulletState.glassBroken = bulletState.glassBroken || {};
          if (baseWin > 0 && !bulletState.glassBroken[bk]) {
            const add = baseWin * (f.mult - 1);
            if (add > 0) { extra += add; events.push(`x${f.mult} +$${add.toFixed(0)}`); }
            if (f.brk > 0 && rng() < f.brk) {
              bulletState.glassBroken[bk] = true; events.push('shattered!');
              if (rng() < (f.diamond || 0)) diamondBreak = true;
            }
          }
        }
      });
    });

    // Abbott/Costello: double a Field win via a specific face; both showing = 10x
    if (res.wins.field) {
      const ab = faceShowing(run, 'field', 'abbott', d1, d2);
      const co = faceShowing(run, 'field', 'costello', d1, d2);
      const acMult = (ab && co) ? 10 : (ab || co) ? 2 : 1;
      if (acMult > 1) { const add = res.wins.field * (acMult - 1); extra += add; events.push(`Field x${acMult} +$${add.toFixed(0)}`); }
    }
    return { extra, events, winAnte, diamondBreak };
  }

  // ---- shop generation --------------------------------------------------
  const TIER_WEIGHT = { common: 60, uncommon: 30, rare: 10 };
  function weightedPick(pool, rng) {
    if (!pool.length) return null;
    let total = 0; pool.forEach((r) => { total += TIER_WEIGHT[r.tier] || 10; });
    let x = rng() * total;
    for (const r of pool) { x -= (TIER_WEIGHT[r.tier] || 10); if (x <= 0) return r; }
    return pool[pool.length - 1];
  }
  function sample(pool, n, rng) {
    const copy = pool.slice(), out = [];
    while (out.length < n && copy.length) {
      const pick = weightedPick(copy, rng);
      out.push(pick);
      copy.splice(copy.indexOf(pick), 1);
    }
    return out;
  }

  // Build a shop: 2 relics (payout/felt/face/economy mix), 1 consumable,
  // table access if anything's still locked, and an occasional voucher.
  function generateShop(run, rng) {
    const relicPool = CATALOG.filter((r) => ['payout', 'felt', 'face', 'economy'].includes(r.type) && !r.unique);
    const relics = sample(relicPool, 2, rng);
    // Diamond Pips only appears the shop AFTER a Glass/Crystal Pips broke.
    if (run.diamondOffer) { relics.unshift(def('face_diamond')); run.diamondOffer = false; }
    const consumables = sample(CATALOG.filter((r) => r.type === 'consumable'), 1, rng);
    const tablePool = CATALOG.filter((r) => r.type === 'table' && !run.unlocks[r.table.unlock]);
    const table = tablePool.length ? [weightedPick(tablePool, rng)] : [];
    const voucherPool = CATALOG.filter((r) => r.type === 'voucher' && canAcquire(run, r));
    const vouchers = (rng() < 0.5 && voucherPool.length) ? [weightedPick(voucherPool, rng)] : [];
    return { relics, consumables, table, vouchers };
  }

  // Interest paid on entering a shop (Balatro-style). Mutates run.markers.
  function payInterest(run) {
    let paid = 0;
    run.relics.forEach((id) => {
      const e = def(id).economy;
      if (e && e.kind === 'interest') paid += Math.min(e.cap, Math.floor(run.markers / e.per));
    });
    run.markers += paid;
    return paid;
  }

  return {
    CATALOG, DIE, DEFAULT_SLOTS, MAX_CONSUMABLES, STARTER_UNLOCKS,
    def, initRun, slotsMax, slotsUsed, extraBullets, faceEmptyCount,
    priceOf, rerollCost, canAcquire,
    acquireSimple, installFace, installFelt,
    diceWeights, rollDice, postResolve, generateShop, payInterest,
  };
});
