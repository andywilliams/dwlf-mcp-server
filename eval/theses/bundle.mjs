import { registerThesisTools } from '../../dist/tools/theses.js';
import { THESIS_GUIDE } from '../../dist/tools/thesisGuide.js';
const tools = [];
registerThesisTools({ tool: (name, desc, schema) => tools.push({ name, desc, params: Object.keys(schema || {}) }) }, {});
let out = '# DWLF MCP: thesis tools (descriptions as an agent sees them)\n\n';
for (const t of tools) out += `## ${t.name}\nParameters: ${t.params.join(', ') || 'none'}\n\n${t.desc}\n\n`;
out += '# dwlf_thesis_guide output\n\n```json\n' + JSON.stringify(THESIS_GUIDE, null, 2) + '\n```\n';
process.stdout.write(out);
