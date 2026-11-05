import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { HostedMcpStack, LOG_ALARMS, RESERVED_CONCURRENCY, STAGE_THROTTLE, WAF_RATE_PER_IP } from '../lib/hosted-mcp-stack.js';

// DWLF-622: what the hosted MCP stack commits to. Synthesised once (bundling runs esbuild on src/hosted/lambda.ts).
const app = new cdk.App();
const stack = new HostedMcpStack(app, 'Test', { env: { account: '111111111111', region: 'eu-west-2' }, version: '9.9.9' });
const template = Template.fromStack(stack);

test('off by default: the function is deployed dark', () => {
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: { Variables: Match.objectLike({ HOSTED_MCP_ENABLED: 'false', HOSTED_MCP_VERSION: '9.9.9' }) },
  });
});

test('the function: Node 22, under the gateway limit, reserved concurrency', () => {
  const fns = Object.values(template.findResources('AWS::Lambda::Function', { Properties: { Handler: 'index.handler' } })) as { Properties: Record<string, unknown> }[];
  assert.equal(fns.length, 1);
  const p = fns[0].Properties;
  assert.equal(p.Runtime, 'nodejs22.x');
  assert.ok((p.Timeout as number) < 29);
  assert.equal(p.ReservedConcurrentExecutions, RESERVED_CONCURRENCY);
});

test('the table and the key are retained; the table is protected, with TTL and PITR', () => {
  template.hasResource('AWS::DynamoDB::Table', {
    DeletionPolicy: 'Retain',
    Properties: Match.objectLike({
      DeletionProtectionEnabled: true,
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
    }),
  });
  template.hasResource('AWS::KMS::Key', { DeletionPolicy: 'Retain', Properties: Match.objectLike({ EnableKeyRotation: true }) });
});

test('only /mcp and the protected-resource metadata reach the function', () => {
  const paths = Object.values(template.findResources('AWS::ApiGateway::Resource')).map((r) => (r as { Properties: { PathPart: string } }).Properties.PathPart).sort();
  assert.deepEqual(paths, ['.well-known', 'mcp', 'mcp', 'oauth-protected-resource']);
  template.hasResourceProperties('AWS::ApiGateway::Stage', {
    MethodSettings: Match.arrayWith([Match.objectLike({ ThrottlingRateLimit: STAGE_THROTTLE.rateLimit, ThrottlingBurstLimit: STAGE_THROTTLE.burstLimit, DataTraceEnabled: false })]),
  });
});

test('WAF: a per-IP rate rule and the common rule set, attached to the stage', () => {
  template.hasResourceProperties('AWS::WAFv2::WebACL', {
    Scope: 'REGIONAL',
    Rules: Match.arrayWith([Match.objectLike({ Statement: { RateBasedStatement: { Limit: WAF_RATE_PER_IP, AggregateKeyType: 'IP' } } })]),
  });
  template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
});

test('IAM: SSM read is the one exchange-secret parameter, nothing wider', () => {
  const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'));
  assert.match(policies, /parameter\/dwlf\/hosted-mcp\/exchange-client-secret/);
  assert.doesNotMatch(policies, /"ssm:GetParameter"[^\]]*"Resource":"\*"/);
});

test('every alarm has a destination; the degraded-but-answering log events are alarmed', () => {
  const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm')) as { Properties: { AlarmActions?: unknown[] } }[];
  assert.equal(alarms.length, 3 + LOG_ALARMS.length);
  for (const a of alarms) assert.equal(a.Properties.AlarmActions?.length, 1);
  const filters = JSON.stringify(template.findResources('AWS::Logs::MetricFilter'));
  for (const { event } of LOG_ALARMS) assert.ok(filters.includes(event), event);
});
