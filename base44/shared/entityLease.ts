type EntityClient = {
  get: (id: string) => Promise<Record<string, unknown>>;
  updateMany: (
    query: Record<string, unknown>,
    update: Record<string, Record<string, any>>,
  ) => Promise<unknown>;
};

type LeaseOptions = {
  entity: EntityClient;
  entityId: string;
  purpose: string;
  leaseDurationMs?: number;
  waitTimeoutMs?: number;
  retryDelayMs?: number;
};

export type EntityLease = {
  token: string;
  assertOwned: () => Promise<void>;
  renew: () => Promise<void>;
  update: (values: Record<string, unknown>) => Promise<Record<string, unknown>>;
  release: () => Promise<void>;
};

function lostLease(): Error {
  return Object.assign(new Error('The questionnaire persistence lease expired or changed. Reload the saved draft before retrying.'), { code: 'DRAFT_LEASE_LOST', status: 409 });
}

function equalStoredValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equalStoredValue(value, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  return Object.keys(leftRecord).length === Object.keys(rightRecord).length && Object.keys(leftRecord).every((key) => Object.hasOwn(rightRecord, key) && equalStoredValue(leftRecord[key], rightRecord[key]));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function leaseExpiry(record: Record<string, unknown>): number {
  const parsed = Date.parse(String(record.idempotency_lock_expires_at || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function newLeaseToken(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Acquires a cross-instance compare-and-set lease on an existing entity record.
 * Base44 updateMany forwards MongoDB update operators, so matching the observed
 * token makes the lock acquisition atomic even when function instances race.
 */
export async function acquireEntityLease({
  entity,
  entityId,
  purpose,
  leaseDurationMs = 20_000,
  waitTimeoutMs = 10_000,
  retryDelayMs = 50,
}: LeaseOptions): Promise<EntityLease> {
  if (!entityId) throw new Error('A lease entity ID is required.');

  const deadline = Date.now() + waitTimeoutMs;
  const token = newLeaseToken();

  while (Date.now() < deadline) {
    const observed = await entity.get(entityId);
    const rawObservedToken = observed.idempotency_lock_token;
    const observedToken = String(rawObservedToken || '');
    const isHeld = observedToken.length > 0 && leaseExpiry(observed) > Date.now();

    if (!isHeld) {
      const expiresAt = new Date(Date.now() + leaseDurationMs).toISOString();
      await entity.updateMany(
        {
          id: entityId,
          // MongoDB equality with null also matches a field that does not yet
          // exist, which is required for drafts created before lease fields
          // were added to the entity schema.
          idempotency_lock_token: rawObservedToken == null ? null : observedToken,
          idempotency_lock_expires_at: observed.idempotency_lock_expires_at ?? null,
        },
        {
          $set: {
            idempotency_lock_token: token,
            idempotency_lock_key: purpose.slice(0, 500),
            idempotency_lock_expires_at: expiresAt,
          },
        },
      );

      const confirmed = await entity.get(entityId);
      if (confirmed.idempotency_lock_token === token) {
        let released = false;
        const assertOwned = async () => {
          const current = await entity.get(entityId);
          if (released || current.idempotency_lock_token !== token || leaseExpiry(current) <= Date.now()) throw lostLease();
        };
        return {
          token,
          assertOwned,
          renew: async () => {
            await assertOwned();
            const result = await entity.updateMany(
              { id: entityId, idempotency_lock_token: token, idempotency_lock_expires_at: { $gt: new Date().toISOString() } },
              { $set: { idempotency_lock_expires_at: new Date(Date.now() + leaseDurationMs).toISOString() } },
            );
            if (Number((result as Record<string, unknown>)?.updated) !== 1) throw lostLease();
          },
          update: async (values) => {
            await assertOwned();
            const result = await entity.updateMany(
              { id: entityId, idempotency_lock_token: token, idempotency_lock_expires_at: { $gt: new Date().toISOString() } },
              { $set: values },
            );
            if (Number((result as Record<string, unknown>)?.updated) !== 1) throw lostLease();
            const stored = await entity.get(entityId);
            if (!stored || stored.idempotency_lock_token !== token || !Object.entries(values).every(([key, value]) => equalStoredValue(stored[key], value))) {
              throw Object.assign(new Error('The saved questionnaire checkpoint could not be verified. Retry the retained mutation before leaving this page.'), { code: 'DRAFT_WRITE_UNVERIFIED', status: 409 });
            }
            return stored;
          },
          release: async () => {
            if (released) return;
            released = true;
            await entity.updateMany(
              { id: entityId, idempotency_lock_token: token },
              {
                $set: {
                  idempotency_lock_token: '',
                  idempotency_lock_key: '',
                  idempotency_lock_expires_at: new Date(0).toISOString(),
                },
              },
            );
          },
        };
      }
    }

    const jitter = Math.floor(Math.random() * retryDelayMs);
    await delay(retryDelayMs + jitter);
  }

  throw new Error(`Timed out waiting for ${purpose} lease.`);
}

export async function withEntityLease<T>(
  options: LeaseOptions,
  operation: (lease: EntityLease) => Promise<T>,
): Promise<T> {
  const lease = await acquireEntityLease(options);
  let renewalError: unknown = null;
  let pendingRenewal: Promise<void> = Promise.resolve();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(() => {
      pendingRenewal = lease.renew().catch((error) => { renewalError = error; }).then(() => { if (!stopped && !renewalError) schedule(); });
    }, Math.max(1, Math.floor((options.leaseDurationMs || 20_000) / 3)));
  };
  schedule();
  try {
    const result = await operation(lease);
    if (renewalError) throw renewalError;
    await lease.assertOwned();
    return result;
  } finally {
    stopped = true;
    clearTimeout(timer!);
    await pendingRenewal;
    try {
      await lease.release();
    } catch (error) {
      console.error('Entity lease release failed; the lease will expire automatically.', error);
    }
  }
}
