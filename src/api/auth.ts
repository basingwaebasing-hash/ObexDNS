import { Env } from "../types";
import {
  generateId,
  createSession, createSessionCookie,
  readSessionCookie, invalidateSession, createBlankSessionCookie,
  createPendingTOTPSession, createPendingTOTPCookie,
  validatePendingTOTPSession, invalidatePendingTOTPSession, clearPendingTOTPCookie,
  readPendingTOTPCookie,
} from "../lib/auth";
import { hashPassword, verifyPassword } from "../utils/crypto";
import { verifyTOTP, findMatchingRecoveryKey } from "../lib/totp";
import { UserModel } from "../models/user";
import { ActivityLogModel } from "../models/activityLog";
import { cacheUtils } from "../utils/cache";

async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
  if (!token || !secret) return false;
  try {
    const formData = new FormData();
    formData.append('secret', secret);
    formData.append('response', token);
    formData.append('remoteip', ip);
    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { body: formData, method: 'POST' });
    const outcome = await result.json() as any;
    return outcome.success;
  } catch (e) { return false; }
}

async function getSystemSetting(db: any, key: string): Promise<string> {
  const res = await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(key).first();
  return res ? res.value : "";
}

export async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userModel = new UserModel(env.DB);
  const activityLog = new ActivityLogModel(env.DB);
  const cache = (caches as any).default;
  const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const userAgent = request.headers.get("User-Agent");

  // 公开配置接口 (用于前端展示验证码)
  if (url.pathname === '/api/auth/config' && request.method === 'GET') {
    const [siteKey, signupEnabled, loginEnabled] = await Promise.all([
      getSystemSetting(env.DB, 'turnstile_site_key'),
      getSystemSetting(env.DB, 'turnstile_enabled_signup'),
      getSystemSetting(env.DB, 'turnstile_enabled_login')
    ]);
    return new Response(JSON.stringify({
      turnstile_site_key: siteKey,
      turnstile_enabled_signup: signupEnabled === 'true',
      turnstile_enabled_login: loginEnabled === 'true'
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // 注册接口
  if (url.pathname === '/api/auth/signup' && request.method === 'POST') {
    if (await cacheUtils.isRateLimited(cache, `signup:${clientIp}`, 5, 3600)) {
      return new Response("Too many attempts", { status: 429 });
    }

    const { username, password, turnstileToken } = await request.json() as any;

    const [secretKey, enabled] = await Promise.all([
      getSystemSetting(env.DB, 'turnstile_secret_key'),
      getSystemSetting(env.DB, 'turnstile_enabled_signup')
    ]);
    if (enabled === 'true' && secretKey) {
      if (!await verifyTurnstile(turnstileToken, secretKey, clientIp)) {
        return new Response("Verification failed", { status: 400 });
      }
    }

    if (!/^[a-zA-Z0-9]{5,15}$/.test(username)) return new Response("Invalid username", { status: 400 });
    const hashedPassword = await hashPassword(password);
    const userId = generateId(15);

    try {
      const role = (await userModel.isEmpty()) ? 'admin' : 'user';
      await userModel.create({ id: userId, username, passwordHash: hashedPassword, role });
      const session = await createSession(env.DB, userId);
      const sessionCookie = createSessionCookie(session.id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Set-Cookie": sessionCookie, "Content-Type": "application/json" }
      });
    } catch (e: any) { return new Response(e.message, { status: 400 }); }
  }

  // 登录接口 (第一步：验证密码 / skip_password 模式)
  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    if (await cacheUtils.isRateLimited(cache, `login_fail:${clientIp}`, 5, 900)) {
      return new Response("Too many login attempts", { status: 429 });
    }

    const { username, password, turnstileToken } = await request.json() as any;

    // 校验 Turnstile
    const [secretKey, enabled] = await Promise.all([
      getSystemSetting(env.DB, 'turnstile_secret_key'),
      getSystemSetting(env.DB, 'turnstile_enabled_login')
    ]);
    if (enabled === 'true' && secretKey) {
      if (!await verifyTurnstile(turnstileToken, secretKey, clientIp)) {
        return new Response("Verification failed", { status: 400 });
      }
    }

    const user = await userModel.getByUsername(username);
    if (!user) {
      await cacheUtils.isRateLimited(cache, `login_fail:${clientIp}`, 100, 900);
      // Use a fixed-time fake verify to avoid timing-based username enumeration
      await verifyPassword('dummy', '$2a$10$fakehashfakehashfakehashfake');
      await activityLog.record('__unknown__', 'login_fail', clientIp, userAgent, { username });
      return new Response("Invalid credentials", { status: 400 });
    }

    // If skip_password is NOT enabled, verify the password
    if (!user.totp_skip_password) {
      const passwordValid = await verifyPassword(password, user.hashed_password);
      if (!passwordValid) {
        await cacheUtils.isRateLimited(cache, `login_fail:${clientIp}`, 100, 900);
        await activityLog.record(user.id, 'login_fail', clientIp, userAgent, { reason: 'wrong_password' });
        return new Response("Invalid credentials", { status: 400 });
      }
    }

    // Password OK (or skipped) — check if TOTP is enabled
    if (user.totp_enabled) {
      // Issue short-lived pending session for TOTP step
      const pendingToken = await createPendingTOTPSession(env.DB, user.id);
      const pendingCookie = createPendingTOTPCookie(pendingToken);
      return new Response(JSON.stringify({ success: false, requires_totp: true }), {
        headers: {
          "Set-Cookie": pendingCookie,
          "Content-Type": "application/json"
        }
      });
    }

    // No TOTP — issue session directly
    await cacheUtils.delete(cache, `ratelimit:login_fail:${clientIp}`);
    await activityLog.record(user.id, 'login_success', clientIp, userAgent);
    const session = await createSession(env.DB, user.id);
    const sessionCookie = createSessionCookie(session.id);
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Set-Cookie": sessionCookie, "Content-Type": "application/json" }
    });
  }

  // TOTP 验证接口 (第二步：验证 TOTP 码)
  if (url.pathname === '/api/auth/totp/verify' && request.method === 'POST') {
    const pendingToken = readPendingTOTPCookie(request.headers.get("Cookie"));
    if (!pendingToken) return new Response("No pending session", { status: 400 });

    const userId = await validatePendingTOTPSession(env.DB, pendingToken);
    if (!userId) return new Response("Session expired, please login again", { status: 401 });

    const { token } = await request.json() as { token: string };
    const user = await userModel.getById(userId);
    if (!user?.totp_secret) {
      await invalidatePendingTOTPSession(env.DB, pendingToken);
      return new Response("TOTP not configured", { status: 400 });
    }

    const isValid = await verifyTOTP(user.totp_secret, token);
    if (!isValid) {
      await activityLog.record(userId, 'totp_verify_fail', clientIp, userAgent);
      return new Response("Invalid TOTP code", { status: 400 });
    }

    // TOTP verified — issue real session, clear pending session
    await invalidatePendingTOTPSession(env.DB, pendingToken);
    await cacheUtils.delete(cache, `ratelimit:login_fail:${clientIp}`);
    await activityLog.record(userId, 'totp_verify_success', clientIp, userAgent);
    await activityLog.record(userId, 'login_success', clientIp, userAgent);

    const session = await createSession(env.DB, userId);
    const headers = new Headers({
      "Content-Type": "application/json"
    });
    headers.append("Set-Cookie", createSessionCookie(session.id));
    headers.append("Set-Cookie", clearPendingTOTPCookie());
    return new Response(JSON.stringify({ success: true }), { headers });
  }

  // 使用恢复密钥登录接口
  if (url.pathname === '/api/auth/totp/recover' && request.method === 'POST') {
    const pendingToken = readPendingTOTPCookie(request.headers.get("Cookie"));
    if (!pendingToken) return new Response("No pending session", { status: 400 });

    const userId = await validatePendingTOTPSession(env.DB, pendingToken);
    if (!userId) return new Response("Session expired, please login again", { status: 401 });

    const { recoveryKey } = await request.json() as { recoveryKey: string };
    const user = await userModel.getById(userId);
    if (!user?.totp_recovery_keys) {
      await invalidatePendingTOTPSession(env.DB, pendingToken);
      return new Response("No recovery keys found", { status: 400 });
    }

    let storedHashes: string[] = [];
    try { storedHashes = JSON.parse(user.totp_recovery_keys); } catch { /* malformed */ }

    const matchIndex = await findMatchingRecoveryKey(recoveryKey, storedHashes);
    if (matchIndex === -1) {
      await activityLog.record(userId, 'totp_verify_fail', clientIp, userAgent, { method: 'recovery_key' });
      return new Response("Invalid recovery key", { status: 400 });
    }

    // Consume the used recovery key (one-time use)
    await userModel.consumeRecoveryKey(userId, matchIndex, storedHashes);
    await invalidatePendingTOTPSession(env.DB, pendingToken);
    await activityLog.record(userId, 'recovery_key_used', clientIp, userAgent, {
      remaining: storedHashes.length - 1
    });
    await activityLog.record(userId, 'login_success', clientIp, userAgent);

    const session = await createSession(env.DB, userId);
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", createSessionCookie(session.id));
    headers.append("Set-Cookie", clearPendingTOTPCookie());
    return new Response(JSON.stringify({ success: true }), { headers });
  }

  // 登出接口
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const sessionId = readSessionCookie(request.headers.get("Cookie"));
    if (sessionId) {
      // Get user id before invalidating for activity log
      const session = await env.DB.prepare("SELECT user_id FROM sessions WHERE id = ?").bind(sessionId).first<{ user_id: string }>();
      await invalidateSession(env.DB, sessionId);
      if (session?.user_id) {
        await activityLog.record(session.user_id, 'logout', clientIp, userAgent);
      }
    }
    const blankCookie = createBlankSessionCookie();
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Set-Cookie": blankCookie, "Content-Type": "application/json" }
    });
  }

  return new Response("Not Found", { status: 404 });
}
