import { validateRecoveryGrant } from './recoveryGrant.ts';

export type RecoveryAuthorization =
  | { authorized: true; mode: 'admin' | 'recovery_grant'; userId?: string }
  | { authorized: false; error: string };

export async function authorizeRecoveryRequest({
  base44,
  recoveryGrant,
  recoverySecret,
}: {
  base44: any;
  recoveryGrant: unknown;
  recoverySecret: string;
}): Promise<RecoveryAuthorization> {
  try {
    const user = await base44.auth.me();
    if (user?.role === 'admin') {
      return { authorized: true, mode: 'admin', userId: user.id };
    }
  } catch {
    // Public recovery users are expected not to have a Base44 session.
  }

  const grantResult = await validateRecoveryGrant(recoveryGrant, recoverySecret);
  if (grantResult.valid) return { authorized: true, mode: 'recovery_grant' };

  return { authorized: false, error: 'Administrator access or a valid recovery grant is required.' };
}

export function safeRecoveryLog(details: {
  functionName: string;
  authorizationMode: string;
  identifier?: string | null;
  deliveryStage: string;
  zapierStatus?: number | null;
}): void {
  console.info(JSON.stringify({
    functionName: details.functionName,
    authorizationMode: details.authorizationMode,
    identifier: details.identifier || null,
    deliveryStage: details.deliveryStage,
    zapierStatus: details.zapierStatus ?? null,
  }));
}
