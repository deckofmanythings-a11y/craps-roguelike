/* roguelike.js — the run / round / bullet / fold state machine for the craps
 * roguelike. PURE: no DOM, no resolver dependency. The table (craps.html) owns
 * the felt + CrapsResolver and reports each bullet's net P/L here; this module
 * owns the meta-loop (lives, folds, targets, the Ante ladder, Markers).
 *
 * LOCKED design (see project memory project-craps-unity-roguelike + the relic
 * budget): Option-4 INDEPENDENT-LIVES model. A round is a set of Bullets acting
 * like lives. One Bullet = one shooter's hand ($100 stake). The round clears the
 * instant ANY ONE bullet's own net P/L (ending value − 100) reaches the target
 * — NOT a cross-bullet sum. Leftover bullets convert to Markers on clear.
 *
 * PROVISIONAL (flagged, not locked — do not treat as final):
 *   - Ante 3-8 targets/bullets (Ante 1-2 are Monte-Carlo-locked; 3-8 need
 *     re-simulation WITH relics before they're real — see the budget memory).
 *   - Markers reward amounts (Markers income per round was "not yet decided").
 *   - Boss debuff assignments (the effects themselves wire in with the shop slice).
 *
 * BULLETS ARE HARD (per the casino's Make Bullets model, hard variant): each
 * bullet is a fixed $100 window you cannot exceed and cannot dip past into the
 * rest of your money. The run keeps a persistent TOTAL bankroll (run.bank);
 * every bullet's net P/L banks into it when the bullet ends. There is no Fold —
 * a bullet ends by seven-out or by hitting target; "next bullet" banks and deals
 * fresh. (Fold was a false start; the bullet system already covers it.)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Roguelike = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STAKE = 100;                 // LOCKED: one bullet stakes $100 (hard cap)
  // Minimum bet per ante (index 0-7). A bullet ends when you can't meet it. Rises
  // with the antes so late-game $100 bullets can't limp — they swing and resolve.
  const MIN_BET = [5, 5, 10, 10, 15, 15, 20, 25];
  const REWARD_BASE = 4;             // PROVISIONAL: Markers for clearing a round
  const REWARD_PER_LEFTOVER = 2;     // PROVISIONAL: Markers per unused bullet
  const ROUND_NAMES = ['Small', 'Big', 'Boss'];

  // Round config: { bullets, target, debuff? }.
  // Ante 1-2 LOCKED (no-relic floor). Ante 3-8 calibrated 2026-08-15 via the
  // continuous-play Simulator: a smooth escalating ladder whose targets a
  // representative +EV relic build clears ~80-100% while a no-relic build craters
  // (~61% -> ~3%). See project memory (SIM finding).
  const ANTES = [
    // Ante 1 — LOCKED
    [ { bullets: 5, target: 50 }, { bullets: 5, target: 75 }, { bullets: 4, target: 75, debuff: 'cold-table' } ],
    // Ante 2 — LOCKED
    [ { bullets: 5, target: 100 }, { bullets: 4, target: 100 }, { bullets: 4, target: 150, debuff: 'the-grind' } ],
    // Ante 3-8 — calibrated (continuous-play model)
    [ { bullets: 4, target: 300 },  { bullets: 4, target: 400 },  { bullets: 3, target: 500,  debuff: 'vig-hike' } ],
    [ { bullets: 4, target: 600 },  { bullets: 4, target: 700 },  { bullets: 3, target: 800,  debuff: 'no-odds' } ],
    [ { bullets: 4, target: 900 },  { bullets: 3, target: 1050 }, { bullets: 3, target: 1200, debuff: 'short-money' } ],
    [ { bullets: 3, target: 1300 }, { bullets: 3, target: 1450 }, { bullets: 3, target: 1600, debuff: 'house-rules' } ],
    [ { bullets: 3, target: 1750 }, { bullets: 3, target: 1950 }, { bullets: 3, target: 2150, debuff: 'cold-table' } ],
    [ { bullets: 3, target: 2300 }, { bullets: 3, target: 2550 }, { bullets: 3, target: 2800, debuff: 'house-rules' } ],
  ];

  const DEBUFFS = {
    'cold-table':  { name: 'Cold Table',  desc: 'Field pays even money on 2 and 12 (no double).' },
    'the-grind':   { name: 'The Grind',   desc: 'Place 6 & 8 pay 6:5 instead of 7:6.' },
    'vig-hike':    { name: 'Vig Hike',    desc: 'Buy commission doubled to 10%.' },
    'no-odds':     { name: 'No Odds',     desc: 'Pass / Come odds are disabled this round.' },
    'short-money': { name: 'Short Money', desc: 'Hard cap on any single bet.' },
    'house-rules': { name: 'House Rules', desc: 'Hardway / Hop / Prop payouts reduced.' },
  };

  const TOTAL_ANTES = ANTES.length;

  function newRun() {
    return {
      anteIdx: 0,        // 0-based
      roundIdx: 0,       // 0 Small, 1 Big, 2 Boss
      markers: 0,
      bank: 0,           // persistent TOTAL bankroll — net P/L banked from every bullet
      relics: [],        // filled by the shop slice
      over: false,
      won: false,
      round: null,       // runtime round state, set by startRound
    };
  }

  function roundCfg(run) { return ANTES[run.anteIdx][run.roundIdx]; }
  function minBet(run) { return MIN_BET[Math.min(run.anteIdx, MIN_BET.length - 1)]; }

  function label(run) {
    return `Ante ${run.anteIdx + 1} · ${ROUND_NAMES[run.roundIdx]}`;
  }

  function debuffInfo(key) { return key ? DEBUFFS[key] : null; }

  // Begin the current round: seed its runtime counters.
  function startRound(run) {
    const cfg = roundCfg(run);
    run.round = {
      cfg,
      bulletsLeft: cfg.bullets,   // lives not yet started
      bulletsTotal: cfg.bullets,
      target: cfg.target,
      cleared: false,
      lost: false,
      bulletActive: false,
      bulletsPlayed: 0,
      leftoverBullets: 0,
      reward: 0,
    };
    return run.round;
  }

  // Can a new bullet be started? (lives remain, round still in progress)
  function canStartBullet(run) {
    const r = run.round;
    return !!r && !r.cleared && !r.lost && !r.bulletActive && r.bulletsLeft > 0;
  }

  // Start a bullet: consumes one life up front.
  function startBullet(run) {
    if (!canStartBullet(run)) return false;
    run.round.bulletsLeft--;
    run.round.bulletActive = true;
    return true;
  }

  // End the active bullet with its final net P/L (ending stake − STAKE). Banks
  // that net into the run's persistent total bankroll, then checks clear/loss.
  // Returns { cleared, lost, netPL }.
  function endBullet(run, netPL) {
    const r = run.round;
    if (!r || !r.bulletActive) return { cleared: false, lost: false, netPL: 0 };
    r.bulletActive = false;
    r.bulletsPlayed++;
    run.bank += netPL;   // TOTAL bankroll accumulates every bullet's result

    if (netPL >= r.target) {
      r.cleared = true;
      r.leftoverBullets = r.bulletsLeft;
      r.reward = REWARD_BASE + r.leftoverBullets * REWARD_PER_LEFTOVER;
      run.markers += r.reward;
    } else if (r.bulletsLeft <= 0) {
      r.lost = true;
    }
    return { cleared: r.cleared, lost: r.lost, netPL };
  }

  // Advance to the next round after a clear (Small→Big→Boss→next Ante).
  // Marks the run won after the final Boss. No-op if the run is over.
  function advance(run) {
    if (run.over) return run;
    run.roundIdx++;
    if (run.roundIdx > 2) {
      run.roundIdx = 0;
      run.anteIdx++;
      if (run.anteIdx >= TOTAL_ANTES) { run.over = true; run.won = true; run.anteIdx = TOTAL_ANTES - 1; }
    }
    run.round = null;
    return run;
  }

  return {
    STAKE, MIN_BET, ROUND_NAMES, ANTES, DEBUFFS, TOTAL_ANTES,
    REWARD_BASE, REWARD_PER_LEFTOVER,
    newRun, roundCfg, minBet, label, debuffInfo,
    startRound, canStartBullet, startBullet, endBullet, advance,
  };
});
