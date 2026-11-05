import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The hosted MCP stack (DWLF-622; docs/HOSTED-MCP.md §3, §6): one Lambda behind a REGIONAL REST API (so a WAF web
 * ACL attaches; HTTP APIs take none), the credential + limit table, and the KMS key that seals each managed key.
 * It holds no market data and makes no policy: every tool call goes to api.dwlf.co.uk on the account's managed key.
 *
 * `enabled` defaults to false. Deployed that way the function answers 404 to every path and reads no other setting,
 * so the stack can exist before the authorization server does. Turning it on is a context change and a deploy.
 */
export type HostedMcpStackProps = cdk.StackProps & {
  enabled?: boolean;
  /** The canonical URI clients connect to: the token audience. */
  resource?: string;
  /** The authorization server (docs/HOSTED-MCP.md §9.1); its issuer, JWKS, token exchange and revocation. */
  issuer?: string;
  jwksUri?: string;
  tokenExchangeUrl?: string;
  revocationUrl?: string;
  exchangeClientId?: string;
  apiBaseUrl?: string;
  /** Package version, reported in `initialize`. */
  version?: string;
  /** Who hears about the alarms (an email subscription to the stack's topic). Unset = the topic, with no subscriber yet. */
  alarmEmail?: string;
};

/**
 * Log events that mean the endpoint is degraded even though every request got an answer, each alarmed on its
 * first occurrence in 5 minutes. The handler logs one JSON line per event (`event` field).
 */
export const LOG_ALARMS: readonly { event: string; why: string }[] = [
  { event: 'hosted-mcp-unhandled', why: 'a request ended in a 500 (an error the handler did not expect)' },
  { event: 'hosted-mcp-limits-unavailable', why: 'the limit table could not be reached, so the MCP-level limits failed open' },
  { event: 'hosted-mcp-key-revoke-failed', why: 'a managed key could not be revoked and may still be live at SPT' },
  { event: 'hosted-mcp-credential-failed', why: 'a caller could not get a managed key (the token exchange or KMS failed)' },
  { event: 'hosted-mcp-jwks-unavailable', why: "the authorization server's keys could not be read, so every caller gets 503" },
];

/** Requests per 5 minutes per IP before WAF blocks it (every path). Agents batch; a human-driven client never nears it. */
export const WAF_RATE_PER_IP = 1000;
/** API Gateway's own cap across all callers, before Lambda: the denial-of-wallet ceiling. */
export const STAGE_THROTTLE = { rateLimit: 50, burstLimit: 100 };
/** The most Lambda instances the endpoint can hold at once. */
export const RESERVED_CONCURRENCY = 25;
export const EXCHANGE_SECRET_PARAM = '/dwlf/hosted-mcp/exchange-client-secret';

export class HostedMcpStack extends cdk.Stack {
  readonly fn: NodejsFunction;
  readonly table: dynamodb.Table;
  readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: HostedMcpStackProps = {}) {
    super(scope, id, props);

    const key = new kms.Key(this, 'ManagedKeySeal', {
      alias: 'alias/dwlf-hosted-mcp',
      description: 'Seals the per-account managed DWLF API keys the hosted MCP holds (DWLF-622)',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Retained and deletion-protected: losing it only forces every connection to re-mint, but a re-mint after a
    // restore must not find stale keys, so it is never recreated by accident either.
    this.table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const secretParamArn = cdk.Stack.of(this).formatArn({ service: 'ssm', resource: 'parameter', resourceName: EXCHANGE_SECRET_PARAM.slice(1) });

    this.fn = new NodejsFunction(this, 'Handler', {
      entry: path.join(here, '..', '..', 'src', 'hosted', 'lambda.ts'),
      // Bundled from the package root, against its lockfile: the tools are the package's own code.
      projectRoot: path.join(here, '..', '..'),
      depsLockFilePath: path.join(here, '..', '..', 'package-lock.json'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      // Above the 24 s call deadline (the host answers first), below API Gateway's 29 s integration limit.
      timeout: cdk.Duration.seconds(27),
      reservedConcurrentExecutions: RESERVED_CONCURRENCY,
      environment: {
        HOSTED_MCP_ENABLED: props.enabled ? 'true' : 'false',
        HOSTED_MCP_RESOURCE: props.resource ?? 'https://mcp.block.dwlf.co.uk/mcp',
        // SPT's authorization server (§9.1 B; SPT #745): its own issuer host, endpoints on the API.
        HOSTED_MCP_ISSUER: props.issuer ?? 'https://auth.dwlf.co.uk',
        HOSTED_MCP_JWKS_URI: props.jwksUri ?? 'https://api.dwlf.co.uk/v2/oauth/jwks',
        HOSTED_MCP_TOKEN_EXCHANGE_URL: props.tokenExchangeUrl ?? 'https://api.dwlf.co.uk/v2/oauth/token',
        HOSTED_MCP_REVOCATION_URL: props.revocationUrl ?? 'https://api.dwlf.co.uk/v2/oauth/revoke',
        HOSTED_MCP_EXCHANGE_CLIENT_ID: props.exchangeClientId ?? 'dwlf-hosted-mcp',
        HOSTED_MCP_EXCHANGE_CLIENT_SECRET_PARAM: EXCHANGE_SECRET_PARAM,
        HOSTED_MCP_API_BASE_URL: props.apiBaseUrl ?? 'https://api.dwlf.co.uk',
        HOSTED_MCP_TABLE: this.table.tableName,
        HOSTED_MCP_KMS_KEY_ID: key.keyArn,
        HOSTED_MCP_VERSION: props.version ?? 'unknown',
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
        format: OutputFormat.CJS,
        // The runtime provides the v3 SDK; bundling it only grows the cold start.
        externalModules: ['@aws-sdk/*'],
      },
      logGroup: new logs.LogGroup(this, 'HandlerLogs', { retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: cdk.RemovalPolicy.DESTROY }),
    });
    this.table.grantReadWriteData(this.fn);
    key.grant(this.fn, 'kms:Encrypt', 'kms:Decrypt');
    this.fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [secretParamArn] }));

    this.api = new apigw.RestApi(this, 'Api', {
      restApiName: 'dwlf-hosted-mcp',
      description: 'Hosted MCP endpoint (DWLF-622)',
      endpointConfiguration: { types: [apigw.EndpointType.REGIONAL] },
      deployOptions: {
        stageName: 'live',
        throttlingRateLimit: STAGE_THROTTLE.rateLimit,
        throttlingBurstLimit: STAGE_THROTTLE.burstLimit,
        // No request or response bodies in the logs: they carry tokens and account data.
        loggingLevel: apigw.MethodLoggingLevel.ERROR,
        dataTraceEnabled: false,
        metricsEnabled: true,
      },
      // An unknown path is API Gateway's own 403/404; only these reach the function.
      disableExecuteApiEndpoint: false,
    });
    const integration = new apigw.LambdaIntegration(this.fn, { proxy: true, timeout: cdk.Duration.seconds(29) });
    // POST is the endpoint; GET and DELETE reach the function so it can answer 405 as the spec asks.
    const mcp = this.api.root.addResource('mcp');
    for (const method of ['POST', 'GET', 'DELETE']) mcp.addMethod(method, integration);
    const prm = this.api.root.addResource('.well-known').addResource('oauth-protected-resource');
    prm.addMethod('GET', integration);
    prm.addResource('mcp').addMethod('GET', integration);

    this.waf();
    this.alarms(props.alarmEmail);

    new cdk.CfnOutput(this, 'EndpointUrl', { value: `${this.api.url}mcp` });
    new cdk.CfnOutput(this, 'Enabled', { value: props.enabled ? 'true' : 'false' });
  }

  /** Per-IP rate limiting and AWS's common rules, in front of everything (docs/HOSTED-MCP.md §6). */
  private waf() {
    const acl = new wafv2.CfnWebACL(this, 'WebAcl', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'dwlf-hosted-mcp', sampledRequestsEnabled: false },
      rules: [
        {
          name: 'rate-per-ip',
          priority: 0,
          action: { block: {} },
          statement: { rateBasedStatement: { limit: WAF_RATE_PER_IP, aggregateKeyType: 'IP' } },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'rate-per-ip', sampledRequestsEnabled: false },
        },
        {
          name: 'aws-common',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
              // A strategy definition is a legitimate body over 8 KB; the function caps bodies at 256 KB itself.
              ruleActionOverrides: [{ name: 'SizeRestrictions_BODY', actionToUse: { count: {} } }],
            },
          },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'aws-common', sampledRequestsEnabled: false },
        },
      ],
    });
    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: this.api.deploymentStage.stageArn,
      webAclArn: acl.attrArn,
    });
  }

  private alarms(alarmEmail?: string) {
    const topic = new sns.Topic(this, 'Alarms', { displayName: 'DWLF hosted MCP alarms' });
    if (alarmEmail) topic.addSubscription(new subscriptions.EmailSubscription(alarmEmail));
    const action = new cwActions.SnsAction(topic);
    const alarm = (id: string, description: string, metric: cloudwatch.IMetric) => {
      new cloudwatch.Alarm(this, id, {
        alarmDescription: `Hosted MCP: ${description}.`,
        metric,
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(action);
    };
    const period = cdk.Duration.minutes(5);
    // Lambda Errors counts crashes and timeouts (the handler itself answers every error it catches: see LOG_ALARMS).
    alarm('HandlerErrors', 'the function crashed or timed out', this.fn.metricErrors({ period }));
    alarm('HandlerThrottles', 'reserved concurrency is exhausted (callers see 429/502)', this.fn.metricThrottles({ period }));
    alarm('Api5xx', 'API Gateway answered 5xx', this.api.metricServerError({ period }));
    for (const { event, why } of LOG_ALARMS) {
      const id = event.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase());
      const filter = new logs.MetricFilter(this, `${id}Filter`, {
        logGroup: this.fn.logGroup,
        metricNamespace: 'DWLF/HostedMcp',
        metricName: event,
        filterPattern: logs.FilterPattern.stringValue('$.event', '=', event),
        metricValue: '1',
      });
      alarm(id, why, filter.metric({ period, statistic: 'Sum' }));
    }
  }
}
