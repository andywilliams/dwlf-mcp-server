import { createHash } from 'node:crypto';
import {
  ConditionalCheckFailedException, DeleteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';

/**
 * The hosted MCP's one table (DWLF-622; docs/HOSTED-MCP.md §3): the managed-key records and the MCP-level limit
 * counters, told apart by the partition-key prefix. Single attribute key `pk`; TTL on `expiresAt` (seconds).
 * An account (issuer + sub) appears in a key only as a hash, and logs carry the same hash. The issuer is part of it:
 * a `sub` is unique only per issuer, and a move to another authorization server (BA-41) must start new records,
 * never reuse old ones. Records are never scanned: an account's connections are revoked at the source (the AS
 * revokes the managed keys), and each record then drops itself on SPT's 401, or at its TTL.
 */

export type Account = { issuer: string; sub: string };
export type CredentialId = Account & { clientId: string };

export type CredentialRecord = CredentialId & {
  keyId: string;
  /** The managed API key, KMS-encrypted with an encryption context naming this (sub, client). */
  ciphertext: Uint8Array;
  /** The scopes the key was minted with: always exactly the grant it was minted for. */
  scopes: readonly string[];
  /** Bumped on every replacement: the conditional write that makes concurrent re-mints safe. */
  version: number;
  updatedAt: number;
  /** When the managed key itself expires at SPT (epoch ms): the record's TTL. Past it, the record is treated as absent. */
  expiresAt: number;
};

export interface HostedStore {
  getCredential(id: CredentialId): Promise<CredentialRecord | null>;
  /** Writes `record` only if the stored version is `expectedVersion` (null = no record). False when another won. */
  putCredential(record: CredentialRecord, expectedVersion: number | null): Promise<boolean>;
  /** Deletes the record only if it still holds `keyId` (a newer key is never dropped by a stale failure). */
  deleteCredential(id: CredentialId, keyId: string): Promise<void>;
  /** Adds one to a counter that expires `ttlSeconds` after its first use; returns the new count. */
  increment(key: string, ttlSeconds: number): Promise<number>;
  /**
   * Takes one of `slots` leases under `prefix` for `holder` until `leaseUntil` (ms); a lapsed lease is free, so a
   * crashed request's slot comes back on its own. Returns the slot's key, or null when every slot is held.
   */
  acquireSlot(prefix: string, slots: number, holder: string, leaseUntil: number, now: number): Promise<string | null>;
  /** Frees a lease, only if `holder` still holds it. */
  releaseSlot(slotKey: string, holder: string): Promise<void>;
}

/** A short, stable, non-reversible handle for an account: what keys and logs carry instead of (issuer, sub). */
export const accountHash = ({ issuer, sub }: Account) =>
  createHash('sha256').update(`hosted-mcp\n${issuer}\n${sub}`).digest('hex').slice(0, 24);

export const credentialKey = (id: CredentialId) => `cred#${accountHash(id)}#${encodeURIComponent(id.clientId)}`;

/** In-process store: tests and a local run. Never the deployed one (a Lambda instance's memory is not shared). */
export class MemoryStore implements HostedStore {
  readonly credentials = new Map<string, CredentialRecord>();
  readonly counters = new Map<string, { count: number; expiresAt: number }>();
  readonly slots = new Map<string, { holder: string; leaseUntil: number }>();

  constructor(private readonly clock: () => number = Date.now) {}

  private live(id: CredentialId) {
    const record = this.credentials.get(credentialKey(id));
    return record && record.expiresAt > this.clock() ? record : null;
  }

  async getCredential(id: CredentialId) {
    return this.live(id);
  }

  async putCredential(record: CredentialRecord, expectedVersion: number | null) {
    // Check and set with no await between them: atomic, like DynamoDB's conditional write.
    const current = this.live(record);
    if ((current?.version ?? null) !== expectedVersion) return false;
    this.credentials.set(credentialKey(record), record);
    return true;
  }

  async deleteCredential(id: CredentialId, keyId: string) {
    if (this.credentials.get(credentialKey(id))?.keyId === keyId) this.credentials.delete(credentialKey(id));
  }

  async increment(key: string, ttlSeconds: number) {
    const now = this.clock();
    const current = this.counters.get(key);
    const next = current && current.expiresAt > now ? { ...current, count: current.count + 1 } : { count: 1, expiresAt: now + ttlSeconds * 1000 };
    this.counters.set(key, next);
    return next.count;
  }

  async acquireSlot(prefix: string, slots: number, holder: string, leaseUntil: number, now: number) {
    for (let i = 0; i < slots; i += 1) {
      const key = `${prefix}#${i}`;
      if ((this.slots.get(key)?.leaseUntil ?? 0) <= now) {
        this.slots.set(key, { holder, leaseUntil });
        return key;
      }
    }
    return null;
  }

  async releaseSlot(slotKey: string, holder: string) {
    if (this.slots.get(slotKey)?.holder === holder) this.slots.delete(slotKey);
  }
}

const isConditionFailure = (error: unknown) =>
  error instanceof ConditionalCheckFailedException || (error as { name?: string })?.name === 'ConditionalCheckFailedException';

export class DynamoStore implements HostedStore {
  constructor(private readonly table: string, private readonly db: DynamoDBClient = new DynamoDBClient({})) {}

  async getCredential(id: CredentialId): Promise<CredentialRecord | null> {
    const { Item } = await this.db.send(new GetItemCommand({ TableName: this.table, Key: { pk: { S: credentialKey(id) } }, ConsistentRead: true }));
    if (!Item?.ciphertext?.B || !Item.keyId?.S || !Item.version?.N) return null;
    // TTL deletion is lazy (up to days late): an expired record is absent whether or not DynamoDB has removed it yet.
    const expiresAt = Number(Item.expiresAt?.N ?? 0) * 1000;
    if (expiresAt <= Date.now()) return null;
    return {
      ...id,
      expiresAt,
      keyId: Item.keyId.S,
      ciphertext: Item.ciphertext.B,
      scopes: Item.scopes?.L?.map((s) => s.S ?? '').filter(Boolean) ?? [],
      version: Number(Item.version.N),
      updatedAt: Number(Item.updatedAt?.N ?? 0),
    };
  }

  async putCredential(record: CredentialRecord, expectedVersion: number | null) {
    try {
      await this.db.send(new PutItemCommand({
        TableName: this.table,
        Item: {
          pk: { S: credentialKey(record) },
          kind: { S: 'credential' },
          clientId: { S: record.clientId },
          keyId: { S: record.keyId },
          ciphertext: { B: record.ciphertext },
          scopes: { L: record.scopes.map((s) => ({ S: s })) },
          version: { N: String(record.version) },
          updatedAt: { N: String(record.updatedAt) },
          expiresAt: { N: String(Math.ceil(record.expiresAt / 1000)) },
        },
        // "No record" includes an expired one TTL hasn't removed yet (getCredential reports it as absent).
        ...(expectedVersion === null
          ? { ConditionExpression: 'attribute_not_exists(pk) OR expiresAt <= :now', ExpressionAttributeValues: { ':now': { N: String(Math.floor(Date.now() / 1000)) } } }
          : { ConditionExpression: 'version = :v', ExpressionAttributeValues: { ':v': { N: String(expectedVersion) } } }),
      }));
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  async deleteCredential(id: CredentialId, keyId: string) {
    try {
      await this.db.send(new DeleteItemCommand({
        TableName: this.table,
        Key: { pk: { S: credentialKey(id) } },
        ConditionExpression: 'keyId = :k',
        ExpressionAttributeValues: { ':k': { S: keyId } },
      }));
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
  }

  async increment(key: string, ttlSeconds: number) {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const { Attributes } = await this.db.send(new UpdateItemCommand({
      TableName: this.table,
      Key: { pk: { S: key } },
      UpdateExpression: 'ADD #c :one SET expiresAt = if_not_exists(expiresAt, :exp)',
      ExpressionAttributeNames: { '#c': 'count' },
      ExpressionAttributeValues: { ':one': { N: '1' }, ':exp': { N: String(expiresAt) } },
      ReturnValues: 'UPDATED_NEW',
    }));
    return Number(Attributes?.count?.N ?? 1);
  }

  async acquireSlot(prefix: string, slots: number, holder: string, leaseUntil: number, now: number) {
    for (let i = 0; i < slots; i += 1) {
      const key = `${prefix}#${i}`;
      try {
        await this.db.send(new PutItemCommand({
          TableName: this.table,
          Item: {
            pk: { S: key },
            holder: { S: holder },
            leaseUntil: { N: String(leaseUntil) },
            expiresAt: { N: String(Math.ceil(leaseUntil / 1000) + 3600) },
          },
          ConditionExpression: 'attribute_not_exists(pk) OR leaseUntil <= :now',
          ExpressionAttributeValues: { ':now': { N: String(now) } },
        }));
        return key;
      } catch (error) {
        if (!isConditionFailure(error)) throw error;
      }
    }
    return null;
  }

  async releaseSlot(slotKey: string, holder: string) {
    try {
      await this.db.send(new DeleteItemCommand({
        TableName: this.table,
        Key: { pk: { S: slotKey } },
        ConditionExpression: 'holder = :h',
        ExpressionAttributeValues: { ':h': { S: holder } },
      }));
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
  }
}
