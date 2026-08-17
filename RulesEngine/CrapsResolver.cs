using System.Collections.Generic;
using System.Linq;

namespace CrapsRules
{
    public class RollResult
    {
        public int D1, D2, Sum;
        public double Returned;
        public List<string> Log = new List<string>();
        public string Tag = "normal"; // "normal" | "seven-win" | "natural-win" | "craps" | "seven-out" | "point-made"

        // Per-bet PROFIT breakdown for this roll (bet key -> winnings, excluding
        // the returned stake). Purely additive instrumentation -- nothing in the
        // resolver reads it, so it cannot change resolution behaviour. Exists so
        // callers can attribute a win to the specific bet that produced it:
        // the roguelike layer's payout/felt relics ("Place 6/8 pays 1.2x") need
        // to scale one bet's win without re-deriving payout math outside this
        // file, and the win animation needs to know which spot to light up.
        // Landed Come/Don't Come bets are keyed "come<N>"/"dc<N>" since several
        // can be live on different numbers at once.
        public Dictionary<string, double> Wins = new Dictionary<string, double>();
    }

    // Faithful port of focusmode.html's focusLocalResolve() (lines 5769-6067),
    // the client-side hand-copy of the server's roll-standard resolver, PLUS a
    // derived (not directly ported - see comment on the Crapless branch below)
    // come-out rule for Crapless mode, which has no client-side reference
    // implementation in the source repo.
    //
    // Mutates the given GameState in place and updates its Bankroll. Callers
    // that want the original's "attempt on a clone, discard on failure"
    // pattern should call state.Clone() first and only keep the clone on
    // success.
    public static class CrapsResolver
    {
        public static RollResult Resolve(GameState s, int d1, int d2)
        {
            int sum = d1 + d2;
            bool hard = d1 == d2;
            double bankroll = s.Bankroll;
            double returned = 0;
            var log = new List<string>();
            var winsByBet = new Dictionary<string, double>();
            bool act = (s.Phase == GamePhase.Point || s.BetsOn) && !s.BetsOffThisRoll;

            // Records profit against a bet key. Accumulates rather than assigns:
            // one roll can pay the same key twice (e.g. a Come bet going
            // off-and-on while another Come bet on the same number resolves).
            void Credit(string key, double amount)
            {
                if (amount == 0) return;
                winsByBet[key] = winsByBet.TryGetValue(key, out var v) ? PayoutTables.Round2(v + amount) : amount;
            }

            // ---- local helpers, mirroring pP/pR/lose/sweepPlace/loseComesBetsSeven/loseBonus ----
            void PayStays(string key, double ratio, string label)
            {
                double st = s.GetBet(key);
                if (st == 0) return;
                double p = PayoutTables.Round2(st * ratio);
                bankroll = PayoutTables.Round2(bankroll + p);
                returned = PayoutTables.Round2(returned + p);
                Credit(key, p);
                log.Add($"{label}: +{p:F2} (stays)");
            }

            void PayReturn(string key, double ratio, string label)
            {
                double st = s.GetBet(key);
                if (st == 0) return;
                double p = PayoutTables.Round2(st * ratio);
                bankroll = PayoutTables.Round2(bankroll + st + p);
                returned = PayoutTables.Round2(returned + st + p);
                s.RemoveBet(key);
                Credit(key, p);
                log.Add($"{label}: +{p:F2} (returned)");
            }

            void Lose(string key, string label)
            {
                double st = s.GetBet(key);
                if (st == 0) return;
                s.RemoveBet(key);
                log.Add($"{label}: lost {st:F2}");
            }

            void SweepPlace()
            {
                foreach (var n in PayoutTables.AllNums)
                foreach (var t in new[] { "place", "buy" })
                {
                    string k = t + n;
                    if (!s.HasBet(k)) continue;
                    log.Add($"{(t == "buy" ? "Buy" : "Place")} {n}: lost {s.GetBet(k):F2}");
                    s.RemoveBet(k);
                }
            }

            void LoseBonus()
            {
                if (s.Bonus.Low > 0) { log.Add($"Bonus low: lost {s.Bonus.Low:F2}"); s.Bonus.Low = 0; }
                if (s.Bonus.All > 0) { log.Add($"Bonus all: lost {s.Bonus.All:F2}"); s.Bonus.All = 0; }
                if (s.Bonus.High > 0) { log.Add($"Bonus high: lost {s.Bonus.High:F2}"); s.Bonus.High = 0; }
                s.Bonus.LowHit.Clear(); s.Bonus.HighHit.Clear();
                s.Bonus.LowMax = s.Bonus.AllMax = s.Bonus.HighMax = 0;
                s.Bonus.Open = true; s.Bonus.Locked = false;
            }

            void LoseComeBetsSeven()
            {
                bool ow = s.BetsOn;
                foreach (var cb in s.ComeBets)
                {
                    log.Add($"Come ({cb.Num}): lost {cb.Flat:F2}.");
                    if (cb.Odds > 0)
                    {
                        if (ow) log.Add($"Come ({cb.Num}) odds: lost {cb.Odds:F2} — were working.");
                        else
                        {
                            bankroll = PayoutTables.Round2(bankroll + cb.Odds);
                            log.Add($"Come ({cb.Num}) odds: returned {cb.Odds:F2} — not working.");
                        }
                    }
                }
                s.ComeBets.Clear();
            }
            // ---- end local helpers ----

            if (sum == 7) LoseBonus();

            // Landed Come bets resolve on their own number.
            double wc = s.GetBet("come");
            if (sum != 7)
            {
                var toRemove = new List<ComeBet>();
                foreach (var cb in s.ComeBets)
                {
                    if (cb.Num != sum) continue;
                    bool ow = s.BetsOn;
                    double op = PayoutTables.Round2(cb.Odds * (PayoutTables.OddsPay.TryGetValue(cb.Num, out var opv) ? opv : 0));
                    if (wc > 0 && wc == cb.Flat)
                    {
                        double pr = PayoutTables.Round2(cb.Flat + op);
                        bankroll = PayoutTables.Round2(bankroll + pr);
                        returned = PayoutTables.Round2(returned + pr);
                        cb.Odds = 0;
                        s.RemoveBet("come");
                        Credit("come" + cb.Num, PayoutTables.Round2(cb.Flat + op));
                        log.Add($"Come ({cb.Num}) wins — off and on. {pr:F2} returned, bet stays.");
                    }
                    else
                    {
                        double tot = PayoutTables.Round2(cb.Flat + cb.Flat + cb.Odds + op);
                        bankroll = PayoutTables.Round2(bankroll + tot);
                        returned = PayoutTables.Round2(returned + tot);
                        toRemove.Add(cb);
                        Credit("come" + cb.Num, PayoutTables.Round2(cb.Flat + op));
                        log.Add($"Come ({cb.Num}) wins — {tot:F2} returned.");
                        if (cb.Odds > 0)
                        {
                            if (ow) log.Add($"Come ({cb.Num}) odds win — were working.");
                            else log.Add($"Come ({cb.Num}) odds returned — not working.");
                        }
                    }
                }
                foreach (var cb in toRemove) s.ComeBets.Remove(cb);
            }

            // Place/Buy resolve when the box number they're on repeats.
            if (sum != 7 && PayoutTables.NumDefs.TryGetValue(sum, out var def))
            {
                if (act)
                {
                    string pk = "place" + sum;
                    if (s.HasBet(pk))
                    {
                        double st = s.GetBet(pk);
                        double p = PayoutTables.Round2(st * def.PlaceWin / def.PlaceDen);
                        bankroll = PayoutTables.Round2(bankroll + p);
                        returned = PayoutTables.Round2(returned + p);
                        Credit(pk, p);
                        log.Add($"Place {sum}: +{p:F2} (stays)");
                    }
                    string bk = "buy" + sum;
                    if (s.HasBet(bk))
                    {
                        double st = s.GetBet(bk);
                        double gr = PayoutTables.Round2(st * def.BuyRatio);
                        double net = PayoutTables.Round2(gr - PayoutTables.Round2(gr * 0.05));
                        bankroll = PayoutTables.Round2(bankroll + st + net);
                        returned = PayoutTables.Round2(returned + st + net);
                        s.RemoveBet(bk);
                        Credit(bk, net);
                        log.Add($"Buy {sum}: +{net:F2} (returned)");
                    }
                }
                else if (s.HasBet("place" + sum) || s.HasBet("buy" + sum))
                {
                    log.Add($"Place/Buy {sum}: off");
                }
            }

            string tag = "normal";
            if (s.Phase == GamePhase.ComeOut)
            {
                if (sum == 7)
                {
                    tag = "seven-win";
                    bool hasPass = s.HasBet("pass");
                    bool hasCome = s.ComeBets.Count > 0;
                    PayReturn("pass", 1, "Pass Line");
                    Lose("dp", "Don't Pass");
                    bool ow = s.BetsOn;
                    if (hasCome)
                    {
                        if (hasPass) log.Add("Front line winner — Pass Line wins.");
                        if (ow) log.Add("Come bets lose — odds were working and also lost.");
                        else log.Add("Come bets lose — odds returned (not working).");
                        LoseComeBetsSeven();
                    }
                    else if (hasPass) log.Add("Front line winner — Pass Line wins.");
                    if (s.BetsOn) SweepPlace();
                }
                else if (s.Mode == GameMode.Standard)
                {
                    if (sum == 11)
                    {
                        tag = "natural-win";
                        if (s.HasBet("pass")) PayReturn("pass", 1, "Pass Line");
                        Lose("dp", "Don't Pass");
                        log.Add($"Natural {sum} — Pass Line wins. Comes out again.");
                        if (s.Bonus.Open) { s.Bonus.Open = false; s.Bonus.Locked = true; }
                    }
                    else if (sum == 12)
                    {
                        tag = "craps";
                        if (s.HasBet("pass")) Lose("pass", "Pass Line");
                        if (s.HasBet("dp"))
                        {
                            double st = s.GetBet("dp");
                            bankroll = PayoutTables.Round2(bankroll + st);
                            returned = PayoutTables.Round2(returned + st);
                            s.RemoveBet("dp");
                            log.Add("Don't Pass: push (12), bet returned.");
                        }
                        log.Add($"Craps {sum} — Pass Line loses. Comes out again.");
                        if (s.Bonus.Open) { s.Bonus.Open = false; s.Bonus.Locked = true; }
                    }
                    else if (sum == 2 || sum == 3)
                    {
                        tag = "craps";
                        if (s.HasBet("pass")) Lose("pass", "Pass Line");
                        PayReturn("dp", 1, "Don't Pass");
                        log.Add($"Craps {sum} — Pass Line loses. Comes out again.");
                        if (s.Bonus.Open) { s.Bonus.Open = false; s.Bonus.Locked = true; }
                    }
                    else
                    {
                        if (s.Bonus.Open) { s.Bonus.Open = false; s.Bonus.Locked = true; }
                        s.Point = sum; s.Phase = GamePhase.Point;
                        if (s.HasBet("pass")) s.PassLocked = true;
                        log.Add($"Point is {sum}");
                    }
                }
                else
                {
                    // Crapless come-out: NOT ported from a client-side reference (none exists -
                    // focusmode.html only calls a `/roll-crapless` server endpoint by name,
                    // line 4731; the real resolver lives server-side and isn't in this repo).
                    // Derived instead from focusmode.html's own data: NUM_DEFS_CRAPLESS lists
                    // all of 2,3,4,5,6,8,9,10,11,12 as valid box numbers/points (lines 1809-1810),
                    // which only makes sense if none of them auto-resolve on come-out. So: only
                    // 7 wins instantly here; every other total becomes the point (no craps-out,
                    // no natural on 11). Don't Pass/Don't Come/Lay are omitted entirely because
                    // they're disabled in Crapless in the source UI (focusmode.html:4395-4396,
                    // 5704-5707). VERIFY this against your real server-side roll-crapless logic
                    // before trusting it for anything but a starting point.
                    if (s.Bonus.Open) { s.Bonus.Open = false; s.Bonus.Locked = true; }
                    s.Point = sum; s.Phase = GamePhase.Point;
                    if (s.HasBet("pass")) s.PassLocked = true;
                    log.Add($"Point is {sum}");
                }
            }
            else // Phase == Point
            {
                if (sum == 7)
                {
                    tag = "seven-out";
                    bool hadPass = s.HasBet("pass");
                    bool hadCome = s.ComeBets.Count > 0;
                    Lose("pass", "Pass Line");
                    if (s.HasBet("passodds"))
                    {
                        log.Add($"Pass Odds: lost {s.GetBet("passodds"):F2}");
                        s.RemoveBet("passodds");
                    }
                    PayReturn("dp", 1, "Don't Pass");
                    if (s.HasBet("dpodds"))
                    {
                        double stake = s.GetBet("dpodds");
                        double ratio = (s.Point.HasValue && PayoutTables.DcOddsPay.TryGetValue(s.Point.Value, out var dcp)) ? dcp : 0;
                        double op = PayoutTables.Round2(stake * ratio);
                        bankroll = PayoutTables.Round2(bankroll + stake + op);
                        returned = PayoutTables.Round2(returned + stake + op);
                        Credit("dpodds", op);
                        log.Add($"Don't Pass Odds: +{op:F2} (returned)");
                        s.RemoveBet("dpodds");
                    }
                    SweepPlace();
                    string msg = "Seven-out — line away.";
                    if (hadPass) msg += " Pass Line loses.";
                    if (hadCome) msg += " Come bets lose.";
                    log.Add(msg);
                    LoseComeBetsSeven();
                    // A waiting (not-yet-landed) Come bet is NOT killed here: per real craps
                    // rules it resolves on this same roll using its own come-out-style logic
                    // (see the Come-waiting-bet block below), and a 7 there is a WIN for it in
                    // both modes — simultaneously seven-out for the main line, a win for a
                    // freshly-placed Come bet. Confirmed by user 2026-07-28.
                    foreach (var dc in s.DontComeBets)
                    {
                        double ratio = PayoutTables.DcOddsPay.TryGetValue(dc.Num, out var dcp2) ? dcp2 : 0;
                        double op = PayoutTables.Round2(dc.Odds * ratio);
                        double tot = PayoutTables.Round2(dc.Flat + dc.Flat + dc.Odds + op);
                        bankroll = PayoutTables.Round2(bankroll + tot);
                        returned = PayoutTables.Round2(returned + tot);
                        Credit("dc" + dc.Num, PayoutTables.Round2(dc.Flat + op));
                        log.Add($"Don't Come ({dc.Num}): +{tot:F2} (returned)");
                    }
                    s.DontComeBets.Clear();
                    if (s.HasBet("dc")) Lose("dc", "Don't Come (waiting)");
                    s.PassLocked = false; s.Point = null; s.Phase = GamePhase.ComeOut;
                    s.BetsOn = false; s.BetsOffThisRoll = false;
                }
                else if (s.Point.HasValue && sum == s.Point.Value)
                {
                    PayReturn("pass", 1, "Pass Line");
                    if (s.HasBet("passodds"))
                    {
                        double stake = s.GetBet("passodds");
                        double ratio = PayoutTables.OddsPay.TryGetValue(s.Point.Value, out var pv) ? pv : 0;
                        double op = PayoutTables.Round2(stake * ratio);
                        bankroll = PayoutTables.Round2(bankroll + stake + op);
                        returned = PayoutTables.Round2(returned + stake + op);
                        Credit("passodds", op);
                        log.Add($"Pass Odds: +{op:F2} (returned)");
                        s.RemoveBet("passodds");
                    }
                    Lose("dp", "Don't Pass");
                    if (s.HasBet("dpodds"))
                    {
                        log.Add($"Don't Pass Odds: lost {s.GetBet("dpodds"):F2}");
                        s.RemoveBet("dpodds");
                    }
                    s.PassLocked = false; s.Point = null; s.Phase = GamePhase.ComeOut;
                    s.BetsOn = false; s.BetsOffThisRoll = false;
                    log.Add("Point made!"); tag = "point-made";
                }
            }

            // Don't Come landed bets lose if their exact number rolls before a 7.
            if (sum != 7)
            {
                var toRemove = new List<ComeBet>();
                foreach (var dc in s.DontComeBets)
                {
                    if (dc.Num != sum) continue;
                    log.Add($"Don't Come ({dc.Num}): lost {PayoutTables.Round2(dc.Flat + dc.Odds):F2}");
                    toRemove.Add(dc);
                }
                foreach (var dc in toRemove) s.DontComeBets.Remove(dc);
            }

            // Come waiting bet: personal come-out-style roll, following real craps rules in
            // both modes (confirmed by user 2026-07-28 — this deliberately DIVERGES from
            // focusmode.html:5970, which loses the Standard-mode Come bet on 7 and silently
            // turns 11 into a come-point instead of a win; that was a bug, not a house rule).
            //
            // Standard: 7 or 11 wins outright (mirrors Pass Line's come-out); 2, 3, or 12
            //   loses outright; anything else becomes the come-point.
            // Crapless: only 7 wins outright; everything else (including 11) becomes the
            //   come-point, with no instant loss for any number.
            if (s.HasBet("come"))
            {
                double flat = s.GetBet("come");
                bool winsOutright = sum == 7 || (s.Mode == GameMode.Standard && sum == 11);
                bool losesOutright = s.Mode == GameMode.Standard && (sum == 2 || sum == 3 || sum == 12);
                if (winsOutright)
                {
                    PayReturn("come", 1, "Come");
                }
                else if (losesOutright)
                {
                    Lose("come", "Come");
                }
                else
                {
                    s.RemoveBet("come");
                    s.ComeBets.Add(new ComeBet(sum, flat, 0));
                    log.Add($"Come → {sum}");
                }
            }

            // Don't Come waiting bet: inverted personal roll (7/11 lose, 2/3 win, 12 pushes).
            if (s.HasBet("dc"))
            {
                double flat = s.GetBet("dc");
                if (sum == 7 || sum == 11) Lose("dc", "Don't Come");
                else if (sum == 2 || sum == 3) PayReturn("dc", 1, "Don't Come");
                else if (sum == 12)
                {
                    bankroll = PayoutTables.Round2(bankroll + flat);
                    returned = PayoutTables.Round2(returned + flat);
                    s.RemoveBet("dc");
                    log.Add("Don't Come: push (12), bet returned.");
                }
                else
                {
                    s.RemoveBet("dc");
                    s.DontComeBets.Add(new ComeBet(sum, flat, 0));
                    log.Add($"Don't Come → {sum}");
                }
            }

            if (s.HasBet("field"))
            {
                bool wins = sum == 2 || sum == 3 || sum == 4 || sum == 9 || sum == 10 || sum == 11 || sum == 12;
                if (wins)
                {
                    double rx = (sum == 2 || sum == 12) ? 2 : 1;
                    PayStays("field", rx, "Field" + ((sum == 2 || sum == 12) ? " (2x)" : ""));
                }
                else Lose("field", "Field");
            }

            if (s.HasBet("any7")) { if (sum == 7) PayStays("any7", 4, "Seven"); else Lose("any7", "Seven"); }
            if (s.HasBet("midnight")) { if (sum == 12) PayStays("midnight", 30, "Midnight"); else Lose("midnight", "Midnight"); }
            if (s.HasBet("aces")) { if (sum == 2) PayStays("aces", 30, "Aces"); else Lose("aces", "Aces"); }
            if (s.HasBet("ace2")) { if (sum == 3) PayStays("ace2", 15, "Ace-Deuce"); else Lose("ace2", "Ace-Deuce"); }
            if (s.HasBet("yo")) { if (sum == 11) PayStays("yo", 15, "Yo"); else Lose("yo", "Yo"); }
            if (s.HasBet("anyCraps")) { if (sum == 2 || sum == 3 || sum == 12) PayStays("anyCraps", 7, "Any Craps"); else Lose("anyCraps", "Any Craps"); }

            if (s.HasBet("horn"))
            {
                double st = s.GetBet("horn");
                double u = PayoutTables.Round2(st / 4);
                double pr = 0;
                if (sum == 2 || sum == 12) pr = PayoutTables.Round2(PayoutTables.Round2(u * 30) - PayoutTables.Round2(u * 3));
                else if (sum == 3 || sum == 11) pr = PayoutTables.Round2(PayoutTables.Round2(u * 15) - PayoutTables.Round2(u * 3));
                if (sum == 2 || sum == 3 || sum == 11 || sum == 12)
                {
                    bankroll = PayoutTables.Round2(bankroll + st + pr);
                    returned = PayoutTables.Round2(returned + st + pr);
                    s.RemoveBet("horn");
                    Credit("horn", pr);
                    log.Add($"Horn: +{pr:F2} (returned)");
                }
                else Lose("horn", "Horn");
            }

            if (s.HasBet("cande"))
            {
                double st = s.GetBet("cande");
                double h = PayoutTables.Round2(st / 2);
                if (sum == 2 || sum == 3 || sum == 12)
                {
                    double p = PayoutTables.Round2(h * 7);
                    bankroll = PayoutTables.Round2(bankroll + st + p);
                    returned = PayoutTables.Round2(returned + st + p);
                    s.RemoveBet("cande");
                    Credit("cande", p);
                    log.Add($"C&E (craps): +{p:F2} (returned)");
                }
                else if (sum == 11)
                {
                    double p = PayoutTables.Round2(h * 15);
                    bankroll = PayoutTables.Round2(bankroll + st + p);
                    returned = PayoutTables.Round2(returned + st + p);
                    s.RemoveBet("cande");
                    Credit("cande", p);
                    log.Add($"C&E (eleven): +{p:F2} (returned)");
                }
                else Lose("cande", "C&E");
            }

            if (s.HasBet("eleven")) { if (sum == 11) PayStays("eleven", 15, "Eleven"); else Lose("eleven", "Eleven"); }

            var hardTargets = new Dictionary<string, int> { { "hard4", 4 }, { "hard6", 6 }, { "hard8", 8 }, { "hard10", 10 } };
            var hardMult = new Dictionary<string, int> { { "hard4", 7 }, { "hard6", 9 }, { "hard8", 9 }, { "hard10", 7 } };
            foreach (var kv in hardTargets)
            {
                string k = kv.Key; int t = kv.Value;
                if (!s.HasBet(k)) continue;
                string label = k.Replace("hard", "Hard ");
                if (sum == t && hard) PayStays(k, hardMult[k], label);
                else if (sum == 7 || (sum == t && !hard)) Lose(k, label);
            }

            foreach (var kv in PayoutTables.HopMap)
            {
                string key = kv.Key;
                var (a, b) = kv.Value;
                if (!s.HasBet(key)) continue;
                bool isH = a == b;
                bool m = (d1 == a && d2 == b) || (d1 == b && d2 == a);
                if (m) PayStays(key, isH ? 30 : 15, $"Hop {a}-{b}");
                else Lose(key, $"Hop {a}-{b}");
            }

            if (sum != 7)
            {
                if (PayoutTables.LowNums.Contains(sum) && !s.Bonus.LowHit.Contains(sum)) s.Bonus.LowHit.Add(sum);
                if (PayoutTables.HighNums.Contains(sum) && !s.Bonus.HighHit.Contains(sum)) s.Bonus.HighHit.Add(sum);

                if (s.Bonus.Low > 0 && PayoutTables.LowNums.All(n => s.Bonus.LowHit.Contains(n)))
                {
                    double st = s.Bonus.Low;
                    double p = PayoutTables.Round2(st * 30);
                    bankroll = PayoutTables.Round2(bankroll + st + p);
                    returned = PayoutTables.Round2(returned + st + p);
                    s.Bonus.Low = 0; s.Bonus.LowMax = 0; s.Bonus.LowHit.Clear();
                    Credit("bonusLow", p);
                    log.Add($"Low Rolls WON! +{p:F2} (returned)");
                }
                if (s.Bonus.High > 0 && PayoutTables.HighNums.All(n => s.Bonus.HighHit.Contains(n)))
                {
                    double st = s.Bonus.High;
                    double p = PayoutTables.Round2(st * 30);
                    bankroll = PayoutTables.Round2(bankroll + st + p);
                    returned = PayoutTables.Round2(returned + st + p);
                    s.Bonus.High = 0; s.Bonus.HighMax = 0; s.Bonus.HighHit.Clear();
                    Credit("bonusHigh", p);
                    log.Add($"High Rolls WON! +{p:F2} (returned)");
                }
                if (s.Bonus.All > 0 && PayoutTables.AllBonusNums.All(n => s.Bonus.LowHit.Contains(n) || s.Bonus.HighHit.Contains(n)))
                {
                    double st = s.Bonus.All;
                    double p = PayoutTables.Round2(st * 155);
                    bankroll = PayoutTables.Round2(bankroll + st + p);
                    returned = PayoutTables.Round2(returned + st + p);
                    s.Bonus.All = 0; s.Bonus.AllMax = 0;
                    Credit("bonusAll", p);
                    log.Add($"Roll'em All WON! +{p:F2} (returned)");
                }
            }

            if (s.BetsOffThisRoll && s.Phase == GamePhase.Point) s.BetsOffThisRoll = false;

            s.Bankroll = bankroll;

            return new RollResult { D1 = d1, D2 = d2, Sum = sum, Returned = returned, Log = log, Tag = tag, Wins = winsByBet };
        }
    }
}
