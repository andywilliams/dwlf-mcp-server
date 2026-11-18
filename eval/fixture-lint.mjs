/**
 * Block-eval §0 T3: fixtures are committed to a PUBLIC repo, so none may carry vendor-licensed prices. Only DWLF's own
 * data (`BTCOC/USD`) may be priced in a fixture. A symbol applies to everything nested under it, so a price anywhere
 * below an object naming another symbol is refused, and so is any licence flag set to false (`priceWithheld`,
 * `withheld`). This can't read prose: a person still reads each fixture diff.
 */
const PRICE_FIELDS = new Set(['price', 'close', 'open', 'high', 'low', 'level', 'value']);
const LICENCE_FLAGS = ['priceWithheld', 'withheld'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** What in one recorded body could be vendor data. Empty = it passes. `symbol`: the nearest enclosing symbol. */
export const vendorFailures = (value, path = 'body', symbol = null) => {
  if (Array.isArray(value)) { return value.flatMap((v, i) => vendorFailures(v, `${path}[${i}]`, symbol)); }
  if (!isObject(value)) { return []; }
  const here = typeof value.symbol === 'string' ? value.symbol : symbol;
  const own = LICENCE_FLAGS.filter((f) => value[f] === false).map((f) => `${path}: ${f} is false (a licensed price)`);
  if (here && here !== 'BTCOC/USD') {
    own.push(...Object.entries(value).filter(([k, v]) => PRICE_FIELDS.has(k) && typeof v === 'number')
      .map(([k]) => `${path}.${k}: a price under ${here} (only BTCOC/USD, DWLF's own data, may be committed)`));
  }
  return [...own, ...Object.entries(value).flatMap(([k, v]) => vendorFailures(v, `${path}.${k}`, here))];
};
