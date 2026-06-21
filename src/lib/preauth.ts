import { Env } from '../types';
import { SessionModel } from '../models/session';
import { generateId } from '../utils/crypto';
import { SESSION_ID_LENGTH } from './session';

import { cacheUtils } from '../utils/cache';

/**
 * Creates a short-lived pre-auth session after Step 1 (username + Turnstile).
 * @returns The pre-auth session token string
 */
export async function createPreauthSession(env: Env, userId: string): Promise<string> {
  const token = generateId(SESSION_ID_LENGTH);
  const preauthTtl = Number(env.PREAUTH_TTL_SECONDS) || 300;
  const expiresAt = Math.floor(Date.now() / 1000) + preauthTtl;
  const sessionModel = new SessionModel(env.DB);
  await sessionModel.createPendingTotpSession(token, userId, expiresAt);
  return token;
}

/**
 * Validates a pre-auth token and returns the associated userId, or null if invalid/expired.
 * Does NOT delete the session — call invalidatePreauthSession after successful verification.
 */
export async function validatePreauthSession(env: Env, token: string): Promise<string | null> {
  const sessionModel = new SessionModel(env.DB);
  const row = await sessionModel.getPendingTotpSession(token);

  if (!row) return null;
  if (Math.floor(Date.now() / 1000) >= row.expires_at) {
    await sessionModel.deletePendingTotpSession(token);
    return null;
  }
  return row.user_id;
}

/**
 * Deletes a pre-auth session after it has been used (successfully or failed terminally).
 */
export async function invalidatePreauthSession(env: Env, token: string): Promise<void> {
  const sessionModel = new SessionModel(env.DB);
  await sessionModel.deletePendingTotpSession(token);
}

/**
 * Increments failed attempts for a pre-auth session. If it reaches 3 attempts, deletes it.
 * Returns the number of attempts remaining (from 3 down to 0).
 */
export async function recordFailedPreauthAttempt(cache: Cache, token: string, env: Env): Promise<number> {
  const cacheKey = `preauth_fail:${token}`;
  const preauthTtl = Number(env.PREAUTH_TTL_SECONDS) || 300;
  
  const current = await cacheUtils.get<{ count: number }>(cache, cacheKey);
  const count = (current?.count || 0) + 1;
  
  if (count >= 3) {
    const sessionModel = new SessionModel(env.DB);
    await sessionModel.deletePendingTotpSession(token);
    await cacheUtils.delete(cache, cacheKey);
    return 0;
  }
  
  await cacheUtils.set(cache, cacheKey, { count }, preauthTtl);
  return 3 - count;
}
