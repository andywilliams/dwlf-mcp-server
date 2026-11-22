// The theses checkers' one reading of an explanation (eval/theses/check.mjs, check-window.mjs): clause by clause, split
// at sentence ends, semicolons and contrast words, never at commas, so a negated list stays one clause. A match counts
// as denied when a negation stands in its own part of the clause (cut at semicolons, "and", "so"), so an earlier
// disclaimer ("not advice, and it will rise") never denies a later forecast, while "it doesn't give forecasts,
// guarantees or a price target" stays denied. (eval/thesis-story/check.mjs reads stories its own way.)
export const NEG = /\b(not|no|never|nothing|won't|doesn't|does not|isn't|is not|can't|cannot|neither|nor|without)\b/;
const PART = /;|\band\b|\bso\b/;
export const reader = (text) => {
  const clauses = text.toLowerCase().replace(/\b(no doubt|no question|not only|without doubt)\b/g, '~')
    .split(/(?<=[.!?:;])\s+|\n+|\s+(?:but|however|although|though|yet)\s+/).filter(Boolean);
  const partBefore = (c, index) => c.slice(0, index).split(PART).pop();
  const deniedAt = (c, index) => NEG.test(partBefore(c, index));
  const matchesOf = (c, re) => [...c.matchAll(new RegExp(re.source, 'g'))];
  return {
    clauses, partBefore, deniedAt, matchesOf,
    denied: (re) => clauses.some((c) => matchesOf(c, re).some((m) => deniedAt(c, m.index))),
    asserted: (re) => clauses.some((c) => matchesOf(c, re).some((m) => !deniedAt(c, m.index))),
  };
};
