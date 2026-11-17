/**
 * Charter check 4 (DWLF-804, WP7): the Block envelope, as this repo checks it. Pure functions, no I/O.
 *
 *   - `requiredFrom(openapi)`: the `required` lists the Block API's OWN published OpenAPI gives for a data route's
 *     envelope and its items. This repo keeps no copy of the field list, so a field the Block API adds or renames
 *     needs no edit here.
 *   - `envelopeFailures(body, required, { family })`: what a data-route body is missing, plus the `knowableAt` value
 *     rules (DWLF-853, live 16-Nov): no item later than the envelope, the envelope the latest item's and no later than
 *     `asOf`, `values.sinceKnowableAt` equal to the item's own, an event no earlier than its date, and on conditions
 *     (where the Block API promises it: "never the time of the request") no item at `asOf`.
 *   - `containmentFailures(result, pages)`: invariant 2's pass-through rule. A tool's result keeps the first upstream
 *     page's top-level fields unchanged and holds every item of every page whole. Extra keys are allowed (additive
 *     enrichment, auto-pagination); dropping, renaming or rewriting an upstream field fails.
 */
import { isDeepStrictEqual } from 'node:util';

/** The data routes (charter §2: catalogue, conditions, events, series), by path, under /v1 or /public/v1. */
export const DATA_ROUTE = /^\/(?:public\/)?v1\/(catalogue|conditions|events|series\/[^/]+)$/;
/** The route family of a Block API path ('catalogue' | 'conditions' | 'events' | 'series'), or null for any other path. */
export const dataFamily = (path) => {
  const m = DATA_ROUTE.exec(path);
  return m ? m[1].split('/')[0] : null;
};

const deref = (doc, node) => {
  let n = node;
  for (let i = 0; n && n.$ref && i < 20; i += 1) {
    n = n.$ref.replace(/^#\//, '').split('/').reduce((o, k) => (o ? o[k] : undefined), doc);
  }
  return n || {};
};
/** Every `required` name a schema imposes, through `$ref` and `allOf`. */
const requiredOf = (doc, schema) => {
  const s = deref(doc, schema);
  return [...new Set([...(s.required || []), ...(s.allOf || []).flatMap((part) => requiredOf(doc, part))])];
};
/** The properties a schema declares, through `$ref` and `allOf`. */
const propertiesOf = (doc, schema) => {
  const s = deref(doc, schema);
  return Object.assign({}, ...(s.allOf || []).map((part) => propertiesOf(doc, part)), s.properties || {});
};

/**
 * From the Block API's OpenAPI: for each data route (as its path template), the envelope's required fields and the
 * fields EVERY item variant requires (an item is one of OpenItem / LockedItem, so only what both require is checked).
 */
export const requiredFrom = (openapi) => {
  const routes = {};
  for (const [path, ops] of Object.entries(openapi.paths || {})) {
    const family = dataFamily(path.replace(/\{[^}]+\}/g, 'x'));
    const schema = ops.get?.responses?.['200']?.content?.['application/json']?.schema;
    if (!family || !schema) { continue; }
    const itemSchema = deref(openapi, propertiesOf(openapi, schema).items).items;
    const variants = itemSchema ? (deref(openapi, itemSchema).oneOf || [itemSchema]) : [];
    const perVariant = variants.map((v) => requiredOf(openapi, v));
    const item = perVariant.length ? perVariant.reduce((a, b) => a.filter((k) => b.includes(k))) : [];
    routes[path] = { family, envelope: requiredOf(openapi, schema), item };
  }
  return routes;
};
/** The required lists for a concrete request path, matched against the OpenAPI path templates. */
export const requiredForPath = (routes, path) => {
  for (const [template, req] of Object.entries(routes)) {
    const re = new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '[^/]+')}$`);
    if (re.test(path)) { return req; }
  }
  return null;
};

const time = (v) => (typeof v === 'string' && v ? Date.parse(v) : NaN);

/** What a data-route body breaks: missing required fields, then the knowableAt rules. Empty = the body passes. */
export const envelopeFailures = (body, required, { family } = {}) => {
  const failures = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) { return ['the body is not an object']; }
  for (const k of required.envelope) { if (!(k in body)) { failures.push(`envelope: no \`${k}\``); } }
  const items = Array.isArray(body.items) ? body.items : [];
  items.forEach((item, i) => {
    for (const k of required.item) { if (!item || !(k in item)) { failures.push(`items[${i}] (${item?.id ?? '?'}): no \`${k}\``); } }
  });
  const asOf = time(body.asOf);
  const top = time(body.knowableAt);
  if ('knowableAt' in body && Number.isNaN(top)) { failures.push('envelope: `knowableAt` is not a time'); }
  if (!Number.isNaN(top) && !Number.isNaN(asOf) && top > asOf) { failures.push(`envelope: \`knowableAt\` ${body.knowableAt} is later than \`asOf\` ${body.asOf}`); }
  let latest = NaN;
  items.forEach((item, i) => {
    if (!item || !('knowableAt' in item)) { return; }
    const at = time(item.knowableAt);
    const where = `items[${i}] (${item.id ?? '?'})`;
    if (Number.isNaN(at)) { failures.push(`${where}: \`knowableAt\` is not a time`); return; }
    latest = Number.isNaN(latest) ? at : Math.max(latest, at);
    if (!Number.isNaN(top) && at > top) { failures.push(`${where}: \`knowableAt\` ${item.knowableAt} is later than the envelope's ${body.knowableAt}`); }
    if (family === 'conditions' && at === asOf) { failures.push(`${where}: \`knowableAt\` is the response's \`asOf\` (the request time), not when its reading became knowable`); }
    const since = item.values?.sinceKnowableAt;
    if (since != null && time(since) !== at) { failures.push(`${where}: \`values.sinceKnowableAt\` ${since} is not its \`knowableAt\` ${item.knowableAt}`); }
    if (family === 'events' && typeof item.date === 'string' && at < Date.parse(`${item.date.slice(0, 10)}T00:00:00Z`)) {
      failures.push(`${where}: \`knowableAt\` ${item.knowableAt} is before the event's date ${item.date}`);
    }
  });
  if (!Number.isNaN(latest) && !Number.isNaN(top) && latest !== top) {
    failures.push(`envelope: \`knowableAt\` ${body.knowableAt} is not the latest item's (${new Date(latest).toISOString()})`);
  }
  return failures;
};

/**
 * Invariant 2's pass-through, by containment. `result`: the parsed JSON a tool gave the agent. `pages`: the upstream
 * bodies it fetched, in order. Empty = every upstream field reached the agent unchanged.
 */
export const containmentFailures = (result, pages) => {
  const failures = [];
  if (!pages.length) { return ['no upstream page to compare with']; }
  if (!result || typeof result !== 'object') { return ['the tool result is not a JSON object']; }
  for (const [k, v] of Object.entries(pages[0])) {
    if (k === 'items') { continue; }
    if (!(k in result)) { failures.push(`dropped \`${k}\``); } else if (!isDeepStrictEqual(result[k], v)) { failures.push(`changed \`${k}\``); }
  }
  const got = Array.isArray(result.items) ? result.items : [];
  pages.forEach((page, p) => (page.items || []).forEach((item, i) => {
    const whole = got.some((g) => g && typeof g === 'object' && Object.entries(item).every(([k, v]) => k in g && isDeepStrictEqual(g[k], v)));
    if (!whole) { failures.push(`page ${p} item ${i} (${item?.id ?? '?'}) is missing or altered`); }
  }));
  return failures;
};
