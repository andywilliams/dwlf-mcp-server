import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAnnotationTools } from '../dist/tools/annotations.js';

// DWLF-580: an alert_line created through the MCP is a drawing; it arms no price alert, and the
// tool text an agent reads must say so rather than call it a "price-alert line".
test('the annotation tools say an alert_line does not arm an alert', () => {
  const descriptions = [];
  const server = { tool: (_name, desc) => { descriptions.push(desc); } };
  registerAnnotationTools(server, { get: async () => ({}) });
  const text = descriptions.join('\n');
  const alertLine = text.split('\n').find((l) => l.startsWith('• alert_line'));
  assert.ok(alertLine, 'alert_line is described');
  assert.match(alertLine, /does NOT arm a price alert/);
});
