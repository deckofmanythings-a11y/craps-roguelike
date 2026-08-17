/* craps-rules.js — the shippable JS craps resolver for the roguelike.
 *
 * Faithful port of the corrected C# engine in ../../RulesEngine/ (CrapsResolver,
 * PayoutTables, GameState). That C# copy stays the canonical BALANCE-TUNING spec
 * (the Simulator runs 200k-trial Monte Carlo against it); this JS copy is what
 * the game actually ships. KEEP THE TWO IN SYNC — any rules change goes in both,
 * and the Node test (web/test/rules.test.mjs) mirrors RulesEngineTests so a
 * divergence shows up as a failing assertion.
 *
 * Includes the fixes the C# port made over craps.html's original focusLocalResolve:
 *   - a fresh Come bet wins outright on 7 (both modes) / 11 (Standard only),
 *   - the seven-out branch no longer kills a waiting Come bet before it resolves,
 * plus the additive `wins` map (bet key -> profit) the relic layer needs to
 * scale a single bet's winnings.
 *
 * Works as a <script> global (window.CrapsRules) and as a Node ESM import.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrapsRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // JS Math.round rounds halves toward +Infinity; the C# port reproduced that
  // as Math.Floor(n*100+0.5)/100. Payouts are non-negative so the two agree.
  const round2 = (n) => Math.floor(n * 100 + 0.5) / 100;

  const PayoutTables = {
    OddsPay: { 2: 6, 3: 3, 4: 2, 5: 1.5, 6: 6 / 5, 8: 6 / 5, 9: 1.5, 10: 2, 11: 3, 12: 6 },
    // NumDef: {placeWin, placeDen, buyRatio}. Buy takes 5% vig off the win at resolve.
    NumDefs: {
      2:  { placeWin: 11, placeDen: 2, buyRatio: (119 / 20) / 0.95 },
      3:  { placeWin: 11, placeDen: 4, buyRatio: (59 / 20) / 0.95 },
      4:  { placeWin: 9,  placeDen: 5, buyRatio: 2 },
      5:  { placeWin: 7,  placeDen: 5, buyRatio: 1.5 },
      6:  { placeWin: 7,  placeDen: 6, buyRatio: 6 / 5 },
      8:  { placeWin: 7,  placeDen: 6, buyRatio: 6 / 5 },
      9:  { placeWin: 7,  placeDen: 5, buyRatio: 1.5 },
      10: { placeWin: 9,  placeDen: 5, buyRatio: 2 },
      11: { placeWin: 11, placeDen: 4, buyRatio: (59 / 20) / 0.95 },
      12: { placeWin: 11, placeDen: 2, buyRatio: (119 / 20) / 0.95 },
    },
    AllNums: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
    LowNums: [2, 3, 4, 5, 6],
    HighNums: [8, 9, 10, 11, 12],
    AllBonusNums: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
    HardNums: new Set([4, 6, 8, 10]),
    HopMap: {
      hop11: [1, 1], hop12: [1, 2], hop13: [1, 3], hop14: [1, 4], hop15: [1, 5], hop16: [1, 6],
      hop22: [2, 2], hop23: [2, 3], hop24: [2, 4], hop25: [2, 5], hop26: [2, 6],
      hop33: [3, 3], hop34: [3, 4], hop35: [3, 5], hop36: [3, 6],
      hop44: [4, 4], hop45: [4, 5], hop46: [4, 6],
      hop55: [5, 5], hop56: [5, 6],
      hop66: [6, 6],
    },
    LayPay:    { 4: 0.5, 5: 2 / 3, 6: 5 / 6, 8: 5 / 6, 9: 2 / 3, 10: 0.5 },
    DcOddsPay: { 4: 0.5, 5: 2 / 3, 6: 5 / 6, 8: 5 / 6, 9: 2 / 3, 10: 0.5 },
    round2,
  };

  const Mode = { Standard: 'Standard', Crapless: 'Crapless' };
  const Phase = { ComeOut: 'ComeOut', Point: 'Point' };

  function newBonus() {
    return {
      Low: 0, All: 0, High: 0, LowMax: 0, AllMax: 0, HighMax: 0,
      LowHit: [], HighHit: [], Open: true, Locked: false,
    };
  }

  function makeState(mode = Mode.Standard) {
    return {
      Mode: mode,
      Bankroll: 0,
      Bets: {},              // key -> stake
      ComeBets: [],          // {Num, Flat, Odds}
      DontComeBets: [],
      Phase: Phase.ComeOut,
      Point: null,
      BetsOn: true,
      BetsOffThisRoll: false,
      PassLocked: false,
      Bonus: newBonus(),
    };
  }

  const getBet = (s, k) => (s.Bets[k] || 0);
  const hasBet = (s, k) => !!s.Bets[k];
  const removeBet = (s, k) => { delete s.Bets[k]; };

  // Faithful port of CrapsResolver.Resolve. Mutates `s` in place and returns
  // { d1, d2, sum, returned, log, tag, wins }.
  function resolve(s, d1, d2) {
    const sum = d1 + d2;
    const hard = d1 === d2;
    let bankroll = s.Bankroll;
    let returned = 0;
    const log = [];
    const wins = {};
    const act = (s.Phase === Phase.Point || s.BetsOn) && !s.BetsOffThisRoll;

    function credit(key, amount) {
      if (amount === 0) return;
      wins[key] = wins[key] !== undefined ? round2(wins[key] + amount) : amount;
    }

    function payStays(key, ratio, label) {
      const st = getBet(s, key);
      if (st === 0) return;
      const p = round2(st * ratio);
      bankroll = round2(bankroll + p);
      returned = round2(returned + p);
      credit(key, p);
      log.push(`${label}: +${p.toFixed(2)} (stays)`);
    }

    function payReturn(key, ratio, label) {
      const st = getBet(s, key);
      if (st === 0) return;
      const p = round2(st * ratio);
      bankroll = round2(bankroll + st + p);
      returned = round2(returned + st + p);
      removeBet(s, key);
      credit(key, p);
      log.push(`${label}: +${p.toFixed(2)} (returned)`);
    }

    function lose(key, label) {
      const st = getBet(s, key);
      if (st === 0) return;
      removeBet(s, key);
      log.push(`${label}: lost ${st.toFixed(2)}`);
    }

    function sweepPlace() {
      for (const n of PayoutTables.AllNums) {
        for (const t of ['place', 'buy']) {
          const k = t + n;
          if (!hasBet(s, k)) continue;
          log.push(`${t === 'buy' ? 'Buy' : 'Place'} ${n}: lost ${getBet(s, k).toFixed(2)}`);
          removeBet(s, k);
        }
      }
    }

    function loseBonus() {
      if (s.Bonus.Low > 0) { log.push(`Bonus low: lost ${s.Bonus.Low.toFixed(2)}`); s.Bonus.Low = 0; }
      if (s.Bonus.All > 0) { log.push(`Bonus all: lost ${s.Bonus.All.toFixed(2)}`); s.Bonus.All = 0; }
      if (s.Bonus.High > 0) { log.push(`Bonus high: lost ${s.Bonus.High.toFixed(2)}`); s.Bonus.High = 0; }
      s.Bonus.LowHit = []; s.Bonus.HighHit = [];
      s.Bonus.LowMax = s.Bonus.AllMax = s.Bonus.HighMax = 0;
      s.Bonus.Open = true; s.Bonus.Locked = false;
    }

    function loseComeBetsSeven() {
      const ow = s.BetsOn;
      for (const cb of s.ComeBets) {
        log.push(`Come (${cb.Num}): lost ${cb.Flat.toFixed(2)}.`);
        if (cb.Odds > 0) {
          if (ow) log.push(`Come (${cb.Num}) odds: lost ${cb.Odds.toFixed(2)} — were working.`);
          else {
            bankroll = round2(bankroll + cb.Odds);
            log.push(`Come (${cb.Num}) odds: returned ${cb.Odds.toFixed(2)} — not working.`);
          }
        }
      }
      s.ComeBets = [];
    }

    if (sum === 7) loseBonus();

    // Landed Come bets resolve on their own number.
    const wc = getBet(s, 'come');
    if (sum !== 7) {
      const keep = [];
      for (const cb of s.ComeBets) {
        if (cb.Num !== sum) { keep.push(cb); continue; }
        const ow = s.BetsOn;
        const op = round2(cb.Odds * (PayoutTables.OddsPay[cb.Num] || 0));
        if (wc > 0 && wc === cb.Flat) {
          const pr = round2(cb.Flat + op);
          bankroll = round2(bankroll + pr);
          returned = round2(returned + pr);
          cb.Odds = 0;
          removeBet(s, 'come');
          credit('come' + cb.Num, round2(cb.Flat + op));
          log.push(`Come (${cb.Num}) wins — off and on. ${pr.toFixed(2)} returned, bet stays.`);
          keep.push(cb);
        } else {
          const tot = round2(cb.Flat + cb.Flat + cb.Odds + op);
          bankroll = round2(bankroll + tot);
          returned = round2(returned + tot);
          credit('come' + cb.Num, round2(cb.Flat + op));
          log.push(`Come (${cb.Num}) wins — ${tot.toFixed(2)} returned.`);
          if (cb.Odds > 0) log.push(`Come (${cb.Num}) odds ${ow ? 'win — were working.' : 'returned — not working.'}`);
        }
      }
      s.ComeBets = keep;
    }

    // Place/Buy resolve when their box number repeats.
    const def = PayoutTables.NumDefs[sum];
    if (sum !== 7 && def) {
      if (act) {
        const pk = 'place' + sum;
        if (hasBet(s, pk)) {
          const st = getBet(s, pk);
          const p = round2(st * def.placeWin / def.placeDen);
          bankroll = round2(bankroll + p);
          returned = round2(returned + p);
          credit(pk, p);
          log.push(`Place ${sum}: +${p.toFixed(2)} (stays)`);
        }
        const bk = 'buy' + sum;
        if (hasBet(s, bk)) {
          const st = getBet(s, bk);
          const gr = round2(st * def.buyRatio);
          const net = round2(gr - round2(gr * 0.05));
          bankroll = round2(bankroll + st + net);
          returned = round2(returned + st + net);
          removeBet(s, bk);
          credit(bk, net);
          log.push(`Buy ${sum}: +${net.toFixed(2)} (returned)`);
        }
      } else if (hasBet(s, 'place' + sum) || hasBet(s, 'buy' + sum)) {
        log.push(`Place/Buy ${sum}: off`);
      }
    }

    let tag = 'normal';
    if (s.Phase === Phase.ComeOut) {
      if (sum === 7) {
        tag = 'seven-win';
        const hasPass = hasBet(s, 'pass');
        const hasCome = s.ComeBets.length > 0;
        payReturn('pass', 1, 'Pass Line');
        lose('dp', "Don't Pass");
        const ow = s.BetsOn;
        if (hasCome) {
          if (hasPass) log.push('Front line winner — Pass Line wins.');
          log.push(ow ? 'Come bets lose — odds were working and also lost.' : 'Come bets lose — odds returned (not working).');
          loseComeBetsSeven();
        } else if (hasPass) log.push('Front line winner — Pass Line wins.');
        if (s.BetsOn) sweepPlace();
      } else if (s.Mode === Mode.Standard) {
        if (sum === 11) {
          tag = 'natural-win';
          if (hasBet(s, 'pass')) payReturn('pass', 1, 'Pass Line');
          lose('dp', "Don't Pass");
          log.push(`Natural ${sum} — Pass Line wins. Comes out again.`);
          if (s.Bonus.Open) { s.Bonus.Open = false; s.Bonus.Locked = true; }
        } else if (sum === 12) {
          tag = 'craps';
          if (hasBet(s, 'pass')) lose('pass', 'Pass Line');
          if (hasBet(s, 'dp')) {
            const st = getBet(s, 'dp');
            bankroll = round2(bankroll + st);
            returned = round2(returned + st);
            removeBet(s, 'dp');
            log.push("Don't Pass: push (12), bet returned.");
          }
          log.push(`Craps ${sum} — Pass Line loses. Comes out again.`);
          if (s.Bonus.Open) { s.Bonus.Open = false; s.Bonus.Locked = true; }
        } else if (sum === 2 || sum === 3) {
          tag = 'craps';
          if (hasBet(s, 'pass')) lose('pass', 'Pass Line');
          payReturn('dp', 1, "Don't Pass");
          log.push(`Craps ${sum} — Pass Line loses. Comes out again.`);
          if (s.Bonus.Open) { s.Bonus.Open = false; s.Bonus.Locked = true; }
        } else {
          if (s.Bonus.Open) { s.Bonus.Open = false; s.Bonus.Locked = true; }
          s.Point = sum; s.Phase = Phase.Point;
          if (hasBet(s, 'pass')) s.PassLocked = true;
          log.push(`Point is ${sum}`);
        }
      } else {
        // Crapless come-out: only 7 wins instantly; every other total becomes
        // the point (no craps-out, no natural on 11). See RulesEngine comment.
        if (s.Bonus.Open) { s.Bonus.Open = false; s.Bonus.Locked = true; }
        s.Point = sum; s.Phase = Phase.Point;
        if (hasBet(s, 'pass')) s.PassLocked = true;
        log.push(`Point is ${sum}`);
      }
    } else { // Point phase
      if (sum === 7) {
        tag = 'seven-out';
        const hadPass = hasBet(s, 'pass');
        const hadCome = s.ComeBets.length > 0;
        lose('pass', 'Pass Line');
        if (hasBet(s, 'passodds')) { log.push(`Pass Odds: lost ${getBet(s, 'passodds').toFixed(2)}`); removeBet(s, 'passodds'); }
        payReturn('dp', 1, "Don't Pass");
        if (hasBet(s, 'dpodds')) {
          const stake = getBet(s, 'dpodds');
          const ratio = (s.Point != null && PayoutTables.DcOddsPay[s.Point]) || 0;
          const op = round2(stake * ratio);
          bankroll = round2(bankroll + stake + op);
          returned = round2(returned + stake + op);
          credit('dpodds', op);
          log.push(`Don't Pass Odds: +${op.toFixed(2)} (returned)`);
          removeBet(s, 'dpodds');
        }
        sweepPlace();
        let msg = 'Seven-out — line away.';
        if (hadPass) msg += ' Pass Line loses.';
        if (hadCome) msg += ' Come bets lose.';
        log.push(msg);
        loseComeBetsSeven();
        // A waiting (not-yet-landed) Come bet is NOT killed here — it resolves
        // below on its own come-out logic, where 7 is a WIN in both modes.
        for (const dc of s.DontComeBets) {
          const ratio = PayoutTables.DcOddsPay[dc.Num] || 0;
          const op = round2(dc.Odds * ratio);
          const tot = round2(dc.Flat + dc.Flat + dc.Odds + op);
          bankroll = round2(bankroll + tot);
          returned = round2(returned + tot);
          credit('dc' + dc.Num, round2(dc.Flat + op));
          log.push(`Don't Come (${dc.Num}): +${tot.toFixed(2)} (returned)`);
        }
        s.DontComeBets = [];
        if (hasBet(s, 'dc')) lose('dc', "Don't Come (waiting)");
        s.PassLocked = false; s.Point = null; s.Phase = Phase.ComeOut;
        s.BetsOn = false; s.BetsOffThisRoll = false;
      } else if (s.Point != null && sum === s.Point) {
        payReturn('pass', 1, 'Pass Line');
        if (hasBet(s, 'passodds')) {
          const stake = getBet(s, 'passodds');
          const ratio = PayoutTables.OddsPay[s.Point] || 0;
          const op = round2(stake * ratio);
          bankroll = round2(bankroll + stake + op);
          returned = round2(returned + stake + op);
          credit('passodds', op);
          log.push(`Pass Odds: +${op.toFixed(2)} (returned)`);
          removeBet(s, 'passodds');
        }
        lose('dp', "Don't Pass");
        if (hasBet(s, 'dpodds')) { log.push(`Don't Pass Odds: lost ${getBet(s, 'dpodds').toFixed(2)}`); removeBet(s, 'dpodds'); }
        s.PassLocked = false; s.Point = null; s.Phase = Phase.ComeOut;
        s.BetsOn = false; s.BetsOffThisRoll = false;
        log.push('Point made!'); tag = 'point-made';
      }
    }

    // Don't Come landed bets lose if their number rolls before a 7.
    if (sum !== 7) {
      s.DontComeBets = s.DontComeBets.filter((dc) => {
        if (dc.Num !== sum) return true;
        log.push(`Don't Come (${dc.Num}): lost ${round2(dc.Flat + dc.Odds).toFixed(2)}`);
        return false;
      });
    }

    // Come waiting bet: personal come-out-style roll (see RulesEngine comment).
    if (hasBet(s, 'come')) {
      const flat = getBet(s, 'come');
      const winsOutright = sum === 7 || (s.Mode === Mode.Standard && sum === 11);
      const losesOutright = s.Mode === Mode.Standard && (sum === 2 || sum === 3 || sum === 12);
      if (winsOutright) {
        payReturn('come', 1, 'Come');
      } else if (losesOutright) {
        lose('come', 'Come');
      } else {
        removeBet(s, 'come');
        s.ComeBets.push({ Num: sum, Flat: flat, Odds: 0 });
        log.push(`Come → ${sum}`);
      }
    }

    // Don't Come waiting bet: inverted personal roll.
    if (hasBet(s, 'dc')) {
      const flat = getBet(s, 'dc');
      if (sum === 7 || sum === 11) lose('dc', "Don't Come");
      else if (sum === 2 || sum === 3) payReturn('dc', 1, "Don't Come");
      else if (sum === 12) {
        bankroll = round2(bankroll + flat);
        returned = round2(returned + flat);
        removeBet(s, 'dc');
        log.push("Don't Come: push (12), bet returned.");
      } else {
        removeBet(s, 'dc');
        s.DontComeBets.push({ Num: sum, Flat: flat, Odds: 0 });
        log.push(`Don't Come → ${sum}`);
      }
    }

    if (hasBet(s, 'field')) {
      const w = sum === 2 || sum === 3 || sum === 4 || sum === 9 || sum === 10 || sum === 11 || sum === 12;
      if (w) {
        const rx = (sum === 2 || sum === 12) ? 2 : 1;
        payStays('field', rx, 'Field' + ((sum === 2 || sum === 12) ? ' (2x)' : ''));
      } else lose('field', 'Field');
    }

    if (hasBet(s, 'any7')) { if (sum === 7) payStays('any7', 4, 'Seven'); else lose('any7', 'Seven'); }
    if (hasBet(s, 'midnight')) { if (sum === 12) payStays('midnight', 30, 'Midnight'); else lose('midnight', 'Midnight'); }
    if (hasBet(s, 'aces')) { if (sum === 2) payStays('aces', 30, 'Aces'); else lose('aces', 'Aces'); }
    if (hasBet(s, 'ace2')) { if (sum === 3) payStays('ace2', 15, 'Ace-Deuce'); else lose('ace2', 'Ace-Deuce'); }
    if (hasBet(s, 'yo')) { if (sum === 11) payStays('yo', 15, 'Yo'); else lose('yo', 'Yo'); }
    if (hasBet(s, 'anyCraps')) { if (sum === 2 || sum === 3 || sum === 12) payStays('anyCraps', 7, 'Any Craps'); else lose('anyCraps', 'Any Craps'); }

    if (hasBet(s, 'horn')) {
      const st = getBet(s, 'horn');
      const u = round2(st / 4);
      let pr = 0;
      if (sum === 2 || sum === 12) pr = round2(round2(u * 30) - round2(u * 3));
      else if (sum === 3 || sum === 11) pr = round2(round2(u * 15) - round2(u * 3));
      if (sum === 2 || sum === 3 || sum === 11 || sum === 12) {
        bankroll = round2(bankroll + st + pr);
        returned = round2(returned + st + pr);
        removeBet(s, 'horn');
        credit('horn', pr);
        log.push(`Horn: +${pr.toFixed(2)} (returned)`);
      } else lose('horn', 'Horn');
    }

    if (hasBet(s, 'cande')) {
      const st = getBet(s, 'cande');
      const h = round2(st / 2);
      if (sum === 2 || sum === 3 || sum === 12) {
        const p = round2(h * 7);
        bankroll = round2(bankroll + st + p);
        returned = round2(returned + st + p);
        removeBet(s, 'cande');
        credit('cande', p);
        log.push(`C&E (craps): +${p.toFixed(2)} (returned)`);
      } else if (sum === 11) {
        const p = round2(h * 15);
        bankroll = round2(bankroll + st + p);
        returned = round2(returned + st + p);
        removeBet(s, 'cande');
        credit('cande', p);
        log.push(`C&E (eleven): +${p.toFixed(2)} (returned)`);
      } else lose('cande', 'C&E');
    }

    if (hasBet(s, 'eleven')) { if (sum === 11) payStays('eleven', 15, 'Eleven'); else lose('eleven', 'Eleven'); }

    const hardTargets = { hard4: 4, hard6: 6, hard8: 8, hard10: 10 };
    const hardMult = { hard4: 7, hard6: 9, hard8: 9, hard10: 7 };
    for (const k of Object.keys(hardTargets)) {
      const t = hardTargets[k];
      if (!hasBet(s, k)) continue;
      const label = k.replace('hard', 'Hard ');
      if (sum === t && hard) payStays(k, hardMult[k], label);
      else if (sum === 7 || (sum === t && !hard)) lose(k, label);
    }

    for (const key of Object.keys(PayoutTables.HopMap)) {
      const [a, b] = PayoutTables.HopMap[key];
      if (!hasBet(s, key)) continue;
      const isH = a === b;
      const m = (d1 === a && d2 === b) || (d1 === b && d2 === a);
      if (m) payStays(key, isH ? 30 : 15, `Hop ${a}-${b}`);
      else lose(key, `Hop ${a}-${b}`);
    }

    if (sum !== 7) {
      if (PayoutTables.LowNums.includes(sum) && !s.Bonus.LowHit.includes(sum)) s.Bonus.LowHit.push(sum);
      if (PayoutTables.HighNums.includes(sum) && !s.Bonus.HighHit.includes(sum)) s.Bonus.HighHit.push(sum);

      if (s.Bonus.Low > 0 && PayoutTables.LowNums.every((n) => s.Bonus.LowHit.includes(n))) {
        const st = s.Bonus.Low, p = round2(st * 30);
        bankroll = round2(bankroll + st + p);
        returned = round2(returned + st + p);
        s.Bonus.Low = 0; s.Bonus.LowMax = 0; s.Bonus.LowHit = [];
        credit('bonusLow', p);
        log.push(`Low Rolls WON! +${p.toFixed(2)} (returned)`);
      }
      if (s.Bonus.High > 0 && PayoutTables.HighNums.every((n) => s.Bonus.HighHit.includes(n))) {
        const st = s.Bonus.High, p = round2(st * 30);
        bankroll = round2(bankroll + st + p);
        returned = round2(returned + st + p);
        s.Bonus.High = 0; s.Bonus.HighMax = 0; s.Bonus.HighHit = [];
        credit('bonusHigh', p);
        log.push(`High Rolls WON! +${p.toFixed(2)} (returned)`);
      }
      if (s.Bonus.All > 0 && PayoutTables.AllBonusNums.every((n) => s.Bonus.LowHit.includes(n) || s.Bonus.HighHit.includes(n))) {
        const st = s.Bonus.All, p = round2(st * 155);
        bankroll = round2(bankroll + st + p);
        returned = round2(returned + st + p);
        s.Bonus.All = 0; s.Bonus.AllMax = 0;
        credit('bonusAll', p);
        log.push(`Roll'em All WON! +${p.toFixed(2)} (returned)`);
      }
    }

    if (s.BetsOffThisRoll && s.Phase === Phase.Point) s.BetsOffThisRoll = false;

    s.Bankroll = bankroll;
    return { d1, d2, sum, returned, log, tag, wins };
  }

  return { PayoutTables, Mode, Phase, makeState, resolve, getBet, hasBet, round2 };
});
