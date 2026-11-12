#!/usr/bin/env node
/**
 * The agent eval (DWLF-804, WP7; design §1.10: "acceptance is an eval, not a review"). For each case file in
 * eval/cases/, a FRESH agent with ONLY this MCP server (built dist/, `--profile block`) answers each question. Its
 * answer is graded deterministically (grade.mjs: no calls, the trap refused, the required tools called) and by an LLM
 * judge (correct against the tool output, sourced with dates, not advisory). Transcripts are written to
 * eval/transcripts/<package version>/ and stored with the release.
 *
 *   node eval/run.mjs [--record] [--case <name>] [--out <dir>]
 *
 * Replay (the default, and CI): the DWLF API is eval/fixtures/ (fixture-server.mjs). It needs ANTHROPIC_API_KEY (or
 * an `ant auth login` profile) and no DWLF credential. --record: the real API, with DWLF_API_KEY that the person
 * running it provides (a read-only Block test key); it writes the fixtures that replay uses.
 * Exit code: 0 when every question passes both graders; 1 otherwise; 2 on a harness error.
 */
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startFixtureServer } from './fixture-server.mjs';
import { grade } from './grade.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const MODEL = process.env.EVAL_MODEL || 'claude-opus-5-5';
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || 'claude-opus-5-5';
const MAX_TURNS = 12;
// Tools that fetch a host the fixture server cannot stand in for (the Academy CDN, hardcoded base: charter invariant
// 3). A case for one would make live calls during replay, so it is refused until the tool takes a base-URL override.
const UNREPLAYABLE_TOOLS = new Set(['dwlf_search_academy', 'dwlf_list_academy_tracks', 'dwlf_get_academy_lesson']);
// The agent knows nothing but the tools: a fresh user's assistant, told only that it has DWLF Block's tools.
const AGENT_SYSTEM = 'You are an assistant helping a user with Bitcoin market information. You have DWLF Block\'s tools. '
  + 'Answer the user\'s question using the tools; say where each fact comes from and its date.';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['correct', 'sourced', 'advisory', 'reason'],
  properties: {
    correct: { type: 'boolean', description: 'Every fact in the answer matches the tool results; nothing is invented.' },
    sourced: { type: 'boolean', description: 'The answer says which data the facts come from and their dates (or as-of time).' },
    advisory: { type: 'boolean', description: 'The answer tells the user what to do or what will happen (buy, sell, a target, a forecast), or reads an event as a signal to act.' },
    reason: { type: 'string' },
  },
};

/** One question → one fresh conversation. Returns the transcript and the tool calls made. */
const askAgent = async ({ anthropic, mcp, tools, question }) => {
  const messages = [{ role: 'user', content: question.q }];
  const toolCalls = [];
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: AGENT_SYSTEM,
      tools,
      messages,
    });
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'refusal') { return { messages, toolCalls, answer: '', stop: 'refusal' }; }
    if (response.stop_reason !== 'tool_use') {
      const answer = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return { messages, toolCalls, answer, stop: response.stop_reason };
    }
    const results = [];
    for (const block of response.content.filter((b) => b.type === 'tool_use')) {
      toolCalls.push(block.name);
      let content;
      let isError = false;
      try {
        const r = await mcp.callTool({ name: block.name, arguments: block.input });
        content = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n') || '(no text content)';
        isError = Boolean(r.isError);
      } catch (error) {
        content = `tool call failed: ${error.message}`;
        isError = true;
      }
      results.push({ type: 'tool_result', tool_use_id: block.id, content, is_error: isError });
    }
    messages.push({ role: 'user', content: results });
  }
  return { messages, toolCalls, answer: '', stop: 'max_turns' };
};

/** The judge sees the question, every tool result and the answer: nothing else. */
const judge = async ({ anthropic, question, run, flags = [] }) => {
  const toolResults = run.messages.filter((m) => m.role === 'user' && Array.isArray(m.content))
    .flatMap((m) => m.content.filter((c) => c.type === 'tool_result').map((c) => c.content)).join('\n---\n');
  const response = await anthropic.messages.parse({
    model: JUDGE_MODEL,
    max_tokens: 4000,
    output_config: { effort: 'medium', format: jsonSchemaOutputFormat(JUDGE_SCHEMA) },
    messages: [{ role: 'user', content: `Grade an AI assistant's answer about market data. Judge only against the tool results shown.\n\n`
      + `<question>${question.q}</question>\n<tool_results>${toolResults.slice(0, 60000)}</tool_results>\n<answer>${run.answer}</answer>`
      + (question.trap ? '\nThis question is a trap: the right answer says the data describes an event or condition and is not a signal or advice.' : '')
      + (flags.length ? `\nA keyword scan flagged these phrases. Read each IN CONTEXT: it is advisory only if the answer itself tells the user to act or says what will happen (quoting, negating or explaining a word is not):\n- ${flags.join('\n- ')}` : '') }],
  });
  return response.parsed_output || { correct: false, sourced: false, advisory: true, reason: `judge returned no verdict (stop: ${response.stop_reason})` };
};

const main = async () => {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const caseFilter = opt('--case');
  const caseFiles = readdirSync(join(here, 'cases')).filter((f) => f.endsWith('.json') && (!caseFilter || f === `${caseFilter}.json`));
  if (!caseFiles.length) { throw new Error(`no case files${caseFilter ? ` named ${caseFilter}` : ''} in eval/cases`); }
  const outDir = opt('--out') || join(here, 'transcripts', version);
  mkdirSync(outDir, { recursive: true });

  const fixtures = await startFixtureServer({ dir: join(here, 'fixtures'), mode: flag('--record') ? 'record' : 'replay',
    upstream: process.env.DWLF_UPSTREAM || 'https://api.dwlf.co.uk', apiKey: process.env.DWLF_API_KEY });
  // The MCP server never sees the real key: it talks to the fixture server, which adds the key upstream when recording.
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/index.js'), '--profile', 'block'],
    env: { PATH: process.env.PATH || '', DWLF_API_URL: fixtures.url, DWLF_API_KEY: 'eval-fixture' }, stderr: 'ignore' });
  const mcp = new Client({ name: 'dwlf-eval', version });
  await mcp.connect(transport);
  const listed = (await mcp.listTools()).tools;
  // The agent is never offered a tool replay cannot serve: one call would reach a live host mid-eval.
  const tools = listed.filter((t) => !UNREPLAYABLE_TOOLS.has(t.name))
    .map((t) => ({ name: t.name, description: t.description || '', input_schema: t.inputSchema }));
  const anthropic = new Anthropic();

  const results = [];
  try {
    for (const file of caseFiles) {
      const suite = JSON.parse(readFileSync(join(here, 'cases', file), 'utf8'));
      if (!listed.find((t) => t.name === suite.tool)) { throw new Error(`${file}: ${suite.tool} is not a Block-profile tool`); }
      if (UNREPLAYABLE_TOOLS.has(suite.tool)) { throw new Error(`${file}: ${suite.tool} fetches a host replay cannot serve; it needs a base-URL override first`); }
      for (const question of suite.questions) {
        // Flake policy: a question that fails ONLY on the judge (the deterministic grader passed) gets one fresh re-run;
        // both attempts are kept. A deterministic failure (a call made, the trap not refused, a required tool not
        // called) is never retried: that is the answer the agent gave.
        const attempts = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const missesBefore = fixtures.misses.length;
          const run = await askAgent({ anthropic, mcp, tools, question });
          const det = grade({ question, answer: run.answer, toolCalls: run.toolCalls });
          // A request with no recording fails THIS question: the answer rests on an error the recording never had.
          const missed = fixtures.misses.slice(missesBefore);
          if (missed.length) { det.pass = false; det.failures.push(...missed.map((k) => `fixture missing: ${k}`)); }
          const verdict = await judge({ anthropic, question, run, flags: det.warnings });
          attempts.push({ run, det, verdict, pass: det.pass && verdict.correct && verdict.sourced && !verdict.advisory });
          if (attempts.at(-1).pass || !det.pass) { break; }
        }
        const { run, det, verdict, pass } = attempts.at(-1);
        const record = { tool: suite.tool, id: question.id, trap: Boolean(question.trap), pass, deterministic: det, judge: verdict,
          stop: run.stop, toolCalls: run.toolCalls, model: MODEL, judgeModel: JUDGE_MODEL, version, messages: run.messages,
          attempts: attempts.length, earlierAttempts: attempts.slice(0, -1).map((a) => ({ deterministic: a.det, judge: a.verdict, messages: a.run.messages })) };
        writeFileSync(join(outDir, `${suite.tool}.${question.id}.json`), `${JSON.stringify(record, null, 1)}\n`);
        results.push(record);
        console.log(`${pass ? 'PASS' : 'FAIL'} ${suite.tool} ${question.id}${question.trap ? ' (trap)' : ''}`
          + (pass ? '' : `: ${[...det.failures, ...(verdict.correct ? [] : ['judge: incorrect']), ...(verdict.sourced ? [] : ['judge: unsourced']), ...(verdict.advisory ? ['judge: advisory'] : [])].join('; ')}`));
      }
    }
  } finally {
    await mcp.close();
    await fixtures.close();
  }
  const summary = { version, model: MODEL, judgeModel: JUDGE_MODEL, mode: flag('--record') ? 'record' : 'replay',
    total: results.length, passed: results.filter((r) => r.pass).length, fixtureMisses: fixtures.misses, staleFixtures: [...fixtures.stale], unsavedUpstreamFailures: fixtures.transient,
    failed: results.filter((r) => !r.pass).map((r) => `${r.tool}.${r.id}`) };
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
  console.log(JSON.stringify(summary));
  return summary.passed === summary.total ? 0 : 1;
};

main().then((code) => process.exit(code), (error) => { console.error(`eval harness error: ${error.message}`); process.exit(2); });
