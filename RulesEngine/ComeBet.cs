namespace CrapsRules
{
    // A Come or Don't Come bet that has moved off the "waiting" spot onto a
    // specific number. Mirrors the {num, flat, odds} shape of comeBets/dcBets
    // entries in focusmode.html.
    public class ComeBet
    {
        public int Num;
        public double Flat;
        public double Odds;

        public ComeBet(int num, double flat, double odds = 0)
        {
            Num = num;
            Flat = flat;
            Odds = odds;
        }

        public ComeBet Clone() => new ComeBet(Num, Flat, Odds);
    }
}
