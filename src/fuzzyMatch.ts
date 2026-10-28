/**
 * Lightweight subsequence fuzzy scorer for the command palette.
 * Returns a score >= 0 when `query` matches `text`, -1 when it does not.
 * Higher is better: prefix > substring > subsequence, with bonuses for
 * word boundaries and consecutive runs. Penalties are bounded so body
 * length affects ranking, never match eligibility.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (q === '') return 0;

  const substringAt = t.indexOf(q);
  if (substringAt === 0) return 1000;
  if (substringAt > 0) return 700 - Math.min(substringAt, 100);

  let score = 300;
  let deductions = 0;
  let searchFrom = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], searchFrom);
    if (found === -1) return -1;
    if (found === prevMatch + 1) score += 15;
    if (found === 0 || /[\s\-_./([\]]/.test(t[found - 1])) score += 10;
    deductions += Math.min(found - searchFrom, 20);
    prevMatch = found;
    searchFrom = found + 1;
  }
  // Mild preference for shorter haystacks, bounded: a successful
  // subsequence match in a long document must still outscore -1
  deductions += Math.max(0, t.length - q.length) * 0.1;
  score -= Math.min(deductions, 290);
  return score;
}
