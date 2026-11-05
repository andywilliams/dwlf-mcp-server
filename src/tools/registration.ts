/**
 * The pieces of dwlf_register_agent that are not MCP wiring (DWLF-685), kept pure so they can be tested.
 * POST /v2/agent/register needs `disclaimerAccepted` + `disclaimerVersion` (400 with the disclaimer's text otherwise)
 * and `product: "block"` for a Block account. The user must accept the disclaimer themselves, so the 400 is step 1 of
 * the flow, not an error: the tool hands the text to the agent to show its user.
 */
import axios from 'axios';
import { formatNextStep, NextStep } from '../errors.js';

export interface RegistrationInput {
  email: string;
  disclaimerAccepted?: boolean;
  disclaimerVersion?: string;
  product?: 'block' | 'dwlf';
  agentId?: string;
  purpose?: string;
}

/**
 * The request body. `product` defaults to the server's profile: Block under the `block` profile, a classic DWLF
 * account (the API's no-product case) under `full`.
 */
export function registrationBody(input: RegistrationInput, defaultProduct: 'block' | 'dwlf' = 'dwlf'): Record<string, unknown> {
  const body: Record<string, unknown> = { email: input.email };
  if ((input.product ?? defaultProduct) === 'block') body.product = 'block';
  if (input.disclaimerAccepted === true) {
    body.disclaimerAccepted = true;
    if (input.disclaimerVersion) body.disclaimerVersion = input.disclaimerVersion;
  }
  if (input.agentId) body.agentId = input.agentId;
  if (input.purpose) body.purpose = input.purpose;
  return body;
}

const DISCLAIMER_ERRORS = new Set(['Disclaimer acceptance required', 'Disclaimer version mismatch']);

/** Step 1's answer: the disclaimer to show the user and how to accept it, or null if `error` is anything else. */
export function disclaimerFromError(error: unknown): string | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 400) return null;
  const data = error.response.data as Record<string, any> | undefined;
  if (!data || !DISCLAIMER_ERRORS.has(data.error) || !data.disclaimer?.version) return null;
  const { version, title, content } = data.disclaimer;
  return [
    'No account yet: your user must accept the DWLF disclaimer first. Show them the text below, word for word.',
    `If they say they accept, call dwlf_register_agent again with the same email, disclaimerAccepted: true and ` +
      `disclaimerVersion: "${version}". If they do not, stop: do not accept on their behalf.`,
    '',
    `--- ${title || 'DWLF disclaimer'} (version ${version}) ---`,
    String(content || ''),
  ].join('\n');
}

/** The 201/200 answer as text: the response, then what to do next. */
export function describeRegistration(data: unknown): string {
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const step = (obj.nextStep as NextStep | undefined) || {
    action: obj.apiKey
      ? 'Tell your user to keep the apiKey (it is shown once) and to click the activation link DWLF just emailed ' +
        'them. Until they do, calls return 403 ACCOUNT_NOT_ACTIVATED. Then set the key as this server\'s DWLF_API_KEY.'
      : 'Ask your user to click the activation link DWLF emailed them. No new key was made: use the one from the first registration.',
  };
  return `${JSON.stringify(data, null, 2)}\n\n${formatNextStep(step)}`;
}
