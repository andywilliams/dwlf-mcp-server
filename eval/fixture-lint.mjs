/**
 * Block-eval §0 T3: fixtures are committed to a PUBLIC repo, so none may carry vendor-licensed prices. Every Block API
 * public body is DWLF's own data (`BTCOC/USD`, own-node series; checked 18-Nov). A priced object on any other symbol,
 * or one marked `priceWithheld: false`, is refused. This can't read prose: a person still reads each fixture diff.
 */
const PRICE_FIELDS = ['price', 'close', 'open', 'high', 'low', 'level', 'value'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const priced = (o) => PRICE_FIELDS.some((k) => typeof o[k] === 'number') || (isObject(o.values) && PRICE_FIELDS.some((k) => typeof o.values[k] === 'number'));

/** What in one recorded body could be vendor data. Empty = it passes. */
export const vendorFailures = (value, path = 'body') => {
  if (Array.isArray(value)) { return value.flatMap((v, i) => vendorFailures(v, `${path}[${i}]`)); }
  if (!isObject(value)) { return []; }
  const own = [];
  if (value.priceWithheld === false) { own.push(`${path}: priceWithheld is false (a licensed close)`); }
  if (typeof value.symbol === 'string' && value.symbol !== 'BTCOC/USD' && priced(value)) {
    own.push(`${path}: a price on ${value.symbol} (only BTCOC/USD, DWLF's own data, may be committed)`);
  }
  return [...own, ...Object.entries(value).flatMap(([k, v]) => vendorFailures(v, `${path}.${k}`))];
};
