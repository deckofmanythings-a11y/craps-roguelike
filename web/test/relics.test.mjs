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
  eq('base price', 5, R.priceOf(run, R.def('face_gold_t')));
  R.acquireSimple(run, R.def('eco_discount'));
  eq('discounted price', 4, R.priceOf(run, R.def('face_gold_t'))); }

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

// --- Golden Pips pays the current Min Bet when its face lands ---
{ const run = freshRun();
  R.installFace(run, R.def('face_gold_t'), 2, 3); // Trixie face value 4
  let r = R.postResolve(run, { wins: {} }, 6, 4, {}, () => 0.99, 10); // minBet 10, die2 shows 4
  near('Golden Pips pays +Min Bet', 10, r.extra);
  r = R.postResolve(run, { wins: {} }, 6, 5, {}, () => 0.99, 10);
  near('Golden Pips silent when face absent', 0, r.extra); }

// --- Bullion pays 2x Min Bet ---
{ const run = freshRun();
  R.installFace(run, R.def('face_bullion'), 2, 0); // Trixie face value 1
  const r = R.postResolve(run, { wins: {} }, 6, 1, {}, () => 0.99, 15);
  near('Bullion pays +2x Min Bet', 30, r.extra); }

// --- Glass doubles a win, can break, and a break can queue Diamond Pips ---
{ const run = freshRun();
  R.installFace(run, R.def('face_glass_t'), 2, 0); // Trixie face value 1
  const bs = {};
  const res = { wins: { field: 20 } };
  let r = R.postResolve(run, res, 6, 1, bs, () => 0.99, 5); // no break
  near('Glass x2 adds +20', 20, r.extra);
  check('no diamond without a break', r.diamondBreak === false);
  r = R.postResolve(run, res, 6, 1, bs, () => 0.01, 5); // breaks (0.01<.25) and queues diamond (0.01<.5)
  near('Glass still pays the turn it breaks', 20, r.extra);
  check('break queues Diamond Pips', r.diamondBreak === true);
  r = R.postResolve(run, res, 6, 1, bs, () => 0.99, 5);
  near('shattered glass pays nothing', 0, r.extra); }

// --- Diamond Pips only appears after a break flag is set ---
{ const run = freshRun();
  let shop = R.generateShop(run, () => 0.3);
  check('no Diamond by default', !shop.relics.some((x) => x.id === 'face_diamond'));
  run.diamondOffer = true;
  shop = R.generateShop(run, () => 0.3);
  check('Diamond offered after a break', shop.relics.some((x) => x.id === 'face_diamond'));
  check('diamondOffer cleared after showing', run.diamondOffer === false); }

// --- Weighted Side: opposite only. Heavy Side: opposite + adjacent ---
{ const run = freshRun();
  R.installFace(run, R.def('face_weighted'), 1, 0); // Roxy face1 -> boosts 6, no adjacent
  let w = R.diceWeights(run);
  eq('Weighted: opposite +bias', 2, w[1][5]);
  eq('Weighted: no adjacent boost', 1, w[1][1]);
  const run2 = freshRun();
  R.installFace(run2, R.def('face_heavy'), 1, 0);   // Heavy Side bias 1.6, adj .25
  w = R.diceWeights(run2);
  near('Heavy: opposite +1.6', 2.6, w[1][5]);
  near('Heavy: adjacent +bias*.25', 1.4, w[1][1]); }

// --- Magnet pair: both dice must carry a Magnet face to zero those faces ---
{ const run = freshRun();
  R.installFace(run, R.def('face_magnet_r'), 1, 2); // Roxy face3
  eq('single magnet does nothing', 1, R.diceWeights(run)[1][2]);
  R.installFace(run, R.def('face_magnet_t'), 2, 4); // Trixie face5
  const w = R.diceWeights(run);
  eq('both magnets: Roxy face3 zeroed', 0, w[1][2]);
  eq('both magnets: Trixie face5 zeroed', 0, w[2][4]); }

// --- Guardian flips its own face to the opposite on a point-phase 7 ---
{ const run = freshRun();
  R.installFace(run, R.def('face_guardian'), 2, 3); // Trixie face value 4
  const bs = {};
  let seq = [(3 - 0.5) / 6, (4 - 0.5) / 6]; let i = 0; // force d1=3, d2=4 (sum 7, die2 shows the guardian 4)
  const [d1, d2] = R.rollDice(run, () => seq[i++], bs, { pointPhase: true });
  check('guardian avoided the 7', d1 + d2 !== 7);
  eq('guardian flipped its die to opposite (3)', 3, d2);
  check('guardian marked used', bs.guardianUsed === true); }

// --- Critical Pips can win the ante ---
{ const run = freshRun();
  R.installFace(run, R.def('face_critical'), 2, 5); // Trixie face value 6
  check('Critical fires below chance', R.postResolve(run, { wins: {} }, 1, 6, {}, () => 0.01, 5).winAnte === true);
  check('Critical silent above chance', R.postResolve(run, { wins: {} }, 1, 6, {}, () => 0.99, 5).winAnte === false); }

// --- Abbott + Costello: single doubles a Field win, both = 10x ---
{ const run = freshRun();
  R.installFace(run, R.def('face_abbott'), 1, 2);   // Roxy face value 3
  near('Abbott alone doubles Field (+20)', 20, R.postResolve(run, { wins: { field: 20 } }, 3, 4, {}, () => 0.99, 5).extra);
  R.installFace(run, R.def('face_costello'), 2, 3); // Trixie face value 4
  near('Abbott + Costello = 10x Field (+180)', 180, R.postResolve(run, { wins: { field: 20 } }, 3, 4, {}, () => 0.99, 5).extra); }

// --- face relics are locked to their die on install ---
{ const run = freshRun();
  check('cannot install a Trixie relic on Roxy', R.installFace(run, R.def('face_gold_t'), 1, 0) === false);
  check('can install a Trixie relic on Trixie', R.installFace(run, R.def('face_gold_t'), 2, 0) === true); }

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
