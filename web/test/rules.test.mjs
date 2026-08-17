// Mirror of RulesEngineTests/Program.cs against the JS port. Run: node web/test/rules.test.mjs
// Keeps the shippable JS resolver honest against the canonical C# spec.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const R = require('../js/craps-rules.js');
const { makeState, resolve, hasBet, Mode, Phase, PayoutTables } = R;

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL  ' + name); } };
const eq = (name, exp, act, tol = 0.001) => check(`${name} (expected ${exp}, got ${act})`, Math.abs(exp - act) < tol);

// Standard: come-out 7
{ const s = makeState(Mode.Standard); s.Bankroll = 1000; s.Bets.pass = 10; resolve(s, 3, 4);
  eq('Std Pass$10 comeout7 bankroll', 1020, s.Bankroll);
  check('Std Pass$10 comeout7 bet removed', !hasBet(s, 'pass'));
  check('Std Pass$10 comeout7 stays ComeOut', s.Phase === Phase.ComeOut); }

// Standard: come-out 3 loses pass
{ const s = makeState(Mode.Standard); s.Bankroll = 1000; s.Bets.pass = 10; resolve(s, 1, 2);
  eq('Std comeout3 bankroll unchanged', 1000, s.Bankroll);
  check('Std comeout3 pass removed', !hasBet(s, 'pass'));
  check('Std comeout3 stays ComeOut', s.Phase === Phase.ComeOut); }

// Standard: point set then made
{ const s = makeState(Mode.Standard); s.Bankroll = 1000; s.Bets.pass = 10; resolve(s, 2, 3);
  check('Std point set 5', s.Point === 5);
  check('Std phase Point', s.Phase === Phase.Point);
  resolve(s, 1, 4);
  eq('Std point 5 made bankroll', 1020, s.Bankroll);
  check('Std point made -> ComeOut', s.Phase === Phase.ComeOut);
  check('Std point made -> cleared', s.Point === null); }

// Standard: point then seven-out
{ const s = makeState(Mode.Standard); s.Bankroll = 1000; s.Bets.pass = 10; resolve(s, 2, 3); resolve(s, 3, 4);
  eq('Std seven-out bankroll', 1000, s.Bankroll);
  check('Std seven-out -> ComeOut', s.Phase === Phase.ComeOut); }

// Crapless: come-out 3 becomes point
{ const s = makeState(Mode.Crapless); s.Bankroll = 1000; s.Bets.pass = 10; resolve(s, 1, 2);
  eq('Crapless comeout3 bankroll unchanged', 1000, s.Bankroll);
  check('Crapless comeout3 pass active', hasBet(s, 'pass'));
  check('Crapless comeout3 point 3', s.Point === 3);
  check('Crapless comeout3 phase Point', s.Phase === Phase.Point);
  resolve(s, 1, 2);
  eq('Crapless point 3 made bankroll', 1020, s.Bankroll);
  check('Crapless point 3 made -> ComeOut', s.Phase === Phase.ComeOut); }

// Crapless: come-out 12 becomes point
{ const s = makeState(Mode.Crapless); s.Bankroll = 1000; s.Bets.pass = 10; resolve(s, 6, 6);
  eq('Crapless comeout12 bankroll unchanged', 1000, s.Bankroll);
  check('Crapless comeout12 point 12', s.Point === 12); }

// Field: profit only, stays
{ const s = makeState(Mode.Standard); s.Bankroll = 1000; s.Bets.field = 10; resolve(s, 1, 2);
  eq('Field$10 roll3 bankroll', 1010, s.Bankroll);
  check('Field$10 roll3 stays', hasBet(s, 'field'));
  const s2 = makeState(Mode.Standard); s2.Bankroll = 1000; s2.Bets.field = 10; resolve(s2, 1, 1);
  eq('Field$10 roll2 bankroll (2x)', 1020, s2.Bankroll); }

// Hardway: hard 6 pays 9x
{ const s = makeState(Mode.Standard); s.Bankroll = 1000; s.Bets.hard6 = 5; resolve(s, 3, 3);
  eq('Hard6 $5 bankroll', 1045, s.Bankroll); }

// Hop: 1-2 pays 15x
{ const s = makeState(Mode.Standard); s.Bankroll = 1000; s.Bets.hop12 = 1; resolve(s, 1, 2);
  eq('Hop 1-2 $1 bankroll', 1015, s.Bankroll); }

// Standard Come bet: wins on 7/11, loses on 2/3/12, else point
{ const s = makeState(Mode.Standard); s.Bankroll = 1000; s.Phase = Phase.Point; s.Point = 5; s.Bets.come = 10; resolve(s, 3, 4);
  eq('Std Come$10 roll7 bankroll', 1020, s.Bankroll);
  check('Std Come$10 roll7 cleared', s.ComeBets.length === 0);
  const s2 = makeState(Mode.Standard); s2.Bankroll = 1000; s2.Phase = Phase.Point; s2.Point = 5; s2.Bets.come = 10; resolve(s2, 5, 6);
  eq('Std Come$10 roll11 bankroll', 1020, s2.Bankroll);
  const s3 = makeState(Mode.Standard); s3.Bankroll = 1000; s3.Phase = Phase.Point; s3.Point = 5; s3.Bets.come = 10; resolve(s3, 1, 2);
  eq('Std Come$10 roll3 bankroll unchanged', 1000, s3.Bankroll);
  check('Std Come$10 roll3 removed', !hasBet(s3, 'come'));
  const s4 = makeState(Mode.Standard); s4.Bankroll = 1000; s4.Phase = Phase.Point; s4.Point = 5; s4.Bets.come = 10; resolve(s4, 2, 2);
  eq('Std Come$10 roll4 bankroll unchanged', 1000, s4.Bankroll);
  check('Std Come$10 roll4 -> come-point 4', s4.ComeBets.length === 1 && s4.ComeBets[0].Num === 4); }

// Crapless Come bet: wins only on 7, else point (11 becomes point)
{ const s = makeState(Mode.Crapless); s.Bankroll = 1000; s.Phase = Phase.Point; s.Point = 5; s.Bets.come = 10; resolve(s, 3, 4);
  eq('Crapless Come$10 roll7 bankroll', 1020, s.Bankroll);
  check('Crapless Come$10 roll7 cleared', s.ComeBets.length === 0);
  const s2 = makeState(Mode.Crapless); s2.Bankroll = 1000; s2.Phase = Phase.Point; s2.Point = 5; s2.Bets.come = 10; resolve(s2, 5, 6);
  eq('Crapless Come$10 roll11 bankroll unchanged', 1000, s2.Bankroll);
  check('Crapless Come$10 roll11 -> come-point 11', s2.ComeBets.length === 1 && s2.ComeBets[0].Num === 11);
  eq('Crapless OddsPay[11]==OddsPay[3]', PayoutTables.OddsPay[3], PayoutTables.OddsPay[11]); }

// Wins map instrumentation: place 6 win attributes to "place6"
{ const s = makeState(Mode.Standard); s.Bankroll = 0; s.Phase = Phase.Point; s.Point = 4; s.Bets.place6 = 30;
  const res = resolve(s, 3, 3);
  eq('Wins map place6 profit', 35, res.wins.place6 || 0); } // 30 * 7/6 = 35

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
