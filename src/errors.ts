/**
 * What the agent should do after a refused call (DWLF-685). Every tool reports a failure through the client's
 * enriched `error.message`, so this turns a 401 / 403 / 429 into one "Next:" line naming the call (an MCP tool where
 * there is one), the plan and a link. The API's own `nextStep` object wins when it is there; the fallbacks cover
 * the refusals the API cannot shape (API Gateway's bare 401) and older API deploys.
 */

export interface NextStep {
  action: string;
  call?: string;
  plan?: string;
  url?: string;
  retryAfterSeconds?: number;
}

const GETTING_STARTED_URL = 'https://docs.dwlf.co.uk/getting-started.html';
const PRICING_URL = 'https://block.dwlf.co.uk/pricing/';

/** API calls an MCP tool makes, so a step can name the tool instead of an HTTP call the agent cannot send. */
const TOOL_FOR_CALL: Record<string, string> = {
  'POST /v2/agent/register': 'dwlf_register_agent',
  // No tool of its own: registering the same email again (disclaimer accepted, as the first time) re-sends the email.
  'POST /v2/agent/resend-activation': 'dwlf_register_agent (same email, disclaimerAccepted and disclaimerVersion as before: it re-sends the activation email)',
  'GET /v2/quotas/my': 'dwlf_get_quotas',
  'GET /v2/subscriptions': 'dwlf_list_subscriptions',
  'POST /v2/subscriptions': 'dwlf_create_subscription',
};

type Body = Record<string, unknown> | undefined;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const isNextStep = (v: unknown): v is NextStep =>
  Boolean(v) && typeof v === 'object' && typeof (v as NextStep).action === 'string';

/**
 * Where this server runs decides the one fallback the API cannot give: what to do about a refused key (API Gateway's
 * bare 401). Locally (stdio) the key is the user's DWLF_API_KEY; hosted, it was minted for the client's connection.
 */
export type Deployment = 'stdio' | 'hosted';

/** The step for a refusal, or null when the status/body is not one this knows how to advise on. */
export function nextStepFor(status: number, body: Body, deployment: Deployment = 'stdio'): NextStep | null {
  if (isNextStep(body?.nextStep)) return body.nextStep;
  const error = str(body?.error);
  if (status === 401 && deployment === 'hosted') {
    return {
      action: 'The connection to DWLF is no longer authorised (it expired or the user disconnected it). Ask your user '
        + 'to reconnect DWLF in their MCP client, then retry.',
      url: GETTING_STARTED_URL,
    };
  }
  if (status === 401) {
    return {
      action:
        'The DWLF API key is missing, invalid or revoked. If your user has no key yet, call dwlf_register_agent ' +
        '(their email, after they accept the disclaimer); otherwise ask them to put their key in this MCP ' +
        'server\'s DWLF_API_KEY setting and restart it.',
      call: 'dwlf_register_agent',
      url: GETTING_STARTED_URL,
    };
  }
  if (status === 403 && error === 'PLAN_REQUIRED') {
    const plan = str(body?.requiredPlan);
    return {
      action: `This needs the ${plan || 'a paid'} plan. Ask your user to upgrade at the link; nothing else unlocks it.`,
      plan,
      url: str(body?.upgradeUrl) || PRICING_URL,
    };
  }
  if (status === 403 && error === 'ACCOUNT_NOT_ACTIVATED') {
    return {
      action:
        'Ask your user to open the activation email DWLF sent them and click the link, then retry. ' +
        'If it did not arrive, call dwlf_register_agent again with the same email, disclaimerAccepted and ' +
        'disclaimerVersion as before: it re-sends the email and makes no new key.',
      call: 'dwlf_register_agent',
      url: GETTING_STARTED_URL,
    };
  }
  if (status === 403 && (str(body?.reason) === 'scope_missing' || str(body?.required_scope))) {
    const scope = str(body?.required_scope) || str(body?.requiredPermission);
    return {
      action:
        `This API key lacks the ${scope || 'required'} scope. Ask your user for a DWLF API key that has it.`,
      url: GETTING_STARTED_URL,
    };
  }
  if (status === 429) {
    const retry = num(body?.retryAfter);
    const upgrade = str(body?.upgradeUrl);
    return {
      action:
        `Retry this call${retry ? ` after ${retry} s` : ' later'}` +
        (upgrade ? ', or ask your user to move to a bigger plan at the link.' : '.'),
      url: upgrade,
      retryAfterSeconds: retry,
    };
  }
  return null;
}

/** One line for an error message: "Next: … Call: … Plan: … Link: …". */
export function formatNextStep(step: NextStep): string {
  const call = step.call ? TOOL_FOR_CALL[step.call] || step.call : undefined;
  return [
    `Next: ${step.action}`,
    call ? `Call: ${call}.` : null,
    step.plan ? `Plan: ${step.plan}.` : null,
    step.url ? `Link: ${step.url}` : null,
  ].filter(Boolean).join(' ');
}
