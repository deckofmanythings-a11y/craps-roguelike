using CrapsRules;

// ANTE 3-8 TARGET CALIBRATION for the CONTINUOUS-PLAY bullet model.
//
// New bullet model (user, 2026-08-15): a bullet is NOT one shooter's hand. You
// start with $100 and keep playing hand after hand — a seven-out just resets the
// come-out and you continue — until either your running net reaches the round
// TARGET (the round clears the instant it does) or your stake falls below the
// ante's MIN BET with nothing left on the felt (the bullet busts). It's a
// gambler's-ruin session: reach +target before ruin. Relics cut (or flip) the
// house edge, which is what lets a session climb to the target.
//
// We assume a representative accumulating relic loadout per ante and pick each
// round's target so the WITH-relics round clear rate lands in a HIGH band (a
// keeping-pace build should clear most rounds — a 24-round run at 60%/round is
// unwinnable). The NO-RELIC clear rate at the same target is reported alongside
// and should crater — that's what makes relics load-bearing.
//
// Strategy: Pass + Place 6/8, sized $25/$30 but shrunk toward the min bet when
// the stake runs low. A real player presses / adds bet types / buys vouchers, so
// these with-relic clear rates are a conservative LOWER BOUND.

const int Trials = 20_000;
const int MaxRollsPerBullet = 3000;
const double PeakCap = 3200;          // above the top of the ladder below
const double Stake = 100;
int[] MinBetByAnte = { 5, 5, 10, 10, 15, 15, 20, 25 }; // matches roguelike.js MIN_BET (ante 1-8)

static double[] Weights(Relics r, int die)
{
    var w = new double[6] { 1, 1, 1, 1, 1, 1 };
    if (r.HeavyDie == die && r.HeavyFace >= 1 && r.HeavyFace <= 6)
    {
        int f = r.HeavyFace, opp = 7 - f;
        w[opp - 1] += r.HeavyBias;
        for (int v = 1; v <= 6; v++) if (v != f && v != opp) w[v - 1] += r.HeavyBias * 0.25;
    }
    return w;
}
static int RollDie(Random rng, double[] w)
{
    double total = 0; foreach (var x in w) total += x;
    double roll = rng.NextDouble() * total;
    for (int i = 0; i < 6; i++) { roll -= w[i]; if (roll <= 0) return i + 1; }
    return 6;
}
static bool Shows(int die, int face, int d1, int d2) => die != 0 && (die == 1 ? d1 == face : d2 == face);

// Play ONE bullet under the continuous model. Returns the PEAK net reached
// (secure position: stake + removable on-table bets - locked pass - $100).
// The round clears iff this peak >= target for any bullet.
static double PlayBullet(Relics r, double minBet, Random rng)
{
    double stake = Stake + r.StakeBonus;
    var state = new GameState { Mode = GameMode.Standard };
    state.BetsOn = false;                 // Place is OFF on the come-out (as in-game)
    var w1 = Weights(r, 1); var w2 = Weights(r, 2);
    bool guardianUsed = false, glassBroken = false;
    double peak = 0;
    const double passSize = 25, placeSize = 30;

    for (int i = 0; i < MaxRollsPerBullet; i++)
    {
        // place bets, shrinking toward the min bet when short
        if (state.Phase == GamePhase.ComeOut && !state.HasBet("pass"))
        { double bet = Math.Min(passSize, stake); if (bet >= minBet) { stake -= bet; state.Bets["pass"] = bet; } }
        if (state.Phase == GamePhase.Point)
        {
            if (!state.HasBet("place6")) { double bet = Math.Min(placeSize, stake); if (bet >= minBet) { stake -= bet; state.Bets["place6"] = bet; } }
            if (!state.HasBet("place8")) { double bet = Math.Min(placeSize, stake); if (bet >= minBet) { stake -= bet; state.Bets["place8"] = bet; } }
        }

        int d1 = RollDie(rng, w1), d2 = RollDie(rng, w2);
        if (r.Guardian && !guardianUsed && state.Phase == GamePhase.Point && d1 + d2 == 7)
        { guardianUsed = true; do { d1 = RollDie(rng, w1); d2 = RollDie(rng, w2); } while (d1 + d2 == 7); }

        state.Bankroll = 0;
        var res = CrapsResolver.Resolve(state, d1, d2);
        double baseWin = 0; foreach (var v in res.Wins.Values) baseWin += v;
        double extra = 0;
        foreach (var kv in res.Wins) if (r.PayoutMult.TryGetValue(kv.Key, out var m)) extra += kv.Value * (m - 1);
        if (r.GlassDie != 0 && !glassBroken && baseWin > 0 && Shows(r.GlassDie, r.GlassFace, d1, d2))
        { extra += baseWin * (r.GlassMult - 1); if (rng.NextDouble() < r.GlassBreak) glassBroken = true; }
        if (r.GoldDie != 0 && Shows(r.GoldDie, r.GoldFace, d1, d2)) extra += r.GoldAmount;
        stake += state.Bankroll + extra;

        // secure net: cash + removable bets (place always; pass only when not locked on a point)
        double removable = 0, onTableAll = 0;
        foreach (var kv in state.Bets)
        {
            onTableAll += kv.Value;
            if (kv.Key == "pass") { if (!state.PassLocked) removable += kv.Value; }
            else removable += kv.Value;
        }
        double net = stake + removable - Stake - r.StakeBonus;
        if (net > peak) peak = net;

        if (peak >= PeakCap) break;                     // already above any target — a +EV session, stop
        if (stake < minBet && onTableAll == 0) break;   // ruin
    }
    return peak;
}

// per round, the best bullet's peak net (round clears iff best >= target)
double[] BestPeaks(Relics r, int bullets, double minBet, int trials, int seed)
{
    var rng = new Random(seed);
    var arr = new double[trials];
    for (int t = 0; t < trials; t++)
    {
        double best = double.NegativeInfinity;
        for (int b = 0; b < bullets; b++) { double p = PlayBullet(r, minBet, rng); if (p > best) best = p; }
        arr[t] = best;
    }
    Array.Sort(arr);
    return arr;
}
double TargetForClear(double[] sorted, double clear)
{ int n = sorted.Length, idx = Math.Clamp((int)Math.Floor((1 - clear) * n), 0, n - 1); return sorted[idx]; }
double ClearAt(double[] sorted, double target)
{ int n = sorted.Length, lo = 0, hi = n; while (lo < hi) { int m = (lo + hi) / 2; if (sorted[m] < target) lo = m + 1; else hi = m; } return 100.0 * (n - lo) / n; }
double Nice(double t) => Math.Round(t / 25) * 25;

// Representative accumulating loadouts (only what Pass+Place6/8 actually uses).
Relics Loadout(int ante) => ante switch
{
    3 => new Relics { PayoutMult = { ["place6"] = 1.5, ["place8"] = 1.5 }, GoldDie = 1, GoldFace = 4, GoldAmount = 5 },
    4 => new Relics { PayoutMult = { ["place6"] = 1.5, ["place8"] = 1.5, ["pass"] = 2.0 }, GoldDie = 1, GoldFace = 4, GoldAmount = 5 },
    5 => new Relics { PayoutMult = { ["place6"] = 2.0, ["place8"] = 2.0, ["pass"] = 2.0 }, GoldDie = 1, GoldFace = 4, GoldAmount = 5, GlassDie = 2, GlassFace = 3 },
    6 => new Relics { PayoutMult = { ["place6"] = 2.0, ["place8"] = 2.0, ["pass"] = 3.0 }, GoldDie = 1, GoldFace = 4, GoldAmount = 10, GlassDie = 2, GlassFace = 3, GlassMult = 3 },
    7 => new Relics { PayoutMult = { ["place6"] = 2.0, ["place8"] = 2.0, ["pass"] = 3.0 }, GoldDie = 1, GoldFace = 4, GoldAmount = 10, GlassDie = 2, GlassFace = 3, GlassMult = 3, Guardian = true },
    _ => new Relics { PayoutMult = { ["place6"] = 2.0, ["place8"] = 2.0, ["pass"] = 3.0 }, GoldDie = 1, GoldFace = 4, GoldAmount = 10, GlassDie = 2, GlassFace = 3, GlassMult = 3, Guardian = true },
};

int[][] BulletsByAnte = { null!, null!, null!,
    new[]{4,4,3}, new[]{4,4,3}, new[]{4,3,3}, new[]{3,3,3}, new[]{3,3,3}, new[]{3,3,3} };
// A smooth escalating target ladder (design choice — the continuous model lets a
// +EV build grind to almost any target, so within reason the exact values just
// pace progression; we REPORT the clear rates to confirm they're sane).
int[][] TargetsByAnte = { null!, null!, null!,
    new[]{300,400,500}, new[]{600,700,800}, new[]{900,1050,1200},
    new[]{1300,1450,1600}, new[]{1750,1950,2150}, new[]{2300,2550,2800} };
string[] RoundName = { "Small", "Big", "Boss" };

Console.WriteLine("=== ANTE 3-8 LADDER (continuous-play bullets) — clear rates at a fixed escalating ladder ===");
Console.WriteLine($"Play until +target (clear) or below ante min-bet (ruin) | {Trials:N0} rounds/config\n");
Console.WriteLine($"{"Round",-15}{"bullets",8}{"minBet",8}{"target",9}{"got(relic)",12}{"no-relic",10}");

for (int ante = 3; ante <= 8; ante++)
{
    var load = Loadout(ante);
    double mb = MinBetByAnte[ante - 1];
    for (int r = 0; r < 3; r++)
    {
        int n = BulletsByAnte[ante][r];
        double tgt = TargetsByAnte[ante][r];
        var withR = BestPeaks(load, n, mb, Trials, 2026_08_16 + ante * 10 + r);
        var noR = BestPeaks(new Relics(), n, mb, Trials, 5000 + ante * 10 + r);
        Console.WriteLine($"A{ante} {RoundName[r],-12}{n,8}{"$" + mb,8}{"+$" + tgt,9}{ClearAt(withR, tgt),11:F1}%{ClearAt(noR, tgt),9:F1}%");
    }
    Console.WriteLine();
}

class Relics
{
    public string Name = "";
    public Dictionary<string, double> PayoutMult = new();
    public int GoldDie, GoldFace; public double GoldAmount;
    public int GlassDie, GlassFace; public double GlassMult = 2.0, GlassBreak = 0.25;
    public bool Guardian;
    public int HeavyDie, HeavyFace; public double HeavyBias;
    public double StakeBonus;
}
