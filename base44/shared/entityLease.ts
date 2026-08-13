type EntityClient = {
  get: (id: string) => Promise<Record<string, unknown>>;
  updateMany: (
    query: Record<string, unknown>,
    update: Record<string, unknown>,
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
  release: () => Promise<void>;
};

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
        return {
          token,
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
  operation: () => Promise<T>,
): Promise<T> {
  const lease = await acquireEntityLease(options);
  try {
    return await operation();
  } finally {
    try {
      await lease.release();
    } catch (error) {
      console.error('Entity lease release failed; the lease will expire automatically.', error);
    }
  }
}
