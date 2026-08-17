// State-machine tests for roguelike.js. Run: node web/test/roguelike.test.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const RL = require('../js/roguelike.js');

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL  ' + name); } };
const eq = (name, exp, act) => check(`${name} (expected ${exp}, got ${act})`, exp === act);

// --- fresh run starts at Ante 1 Small, locked config ---
{ const run = RL.newRun();
  eq('new run ante', 0, run.anteIdx);
  eq('new run round', 0, run.roundIdx);
  eq('new run markers', 0, run.markers);
  const cfg = RL.roundCfg(run);
  eq('A1 Small bullets', 5, cfg.bullets);
  eq('A1 Small target', 50, cfg.target);
  check('A1 Small label', RL.label(run) === 'Ante 1 · Small'); }

// --- a bullet that hits target clears the round; leftover bullets -> markers ---
{ const run = RL.newRun(); RL.startRound(run);
  RL.startBullet(run);                       // 5 -> 4 left
  const r1 = RL.endBullet(run, 20);          // below +50, no clear
  check('miss no clear', !r1.cleared && !r1.lost);
  eq('bullets left after 1 miss', 4, run.round.bulletsLeft);
  RL.startBullet(run);                        // 4 -> 3 left
  const r2 = RL.endBullet(run, 60);          // >= +50 -> CLEAR with 3 leftover
  check('hit clears', r2.cleared);
  eq('leftover bullets', 3, run.round.leftoverBullets);
  // reward = base 4 + 3*2 = 10
  eq('markers on clear', RL.REWARD_BASE + 3 * RL.REWARD_PER_LEFTOVER, run.markers); }

// --- total bankroll accumulates every bullet's net P/L (banks each bullet) ---
{ const run = RL.newRun(); RL.startRound(run);
  eq('bank starts at 0', 0, run.bank);
  RL.startBullet(run); RL.endBullet(run, -40);   // lost 40 this bullet
  eq('bank after -40', -40, run.bank);
  RL.startBullet(run); RL.endBullet(run, 25);    // won 25 (still below +50, no clear)
  eq('bank after +25', -15, run.bank);
  check('still playing', !run.round.cleared && !run.round.lost); }

// --- running out of bullets below target loses the round ---
{ const run = RL.newRun(); RL.startRound(run);
  let last;
  for (let i = 0; i < 5; i++) { RL.startBullet(run); last = RL.endBullet(run, 10); }
  check('5 misses -> lost', last.lost && !last.cleared);
  check('cannot start a 6th bullet', !RL.canStartBullet(run));
  eq('no markers on loss', 0, run.markers);
  eq('bank reflects 5x +10', 50, run.bank); }

// --- no fold mechanic remains ---
{ const run = RL.newRun(); RL.startRound(run);
  check('no foldsLeft on round', run.round.foldsLeft === undefined);
  check('no FOLDS_PER_ROUND export', RL.FOLDS_PER_ROUND === undefined); }

// --- advance walks Small -> Big -> Boss -> next Ante Small ---
{ const run = RL.newRun();
  RL.advance(run); eq('after advance roundIdx', 1, run.roundIdx); eq('same ante', 0, run.anteIdx);
  RL.advance(run); eq('to boss', 2, run.roundIdx);
  RL.advance(run); eq('wrap to next ante', 0, run.roundIdx); eq('ante bumped', 1, run.anteIdx); }

// --- beating the final Boss wins the run ---
{ const run = RL.newRun();
  // 8 antes * 3 rounds = 24 advances to finish
  for (let i = 0; i < RL.TOTAL_ANTES * 3; i++) RL.advance(run);
  check('run over', run.over);
  check('run won', run.won); }

// --- boss rounds carry a debuff with display info ---
{ const run = RL.newRun(); run.roundIdx = 2;
  const cfg = RL.roundCfg(run);
  check('A1 boss has debuff key', !!cfg.debuff);
  check('debuff resolves to info', !!RL.debuffInfo(cfg.debuff).name); }

// --- all antes calibrated (no provisional flags) and targets non-decreasing ---
{ let provCount = 0; RL.ANTES.forEach((ante) => ante.forEach((r) => { if (r.prov) provCount++; }));
  eq('no provisional flags remain', 0, provCount);
  let prev = 0, mono = true;
  RL.ANTES.forEach((ante) => ante.forEach((r) => { if (r.target < prev) mono = false; prev = r.target; }));
  check('targets non-decreasing across the whole ladder', mono); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
