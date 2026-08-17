using System.Collections.Generic;

namespace CrapsRules
{
    // Place/buy payout definition for one box number.
    // PlaceWin/PlaceDen: place-bet payout ratio as win:den (e.g. 9:5 -> 9,5).
    // BuyRatio: buy-bet payout ratio as a single multiplier, 5% vig taken off
    // the win at resolution time (see CrapsResolver).
    public readonly struct NumDef
    {
        public readonly int PlaceWin, PlaceDen;
        public readonly double BuyRatio;
        public NumDef(int placeWin, int placeDen, double buyRatio)
        {
            PlaceWin = placeWin; PlaceDen = placeDen; BuyRatio = buyRatio;
        }
    }

    // Ported from focusmode.html's FOCUS_* constants (lines 5758-5768), which
    // is itself a hand-ported copy of the server's roll-standard resolver
    // (see focusmode.html:5749-5757). This single 10-number table is correct
    // for BOTH Standard and Crapless: NUM_DEFS_STANDARD's ratios for
    // 4,5,6,8,9,10 are numerically identical to NUM_DEFS_CRAPLESS's (verified
    // against focusmode.html:1806-1816), and which numbers can ever become a
    // point/come bet is governed by CrapsResolver's mode-aware come-out
    // branch, not by this table.
    public static class PayoutTables
    {
        // Odds-behind-the-line payout ratio per point number (true odds).
        public static readonly Dictionary<int, double> OddsPay = new Dictionary<int, double>
        {
            {2, 6}, {3, 3}, {4, 2}, {5, 1.5}, {6, 6.0/5}, {8, 6.0/5}, {9, 1.5}, {10, 2}, {11, 3}, {12, 6}
        };

        public static readonly Dictionary<int, NumDef> NumDefs = new Dictionary<int, NumDef>
        {
            {2,  new NumDef(11, 2, (119.0/20)/0.95)},
            {3,  new NumDef(11, 4, (59.0/20)/0.95)},
            {4,  new NumDef(9, 5, 2)},
            {5,  new NumDef(7, 5, 1.5)},
            {6,  new NumDef(7, 6, 6.0/5)},
            {8,  new NumDef(7, 6, 6.0/5)},
            {9,  new NumDef(7, 5, 1.5)},
            {10, new NumDef(9, 5, 2)},
            {11, new NumDef(11, 4, (59.0/20)/0.95)},
            {12, new NumDef(11, 2, (119.0/20)/0.95)}
        };

        public static readonly int[] AllNums = { 2, 3, 4, 5, 6, 8, 9, 10, 11, 12 };
        public static readonly int[] LowNums = { 2, 3, 4, 5, 6 };
        public static readonly int[] HighNums = { 8, 9, 10, 11, 12 };
        public static readonly int[] AllBonusNums = { 2, 3, 4, 5, 6, 8, 9, 10, 11, 12 };
        public static readonly HashSet<int> HardNums = new HashSet<int> { 4, 6, 8, 10 };

        // Hop bet key -> the two dice values it needs (order-independent).
        public static readonly Dictionary<string, (int a, int b)> HopMap = new Dictionary<string, (int, int)>
        {
            {"hop11",(1,1)}, {"hop12",(1,2)}, {"hop13",(1,3)}, {"hop14",(1,4)}, {"hop15",(1,5)}, {"hop16",(1,6)},
            {"hop22",(2,2)}, {"hop23",(2,3)}, {"hop24",(2,4)}, {"hop25",(2,5)}, {"hop26",(2,6)},
            {"hop33",(3,3)}, {"hop34",(3,4)}, {"hop35",(3,5)}, {"hop36",(3,6)},
            {"hop44",(4,4)}, {"hop45",(4,5)}, {"hop46",(4,6)},
            {"hop55",(5,5)}, {"hop56",(5,6)},
            {"hop66",(6,6)}
        };

        // Standard-mode only (Lay/Don't Pass odds/Don't Come odds are disabled
        // in Crapless - focusmode.html:4395-4396, 5704-5707). LayPay carries
        // 5% vig baked into the ratio; DcOddsPay is the no-vig ratio used for
        // Don't Pass/Don't Come odds payouts. Ported from focusmode.html:1821,1825
        // where they're numerically equal but kept as separate named tables
        // because the source treats them as conceptually distinct.
        public static readonly Dictionary<int, double> LayPay = new Dictionary<int, double>
        {
            {4, 0.5}, {5, 2.0/3}, {6, 5.0/6}, {8, 5.0/6}, {9, 2.0/3}, {10, 0.5}
        };
        public static readonly Dictionary<int, double> DcOddsPay = new Dictionary<int, double>
        {
            {4, 0.5}, {5, 2.0/3}, {6, 5.0/6}, {8, 5.0/6}, {9, 2.0/3}, {10, 0.5}
        };

        // Ported from focusmode.html:2803 - JS Math.round rounds halves toward
        // +Infinity, not away from zero, so this is Math.Floor(n*100+0.5)/100
        // rather than MidpointRounding.AwayFromZero.
        public static double Round2(double n) => System.Math.Floor(n * 100 + 0.5) / 100;
    }
}
