// Tests for relics.js effect logic, pricing, install rules, shop gen.
// Run: node web/test/relics.test.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const R = require('../js/relics.js');
const RL = require('../js/roguelike.js');

let pass = 0, fail = 0;
const check = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL  ' + n); } };
const eq = (n, e, a) => check(`${n} (exp ${e}, got ${a})`, e === a);
const near = (n, e, a) => check(`${n} (exp ${e}, got ${a})`, Math.abs(e - a) < 1e-9);
const freshRun = () => R.initRun(RL.newRun());

// --- slots + acquire ---
{ const run = freshRun();
  eq('default slots', 5, R.slotsMax(run));
  R.acquireSimple(run, R.def('pay_pass_2x'));
  eq('slot used after payout', 1, R.slotsUsed(run));
  // fill to 5, then 6th blocked
  for (let i = 0; i < 4; i++) R.acquireSimple(run, R.def('pay_field_2x'));
  eq('5 slots used', 5, R.slotsUsed(run));
  check('cannot acquire past slot cap', !R.canAcquire(run, R.def('pay_pass_3x'))); }

// --- voucher: +1 slot ---
{ const run = freshRun();
  R.acquireSimple(run, R.def('vou_slot'));
  eq('slot voucher raises cap', 6, R.slotsMax(run));
  eq('bullet voucher count', 0, R.extraBullets(run));
  R.acquireSimple(run, R.def('vou_bullet'));
  eq('bullet voucher grants +1', 1, R.extraBullets(run)); }

// --- price discount economy relic ---
{ const run = freshRun();
  eq('base price', 5, R.priceOf(run, R.def('face_gold5')));
  R.acquireSimple(run, R.def('eco_discount'));
  eq('discounted price', 4, R.priceOf(run, R.def('face_gold5'))); }

// --- reroll cost climbs, voucher lowers ---
{ const run = freshRun();
  eq('reroll #0', 5, R.rerollCost(run, 0));
  eq('reroll #1', 10, R.rerollCost(run, 1));
  R.acquireSimple(run, R.def('vou_reroll'));
  eq('reroll #0 with voucher', 2, R.rerollCost(run, 0)); }

// --- payout relic multiplies the right bet's win (via wins map) ---
{ const run = freshRun();
  R.acquireSimple(run, R.def('pay_place68_2x')); // place6/8 x2 -> +100% extra
  const res = { wins: { place6: 35 } };
  const { extra } = R.postResolve(run, res, 3, 3, {}, () => 0.99);
  near('place6 2x adds +35', 35, extra); }

// --- felt relic installs on a spot and stacks additively with payout ---
{ const run = freshRun();
  R.installFelt(run, R.def('felt_boost'), 'field'); // +50%
  const res = { wins: { field: 20 } };
  const { extra } = R.postResolve(run, res, 1, 1, {}, () => 0.99);
  near('felt +50% on field adds +10', 10, extra); }

// --- gold face pays when that die shows that face ---
{ const run = freshRun();
  R.installFace(run, R.def('face_gold5'), 2, 3); // Trixie (die2) face value 4
  let res = { wins: {} };
  let r = R.postResolve(run, res, 6, 4, {}, () => 0.99); // die2 shows 4
  near('gold pays when face lands', 5, r.extra);
  r = R.postResolve(run, res, 6, 5, {}, () => 0.99);     // die2 shows 5, not 4
  near('gold silent when face absent', 0, r.extra); }

// --- glass doubles a win then can shatter once ---
{ const run = freshRun();
  R.installFace(run, R.def('face_glass2'), 2, 0); // Trixie face value 1
  const bs = {};
  const res = { wins: { field: 20 } };
  let r = R.postResolve(run, res, 6, 1, bs, () => 0.99); // baseWin 20, no shatter (0.99>0.25)
  near('glass x2 adds +20', 20, r.extra);
  r = R.postResolve(run, res, 6, 1, bs, () => 0.01);     // shatters this time
  near('glass still pays the turn it breaks', 20, r.extra);
  r = R.postResolve(run, res, 6, 1, bs, () => 0.99);     // broken now -> nothing
  near('shattered glass pays nothing', 0, r.extra); }

// --- heavy weights the opposite face most, adjacents slightly, self lowest ---
{ const run = freshRun();
  R.installFace(run, R.def('face_heavy'), 1, 0); // Roxy face value 1 -> boosts opposite (6)
  const w = R.diceWeights(run);
  eq('die1 face6 (opposite) full boost', 2, w[1][5]);   // 1 + bias(1)
  near('die1 face2 (adjacent) slight boost', 1.25, w[1][1]); // 1 + 1*0.25
  near('die1 face5 (adjacent) slight boost', 1.25, w[1][4]);
  eq('die1 face1 (heavy self) lowest/unchanged', 1, w[1][0]);
  eq('die2 untouched', 1, w[2][5]); }

// --- guardian swaps the first would-be seven-out in a hand ---
{ const run = freshRun();
  R.installFace(run, R.def('face_guardian'), 2, 5);
  const bs = {};
  // rng forces a 7 (3+4) first, then a 5 (2+3) on redraw
  let seq = [ (3-0.5)/6, (4-0.5)/6, (2-0.5)/6, (3-0.5)/6 ]; let i = 0;
  const rng = () => seq[i++];
  const [d1, d2] = R.rollDice(run, rng, bs, { pointPhase: true });
  check('guardian avoided the 7', d1 + d2 !== 7);
  check('guardian marked used', bs.guardianUsed === true); }

// --- shop generation shapes ---
{ const run = freshRun();
  const shop = R.generateShop(run, () => 0.3);
  eq('2 relics offered', 2, shop.relics.length);
  eq('1 consumable offered', 1, shop.consumables.length);
  eq('table access offered while a bet type is locked', 1, shop.table.length);
  // after unlocking every table bet type, no table offer
  run.unlocks.place = true; run.unlocks.buy = true;
  const shop2 = R.generateShop(run, () => 0.3);
  eq('no table offer once all unlocked', 0, shop2.table.length); }

// --- interest pays on shop entry ---
{ const run = freshRun(); run.markers = 12;
  R.acquireSimple(run, R.def('eco_interest')); // +1 per 5, cap 5
  const paid = R.payInterest(run);
  eq('interest on 12 markers', 2, paid);
  eq('markers after interest', 14, run.markers); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
