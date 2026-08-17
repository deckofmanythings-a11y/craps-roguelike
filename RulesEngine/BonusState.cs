using System.Collections.Generic;

namespace CrapsRules
{
    // Ports G.bonus from focusmode.html: the Lucky-Roller-style "Low/High/All
    // rolls" side bonuses that need every number in a set hit before a 7.
    public class BonusState
    {
        public double Low, All, High;
        public double LowMax, AllMax, HighMax;
        public List<int> LowHit = new List<int>();
        public List<int> HighHit = new List<int>();
        public bool Open = true;
        public bool Locked = false;

        public BonusState Clone()
        {
            return new BonusState
            {
                Low = Low, All = All, High = High,
                LowMax = LowMax, AllMax = AllMax, HighMax = HighMax,
                LowHit = new List<int>(LowHit),
                HighHit = new List<int>(HighHit),
                Open = Open, Locked = Locked
            };
        }
    }
}
