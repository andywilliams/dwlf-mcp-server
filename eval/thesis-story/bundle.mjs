// What a fresh agent is given (eval/thesis-story/README.md): the story tool as an MCP client lists it, the beat-kind
// definitions, and the tool's answer for the GOOG example (the fixture, with the agentHints the tool adds). An argument
// names another fixture in this folder (goog-story-routes.json: the same thesis a day later, with illustrated routes;
// goog-story-replay.json: asked with replay: true, DWLF-889).
import { readFileSync } from 'node:fs';
import { registerThesisTools } from '../../dist/tools/theses.js';
import { z } from 'zod';
const tools = new Map();
registerThesisTools({ tool: (name, desc, schema, fn) => tools.set(name, { desc, schema: z.toJSONSchema(z.object(schema || {})), fn }) }, {
  get: async () => JSON.parse(readFileSync(new URL(`./${process.argv[2] || 'goog-story.json'}`, import.meta.url), 'utf8')),
});
const t = tools.get('dwlf_get_thesis_story');
const res = await t.fn({ thesisId: 'goog-example', ...(String(process.argv[2]).includes('replay') ? { replay: true } : {}) });
process.stdout.write(`# DWLF MCP: dwlf_get_thesis_story\n\n${t.desc}\n\nInput schema:\n\`\`\`json\n${JSON.stringify(t.schema)}\n\`\`\`\n\n# Its answer for the user's GOOG thesis\n\n\`\`\`json\n${res.content[0].text}\n\`\`\`\n`);
