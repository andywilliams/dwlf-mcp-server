import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerOnchainCatalogueTools } from '../dist/tools/onchain-catalogue.js';
import { ONCHAIN_EVENTS, ONCHAIN_PACKS } from '../dist/data/onchainCatalogue.js';

// DWLF-621: dwlf_describe_onchain_events answers from the bundled catalogue; no API call.
// The engine's live node catalogue (GET /node-types): by default it lists one cost-basis type and no pack type.
const nodeTypes = (ids) => ({ nodeTypes: ids.map((id) => ({ id, label: id, category: 'onchain', description: '', direction: 'neutral', inputs: 1, outputs: 1, parameters: [], usedIn: ['event'] })) });
const setup = ({ get = async () => nodeTypes(['onchain.sth_realised_price.cross.below']) } = {}) => {
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
  assert.deepEqual(body.packs.map((p) => p.pack).sort(), Object.keys(ONCHAIN_PACKS).sort());
  const inEngine = Object.fromEntries(body.packs.map((p) => [p.pack, p.inEngine]));
  assert.equal(inEngine.costBasis, true);
  assert.equal(inEngine.mining, false);
  assert.equal(body.framing, 'Conditions, not calls.');
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
  assert.deepEqual(t.calls, ['/node-types']);
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
  assert.equal((await call({ search: '  ' })).res.isError, true);
});

test('the description names every pack and the ingested rule', () => {
  const d = setup().description();
  for (const id of Object.keys(ONCHAIN_PACKS)) {assert.ok(d.includes(`\`${id}\``), id);}
  assert.match(d, /inEngine/);
  assert.match(d, /not advice/);
});
