import { createHash, randomUUID } from 'node:crypto';
import type { HostedLimits } from './config.js';
import { accountHash, type HostedStore } from './store.js';
import type { Caller } from './auth.js';

/**
 * The MCP-level limits (DWLF-622; docs/HOSTED-MCP.md §5, §6). They sit IN FRONT of SPT's per-account plan limits
 * (DWLF-615/618), which stay the quota: these only absorb what SPT can't see coming, per (account, client):
 * - a `tools/call` ceiling per minute, per (account, client);
 * - a loop guard: the same tool with the same arguments more than N times a minute, per (account, client);
 * - a cap on calls in flight at once PER ACCOUNT, across all its clients and every Lambda instance (leases that lapse
 *   on their own), so registering more clients does not buy more concurrency (docs/HOSTED-MCP.md §5).
 * Every refusal is answered as a tool error that says which limit and when to retry: counted, never silent.
 *
 * If the table can't be reached the call is let through and the failure logged: SPT still enforces the plan, so
 * failing open costs at most a burst SPT will refuse, while failing closed would take the endpoint down with the table.
 */

export type Refusal = { kind: 'rate' | 'repeat' | 'in_flight'; message: string; retryAfterSeconds: number };
export type Admission = { ok: true; release: () => Promise<void> } | { ok: false; refusal: Refusal };

/** JSON with object keys sorted, so the same arguments in any key order hash the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export class CallLimiter {
  constructor(
    private readonly store: HostedStore,
    private readonly limits: HostedLimits,
    private readonly leaseMs: number,
    private readonly log: (entry: Record<string, unknown>) => void,
  ) {}

  async admit(caller: Caller, tool: string, args: unknown, now = Date.now()): Promise<Admission> {
    const account = accountHash(caller);
    const who = `${account}#${encodeURIComponent(caller.clientId)}`;
    const minute = Math.floor(now / 60000);
    const retryAfterSeconds = 60 - Math.floor((now % 60000) / 1000);
    try {
      // Both counters move on every attempt, refused ones too: a loop that keeps hitting the wall stays visible.
      const argsHash = createHash('sha256').update(`${tool}\n${canonicalJson(args ?? {})}`).digest('hex').slice(0, 32);
      const [calls, repeats] = await Promise.all([
        this.store.increment(`rate#${who}#${minute}`, 120),
        this.store.increment(`loop#${who}#${argsHash}#${minute}`, 120),
      ]);
      if (repeats > this.limits.repeatsPerMinute) {
        return { ok: false, refusal: {
          kind: 'repeat',
          retryAfterSeconds,
          message: `${tool} was called with the same arguments ${repeats} times this minute (the limit is ` +
            `${this.limits.repeatsPerMinute}). The answer will not change: use the result you already have, or change the arguments.`,
        } };
      }
      if (calls > this.limits.callsPerMinute) {
        return { ok: false, refusal: {
          kind: 'rate',
          retryAfterSeconds,
          message: `Too many tool calls: ${calls} this minute for this connection (the limit is ${this.limits.callsPerMinute}). ` +
            `Wait ${retryAfterSeconds} s, and batch work into fewer calls.`,
        } };
      }
      const holder = randomUUID();
      const slot = await this.store.acquireSlot(`slot#${account}`, this.limits.maxInFlight, holder, now + this.leaseMs, now);
      if (!slot) {
        return { ok: false, refusal: {
          kind: 'in_flight',
          retryAfterSeconds: Math.ceil(this.leaseMs / 1000),
          message: `${this.limits.maxInFlight} tool calls are already running for this account. Wait for one to finish, then retry.`,
        } };
      }
      return {
        ok: true,
        release: async () => {
          try {
            await this.store.releaseSlot(slot, holder);
          } catch (error) {
            this.log({ event: 'hosted-mcp-limit-release-failed', error: (error as Error).message }); // the lease lapses on its own
          }
        },
      };
    } catch (error) {
      this.log({ event: 'hosted-mcp-limits-unavailable', error: (error as Error).message });
      return { ok: true, release: async () => {} };
    }
  }
}
