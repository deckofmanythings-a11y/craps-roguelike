using CrapsRules;

int passCount = 0, failCount = 0;

void Check(string name, bool condition)
{
    if (condition) { passCount++; Console.WriteLine($"PASS  {name}"); }
    else { failCount++; Console.WriteLine($"FAIL  {name}"); }
}

void CheckEq(string name, double expected, double actual, double tolerance = 0.001)
{
    Check($"{name} (expected {expected}, got {actual})", Math.Abs(expected - actual) < tolerance);
}

// ---- Standard mode: natural win on come-out (7) ----
{
    var s = new GameState { Mode = GameMode.Standard, Bankroll = 1000 };
    s.Bets["pass"] = 10;
    CrapsResolver.Resolve(s, 3, 4); // sum 7
    CheckEq("Standard: Pass $10, come-out 7 -> bankroll", 1020, s.Bankroll);
    Check("Standard: Pass $10, come-out 7 -> bet removed", !s.HasBet("pass"));
    Check("Standard: Pass $10, come-out 7 -> phase stays ComeOut", s.Phase == GamePhase.ComeOut);
}

// ---- Standard mode: craps on come-out (3) loses Pass immediately ----
{
    var s = new GameState { Mode = GameMode.Standard, Bankroll = 1000 };
    s.Bets["pass"] = 10;
    CrapsResolver.Resolve(s, 1, 2); // sum 3
    CheckEq("Standard: Pass $10, come-out 3 -> bankroll unchanged", 1000, s.Bankroll);
    Check("Standard: Pass $10, come-out 3 -> bet removed (loss)", !s.HasBet("pass"));
    Check("Standard: Pass $10, come-out 3 -> phase stays ComeOut", s.Phase == GamePhase.ComeOut);
}

// ---- Standard mode: point set, then made ----
{
    var s = new GameState { Mode = GameMode.Standard, Bankroll = 1000 };
    s.Bets["pass"] = 10;
    CrapsResolver.Resolve(s, 2, 3); // sum 5 -> point
    Check("Standard: come-out 5 -> point set to 5", s.Point == 5);
    Check("Standard: come-out 5 -> phase Point", s.Phase == GamePhase.Point);
    CrapsResolver.Resolve(s, 1, 4); // sum 5 again -> point made
    CheckEq("Standard: point 5 made -> bankroll", 1020, s.Bankroll);
    Check("Standard: point 5 made -> phase back to ComeOut", s.Phase == GamePhase.ComeOut);
    Check("Standard: point 5 made -> point cleared", s.Point == null);
}

// ---- Standard mode: point set, then seven-out ----
{
    var s = new GameState { Mode = GameMode.Standard, Bankroll = 1000 };
    s.Bets["pass"] = 10;
    CrapsResolver.Resolve(s, 2, 3); // point 5
    CrapsResolver.Resolve(s, 3, 4); // sum 7 -> seven-out
    CheckEq("Standard: point 5, seven-out -> bankroll unchanged", 1000, s.Bankroll);
    Check("Standard: point 5, seven-out -> phase back to ComeOut", s.Phase == GamePhase.ComeOut);
}

// ---- Crapless mode: the key behavioral difference ----
// In Standard, a come-out 3 craps out immediately. In Crapless it must
// become the point instead (see CrapsResolver's Crapless branch comment).
{
    var s = new GameState { Mode = GameMode.Crapless, Bankroll = 1000 };
    s.Bets["pass"] = 10;
    CrapsResolver.Resolve(s, 1, 2); // sum 3
    CheckEq("Crapless: Pass $10, come-out 3 -> bankroll unchanged (not a loss)", 1000, s.Bankroll);
    Check("Crapless: Pass $10, come-out 3 -> bet still active", s.HasBet("pass"));
    Check("Crapless: Pass $10, come-out 3 -> point set to 3", s.Point == 3);
    Check("Crapless: Pass $10, come-out 3 -> phase Point", s.Phase == GamePhase.Point);

    CrapsResolver.Resolve(s, 1, 2); // sum 3 again -> point made
    CheckEq("Crapless: point 3 made -> bankroll", 1020, s.Bankroll);
    Check("Crapless: point 3 made -> phase back to ComeOut", s.Phase == GamePhase.ComeOut);
}

// ---- Crapless mode: come-out 12 becomes the point (not an instant loss) ----
{
    var s = new GameState { Mode = GameMode.Crapless, Bankroll = 1000 };
    s.Bets["pass"] = 10;
    CrapsResolver.Resolve(s, 6, 6); // sum 12
    CheckEq("Crapless: come-out 12 -> bankroll unchanged", 1000, s.Bankroll);
    Check("Crapless: come-out 12 -> point set to 12", s.Point == 12);
}

// ---- Field bet: pays profit only, bet stays active ----
{
    var s = new GameState { Mode = GameMode.Standard, Bankroll = 1000 };
    s.Bets["field"] = 10;
    CrapsResolver.Resolve(s, 1, 2); // sum 3 -> field wins 1x
    CheckEq("Field $10, roll 3 -> bankroll (+10 profit, stake stays)", 1010, s.Bankroll);
    Check("Field $10, roll 3 -> bet still on the felt", s.HasBet("field"));

    var s2 = new GameState { Mode = GameMode.Standard, Bankroll = 1000 };
    s2.Bets["field"] = 10;
    CrapsResolver.Resolve(s2, 1, 1); // sum 2 -> field wins 2x
    CheckEq("Field $10, roll 2 -> bankroll (+20 profit, 2x)", 1020, s2.Bankroll);
}

// ---- Hardway: hard 6 pays 9x profit, stays ----
{
    var s = new GameState { Mode = GameMode.Standard, Bankroll = 1000 };
    s.Bets["hard6"] = 5;
    CrapsResolver.Resolve(s, 3, 3); // hard 6
    CheckEq("Hard 6 $5, rolled hard -> bankroll (+45 profit)", 1045, s.Bankroll);
}

// ---- Hop bet: non-hardway hop pays 15x ----
{
    var s = new GameState { Mode = GameMode.Standard, Bankroll = 1000 };
    s.Bets["hop12"] = 1;
    CrapsResolver.Resolve(s, 1, 2); // exact match
    CheckEq("Hop 1-2 $1, matched -> bankroll (+15 profit)", 1015, s.Bankroll);
}

// ---- Standard: Come bet wins outright on 7 or 11 (real craps rules, diverges from the
// ---- ported focusmode.html behavior which lost it on 7) ----
{
    var s = new GameState { Mode = GameMode.Standard, Bankroll = 1000, Phase = GamePhase.Point, Point = 5 };
    s.Bets["come"] = 10;
    CrapsResolver.Resolve(s, 3, 4); // sum 7 -> Come bet wins outright, main line also seven-outs
    CheckEq("Standard: Come $10, roll 7 -> bankroll (+20, come bet wins)", 1020, s.Bankroll);
    Check("Standard: Come $10, roll 7 -> waiting bet cleared (won, not turned into a point)", s.ComeBets.Count == 0);

    var s2 = new GameState { Mode = GameMode.Standard, Bankroll = 1000, Phase = GamePhase.Point, Point = 5 };
    s2.Bets["come"] = 10;
    CrapsResolver.Resolve(s2, 5, 6); // sum 11 -> Come bet wins outright
    CheckEq("Standard: Come $10, roll 11 -> bankroll (+20, come bet wins)", 1020, s2.Bankroll);

    var s3 = new GameState { Mode = GameMode.Standard, Bankroll = 1000, Phase = GamePhase.Point, Point = 5 };
    s3.Bets["come"] = 10;
    CrapsResolver.Resolve(s3, 1, 2); // sum 3 -> Come bet loses outright
    CheckEq("Standard: Come $10, roll 3 -> bankroll unchanged (loses)", 1000, s3.Bankroll);
    Check("Standard: Come $10, roll 3 -> bet removed", !s3.HasBet("come"));

    var s4 = new GameState { Mode = GameMode.Standard, Bankroll = 1000, Phase = GamePhase.Point, Point = 5 };
    s4.Bets["come"] = 10;
    CrapsResolver.Resolve(s4, 2, 2); // sum 4 -> becomes the come-point
    CheckEq("Standard: Come $10, roll 4 -> bankroll unchanged (becomes point)", 1000, s4.Bankroll);
    Check("Standard: Come $10, roll 4 -> moved to come-point 4", s4.ComeBets.Count == 1 && s4.ComeBets[0].Num == 4);
}

// ---- Crapless: Come bet wins outright only on 7, everything else becomes the come-point ----
{
    var s = new GameState { Mode = GameMode.Crapless, Bankroll = 1000, Phase = GamePhase.Point, Point = 5 };
    s.Bets["come"] = 10;
    CrapsResolver.Resolve(s, 3, 4); // sum 7 -> Come bet wins outright
    CheckEq("Crapless: Come $10, roll 7 -> bankroll (+20, come bet wins)", 1020, s.Bankroll);
    Check("Crapless: Come $10, roll 7 -> waiting bet cleared (not turned into a come-point)", s.ComeBets.Count == 0);

    var s2 = new GameState { Mode = GameMode.Crapless, Bankroll = 1000, Phase = GamePhase.Point, Point = 5 };
    s2.Bets["come"] = 10;
    CrapsResolver.Resolve(s2, 5, 6); // sum 11 -> becomes the come-point, not a win
    CheckEq("Crapless: Come $10, roll 11 -> bankroll unchanged (becomes point, not a win)", 1000, s2.Bankroll);
    Check("Crapless: Come $10, roll 11 -> moved to come-point 11", s2.ComeBets.Count == 1 && s2.ComeBets[0].Num == 11);

    // 11 pays the same odds as 3 (OddsPay/NumDefs), confirmed by user.
    CheckEq("Crapless: OddsPay[11] matches OddsPay[3]", CrapsRules.PayoutTables.OddsPay[3], CrapsRules.PayoutTables.OddsPay[11]);
}

Console.WriteLine();
Console.WriteLine($"{passCount} passed, {failCount} failed");
if (failCount > 0) Environment.Exit(1);
