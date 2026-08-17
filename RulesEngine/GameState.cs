using System.Collections.Generic;

namespace CrapsRules
{
    // Ports the shape of the `s`/`G` state object focusLocalResolve() reads and
    // mutates in focusmode.html. Flat bets (pass, dp, come, dc, field, placeN,
    // buyN, hardN, hopNN, any7, anyCraps, horn, cande, eleven, aces, ace2, yo,
    // midnight, passodds, dpodds) live in Bets keyed by the same string labels
    // the original JS used, so this stays easy to diff against the source.
    public class GameState
    {
        public GameMode Mode = GameMode.Standard;
        public double Bankroll;

        public Dictionary<string, double> Bets = new Dictionary<string, double>();
        public List<ComeBet> ComeBets = new List<ComeBet>();
        public List<ComeBet> DontComeBets = new List<ComeBet>();

        public GamePhase Phase = GamePhase.ComeOut;
        public int? Point = null;
        public bool BetsOn = true;
        public bool BetsOffThisRoll = false;
        public bool PassLocked = false;

        public BonusState Bonus = new BonusState();

        public double GetBet(string key) => Bets.TryGetValue(key, out var v) ? v : 0;
        public bool HasBet(string key) => Bets.ContainsKey(key) && Bets[key] != 0;
        public void RemoveBet(string key) => Bets.Remove(key);

        // Mirrors the original's JSON.parse(JSON.stringify(...)) deep clone,
        // done before every resolve so a caller can discard the attempt on
        // failure without corrupting the live state.
        public GameState Clone()
        {
            var clone = new GameState
            {
                Mode = Mode,
                Bankroll = Bankroll,
                Bets = new Dictionary<string, double>(Bets),
                Phase = Phase,
                Point = Point,
                BetsOn = BetsOn,
                BetsOffThisRoll = BetsOffThisRoll,
                PassLocked = PassLocked,
                Bonus = Bonus.Clone()
            };
            foreach (var cb in ComeBets) clone.ComeBets.Add(cb.Clone());
            foreach (var dc in DontComeBets) clone.DontComeBets.Add(dc.Clone());
            return clone;
        }
    }
}
