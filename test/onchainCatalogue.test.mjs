import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerOnchainCatalogueTools } from '../dist/tools/onchain-catalogue.js';
import { ONCHAIN_EVENTS, ONCHAIN_PACKS, ONCHAIN_CATALOGUE_AS_OF } from '../dist/data/onchainCatalogue.js';

// DWLF-621 / DWLF-646: dwlf_describe_onchain_events answers from the LIVE explain index (GET /events/explain), and
// from the bundled catalogue when that can't be read. Most tests below run the FALLBACK: their `get` answers only
// /node-types (an API without `types[]`); the "api:" tests serve an index built from SPT's fixture.
// The engine's live node catalogue (GET /node-types): by default it lists one cost-basis type and no pack type.
const nodeTypes = (ids) => ({ nodeTypes: ids.map((id) => ({ id, label: id, category: 'onchain', description: '', direction: 'neutral', inputs: 1, outputs: 1, parameters: [], usedIn: ['event'] })) });
const olderApi = async (p) => {
  if (p === '/node-types') return nodeTypes(['onchain.sth_realised_price.cross.below']);
  throw Object.assign(new Error('HTTP 404 — Not Found'), { response: { status: 404 } });
};
const setup = ({ get = olderApi } = {}) => {
  let handler;
  let description;
  const calls = [];
  registerOnchainCatalogueTools({ tool: (_n, d, _s, fn) => { description = d; handler = fn; } }, { get: async (p) => { calls.push(p); return get(p); } });
  const call = async (args) => {
    const res = await handler(args);
    return { res, body: res.isError ? null : JSON.parse(res.content[0].text) };
  };
  return { call, calls, description: () => description };
};

test('the catalogue: unique ids, every onchain.*, every entry in a known pack, counts agree', () => {
  const ids = ONCHAIN_EVENTS.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith('onchain.')));
  for (const e of ONCHAIN_EVENTS) {assert.ok(ONCHAIN_PACKS[e.pack], `${e.id}: pack ${e.pack}`);}
  for (const [id, p] of Object.entries(ONCHAIN_PACKS)) {assert.equal(p.count, ONCHAIN_EVENTS.filter((e) => e.pack === id).length, id);}
  assert.ok(ids.includes('onchain.sth_realised_price.cross.below'), 'the v1 cost-basis types are in');
});

test('no direction labels and no calls: conditions only', () => {
  for (const e of ONCHAIN_EVENTS) {
    assert.equal('direction' in e, false, e.id);
    assert.doesNotMatch(e.meaning, /\b(buy|sell)(s|ing)?\b/i, e.id);
  }
});

test('no arguments: the packs, each saying LIVE whether the engine has it', async () => {
  const { body, } = await setup().call({});
  assert.equal(body.total, ONCHAIN_EVENTS.length);
  // The bundle's engine group is named `engine` here too (its `costBasis`).
  assert.deepEqual(body.packs.map((p) => p.pack).sort(), Object.keys(ONCHAIN_PACKS).map((p) => (p === 'costBasis' ? 'engine' : p)).sort());
  const inEngine = Object.fromEntries(body.packs.map((p) => [p.pack, p.inEngine]));
  assert.equal(inEngine.engine, true);
  assert.equal(inEngine.mining, false);
  assert.equal(body.framing, 'Conditions, not calls.');
});

test('one type reports its OWN engine state, not its pack\'s', async () => {
  const { call } = setup(); // the engine lists onchain.sth_realised_price.cross.below only
  const listed = (await call({ eventType: 'onchain.sth_realised_price.cross.below' })).body;
  assert.equal(listed.event.inEngine, true);
  const sibling = (await call({ eventType: 'onchain.sth_realised_price.cross.above' })).body;
  assert.equal(sibling.event.inEngine, false);
  assert.equal(sibling.packState.inEngine, true); // the pack is partly in
  const listing = (await call({ pack: 'costBasis' })).body.events;
  assert.equal(listing.find((e) => e.id === 'onchain.sth_realised_price.cross.below').inEngine, true);
  assert.equal(listing.find((e) => e.id === 'onchain.sth_realised_price.cross.above').inEngine, false);
});

test('an unreadable engine catalogue reads as unknown (null), never as "not in the engine"', async () => {
  const { body } = await setup({ get: async () => { throw new Error('HTTP 503'); } }).call({ pack: 'fees' });
  assert.equal(body.packState.inEngine, null);
  assert.equal(body.events.length, ONCHAIN_PACKS.fees.count);
});

test('the engine catalogue is read once and cached across calls', async () => {
  const t = setup();
  await t.call({});
  await t.call({ pack: 'mining' });
  await t.call({ eventType: 'onchain.mining.difficulty.retarget' });
  assert.deepEqual(t.calls.filter((p) => p === '/node-types'), ['/node-types']);
  assert.equal((await t.call({ search: 'hash' })).body.count > 0, true);
});

test('one type in full; a key suffix is ignored; an unknown id is a usage error', async () => {
  const { call } = setup();
  const { body } = await call({ eventType: 'onchain.mining.hash_ribbon.capitulation.enter' });
  assert.equal(body.event.pack, 'mining');
  assert.ok(body.event.meaning && body.event.caveats !== undefined);
  const dca = ONCHAIN_EVENTS.find((e) => e.pack === 'dca');
  const suffixed = await call({ eventType: `${dca.id}#cohort=2019-01-01:weekly` });
  assert.equal(suffixed.body.event.id, dca.id);
  const bad = await call({ eventType: 'onchain.nope' });
  assert.equal(bad.res.isError, true);
  assert.match(bad.res.content[0].text, /^Usage: no on-chain event type/);
});

test('a pack, a search, and selector mixing refused', async () => {
  const { call } = setup();
  const { body } = await call({ pack: 'fees' });
  assert.equal(body.events.length, ONCHAIN_PACKS.fees.count);
  const s = await call({ search: 'hash rate' });
  assert.ok(s.body.count > 0 && s.body.events.every((e) => ['hash', 'rate'].every((w) => `${e.id} ${e.meaning}`.toLowerCase().includes(w))));
  assert.equal((await call({ pack: 'mining', search: 'x' })).res.isError, true);
  assert.equal((await call({ pack: 'nope' })).res.isError, true);
  for (const proto of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal((await call({ pack: proto })).res.isError, true, proto);
  }
  assert.equal((await call({ search: '  ' })).res.isError, true);
});

test('the description names every pack and the ingested rule', () => {
  const d = setup().description();
  for (const id of [...Object.keys(ONCHAIN_PACKS).filter((p) => p !== 'costBasis'), 'engine']) {assert.ok(d.includes(`\`${id}\``), id);}
  assert.match(d, /definitionSource/);
  assert.match(d, /inEngine/);
  assert.match(d, /not advice/);
});

// ── live (api) mode and the parity check (DWLF-646) ─────────────────────────────────────────────────────────────
const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/spt-explain-index.json', import.meta.url), 'utf8'));
/** The explain index as SPT serves it, rebuilt from the fixture (`pack` is `{ id, title }` or null on the wire). */
const liveIndex = () => ({
  catalogueAsOf: FIXTURE.catalogueAsOf, brkVersion: FIXTURE.brkVersion, packs: FIXTURE.packs,
  typeSummaries: FIXTURE.typeSummaries.map((t) => ({ ...t, pack: t.pack ? { id: t.pack, title: t.pack } : null, label: null, revisionClass: 'oracle' })),
});
const apiGet = ({ explain = async (type) => ({ type, meaning: 'from the API', method: 'm', inEngine: true }) } = {}) => async (p) => {
  if (p === '/events/explain') return liveIndex();
  const m = /^\/events\/([^/]+)\/explain$/.exec(p);
  if (m) return explain(decodeURIComponent(m[1]));
  throw new Error(`unexpected ${p}`);
};

test('parity: the bundled copy matches what SPT serves (pack types exactly; cost-basis types are engine types there)', () => {
  assert.equal(ONCHAIN_CATALOGUE_AS_OF, FIXTURE.catalogueAsOf, 'same onchain-packs snapshot');
  const api = new Map(FIXTURE.typeSummaries.map((t) => [t.type, t]));
  const problems = [];
  for (const e of ONCHAIN_EVENTS) {
    const a = api.get(e.id);
    if (!a) { problems.push(`${e.id}: bundled but not served`); continue; }
    if (e.pack === 'costBasis') {
      if (a.pack !== null || a.inEngine !== true) problems.push(`${e.id}: bundled as costBasis but not an engine type at SPT`);
      continue;
    }
    if (a.pack !== e.pack) problems.push(`${e.id}: pack ${e.pack} vs ${a.pack}`);
    if (a.meaning !== e.meaning) problems.push(`${e.id}: meaning differs`);
    if (a.estimated !== Boolean(e.estimated)) problems.push(`${e.id}: estimated differs`);
  }
  const bundledPackTypes = new Set(ONCHAIN_EVENTS.filter((e) => e.pack !== 'costBasis').map((e) => e.id));
  for (const t of FIXTURE.typeSummaries.filter((x) => x.pack !== null)) {
    if (!bundledPackTypes.has(t.type)) problems.push(`${t.type}: served in pack ${t.pack} but not bundled`);
  }
  assert.deepEqual(problems, []);
});

test('api: no arguments → the engine pseudo-pack plus each pack, live, with every type counted', async () => {
  const t = setup({ get: apiGet() });
  const { body } = await t.call({});
  const { calls } = t;
  assert.equal(body.definitionSource, 'api');
  assert.equal(body.total, FIXTURE.typeSummaries.length);
  assert.deepEqual(body.packs.map((p) => p.pack), ['engine', ...FIXTURE.packs.map((p) => p.id)]);
  const engine = body.packs.find((p) => p.pack === 'engine');
  assert.equal(engine.count, FIXTURE.typeSummaries.filter((t) => t.pack === null).length);
  assert.equal(engine.inEngine, true);
  assert.ok(!calls.includes('/node-types'), 'engine state comes from the API, not the node catalogue');
});

test('api: a pack, the costBasis alias, search, and an engine type the bundle lacks', async () => {
  const { call } = setup({ get: apiGet() });
  const mining = (await call({ pack: 'mining' })).body;
  assert.equal(mining.events.length, FIXTURE.packs.find((p) => p.id === 'mining').types.length);
  const alias = (await call({ pack: 'costBasis' })).body;
  assert.equal(alias.packState.pack, 'engine');
  assert.match(alias.aliasOf, /costBasis/);
  const hits = (await call({ search: 'hash rate' })).body;
  assert.ok(hits.count > 0 && hits.events.every((e) => /hash/i.test(`${e.id} ${e.meaning}`)));
  const missingFromBundle = FIXTURE.typeSummaries.find((t) => t.pack === null && !ONCHAIN_EVENTS.some((e) => e.id === t.type));
  const one = (await call({ eventType: missingFromBundle.type })).body;
  assert.equal(one.event.id, missingFromBundle.type);
  assert.equal(one.definition.meaning, 'from the API', 'the full definition is read from its explain route, passed through');
  assert.equal(one.event.pack, 'engine');
  assert.equal((await call({ eventType: 'onchain.nope' })).res.isError, true);
});

test('api: if one type\'s full definition fails, its summary line still answers, saying so', async () => {
  const get = apiGet({ explain: async () => { throw new Error('HTTP 503 — busy'); } });
  const { body } = await setup({ get }).call({ eventType: 'onchain.mining.difficulty.retarget' });
  assert.equal(body.definitionSource, 'api');
  assert.equal(body.event.id, 'onchain.mining.difficulty.retarget');
  assert.match(body.detailUnavailable, /503/);
});

test('fallback: an unreadable index uses the bundle and says why; the index is cached once read', async () => {
  const fallback = (await setup().call({})).body;
  assert.equal(fallback.definitionSource, 'bundled');
  assert.match(fallback.apiError, /events\/explain/);
  const t = setup({ get: apiGet() });
  await t.call({});
  await t.call({ pack: 'fees' });
  await t.call({ search: 'fee' });
  assert.equal(t.calls.filter((p) => p === '/events/explain').length, 1);
});

test('fallback: an API without per-type lines (200, pre-#747) uses the bundle, says why, and is remembered briefly', async () => {
  let indexReads = 0;
  const get = async (p) => {
    if (p === '/events/explain') { indexReads += 1; return { packs: FIXTURE.packs, catalogueAsOf: FIXTURE.catalogueAsOf }; }
    return nodeTypes(['onchain.sth_realised_price.cross.below']);
  };
  const t = setup({ get });
  const first = (await t.call({})).body;
  assert.equal(first.definitionSource, 'bundled');
  assert.match(first.apiError, /no per-type lines/);
  await t.call({ search: 'hash' });
  assert.equal(indexReads, 1, 'the too-old verdict is cached, so the fallback answers at once');
});

test('fallback: the engine group is `engine` (with `costBasis` as an alias) and says what the offline copy lacks', async () => {
  const { call } = setup();
  const all = (await call({})).body;
  assert.equal(all.packs[0].pack, 'engine');
  assert.ok(!all.packs.some((p) => p.pack === 'costBasis'));
  assert.match(all.packs[0].missingFromOfflineCopy, /MVRV/);
  const viaAlias = (await call({ pack: 'costBasis' })).body;
  assert.equal(viaAlias.packState.pack, 'engine');
  assert.match(viaAlias.aliasOf, /costBasis/);
  assert.ok(viaAlias.events.every((e) => e.pack === 'engine'));
  const one = (await call({ eventType: 'onchain.sth_realised_price.cross.below' })).body;
  assert.equal(one.event.pack, 'engine');
  assert.match((await call({ pack: 'nope' })).res.content[0].text, /engine/);
});
