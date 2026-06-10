import React, { useState, useEffect, useRef } from "react";
import {
  Button,
  FormGroup,
  InputGroup,
  H3,
  Intent,
  Callout
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import LogoIcon from "../assets/obex_cat_eye_logo-256.webp";
import {
  validateUsername,
  isPasswordLeaked,
  hashTotpToken
} from "../utils/auth";

/**
 * Authentication configuration settings fetched from server.
 */
interface AuthConfig {
  turnstile_site_key: string;
  turnstile_enabled_signup: boolean;
  turnstile_enabled_login: boolean;
}

/**
 * Properties for the LoginForm component.
 */
interface LoginFormProps {
  /** Authentication configuration containing site keys and toggles. */
  authConfig: AuthConfig | null;
  /** True if Turnstile library has loaded globally. */
  turnstileReady: boolean;
  /** Callback triggered on successful authentication. */
  onSuccess: () => void;
  /** Callback to toggle page mode to registration (signup). */
  onToggleMode: () => void;
}

/**
 * LoginForm component processes login step 1 (username verification) and step 2 (password & TOTP challenge).
 *
 * @param props - Component props containing authConfig, turnstileReady, and callbacks.
 * @returns React elements representing the login state machine and forms.
 */
export const LoginForm: React.FC<LoginFormProps> = ({
  authConfig,
  turnstileReady,
  onSuccess,
  onToggleMode
}) => {
  const [loginStep, setLoginStep] = useState<1 | 2>(1);

  // Input states
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");

  // Server response step requirements
  const [requiresPassword, setRequiresPassword] = useState(true);
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);

  // Status indicators
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Turnstile state
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileStatus, setTurnstileStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const { t } = useTranslation();

  const isTurnstileEnabled = authConfig?.turnstile_enabled_login;

  useEffect(() => {
    // Only render turnstile in Step 1
    if (loginStep === 1 && isTurnstileEnabled && authConfig?.turnstile_site_key && (turnstileReady || window.turnstile) && turnstileRef.current) {
      try {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
        setTurnstileStatus('verifying');
        turnstileRef.current.innerHTML = "";
        const widgetId = window.turnstile.render(turnstileRef.current, {
          sitekey: authConfig.turnstile_site_key,
          callback: (token: string) => { setTurnstileToken(token); setTurnstileStatus('success'); setError(""); },
          "expired-callback": () => { setTurnstileToken(null); setTurnstileStatus('idle'); },
          "error-callback": (err: any) => {
            console.error("Turnstile error:", err);
            setTurnstileStatus('error');
            setError(t("auth.turnstileError", "Verification service failed to load. Please reload and try again."));
            setTurnstileToken(null);
          },
        });
        widgetIdRef.current = widgetId;
      } catch (e) {
        console.error("Turnstile render error:", e);
        setTurnstileStatus('error');
      }
    }
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [isTurnstileEnabled, authConfig, loginStep, turnstileReady, t]);

  /**
   * Handles step 1 login form submission.
   * Sends the username and Turnstile token to `/api/auth/prelogin` to fetch next required steps.
   *
   * @param e - React form submit event.
   */
  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateUsername(username)) { setError(t("auth.formatTipUsername")); return; }
    if (isTurnstileEnabled && authConfig?.turnstile_site_key && !turnstileToken) { setError(t("auth.turnstileRequired")); return; }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/prelogin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, turnstileToken }),
      });

      if (res.ok) {
        const data = await res.json();
        setRequiresPassword(data.requires_password);
        setRequiresTotp(data.requires_totp);
        setLoginStep(2);
      } else {
        const msg = await res.text();
        setError(msg || t("auth.authFailed"));
        if (window.turnstile) window.turnstile.reset();
        setTurnstileToken(null);
      }
    } catch (err) { setError(t("auth.networkError")); } finally { setLoading(false); }
  };

  /**
   * Handles step 2 login form submission.
   * Sends credentials and optionally TOTP hashes/recovery keys to `/api/auth/login`.
   *
   * @param e - React form submit event.
   */
  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const body: any = {};
      if (requiresPassword) body.password = password;
      if (requiresTotp) {
        if (useRecovery) {
          body.recoveryKey = recoveryKey;
        } else {
          const salt = crypto.randomUUID();
          const hashHex = await hashTotpToken(totpToken, salt);
          body.totpTokenHash = hashHex;
          body.totpSalt = salt;
        }
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onSuccess();
      } else {
        const msg = await res.text();
        if (isPasswordLeaked(res, msg)) {
          setError(t("auth.passwordLeaked"));
        } else {
          setError(msg || t("auth.authFailed"));
        }
      }
    } catch (err) { setError(t("auth.networkError")); } finally { setLoading(false); }
  };

  /**
   * Resets the login wizard back to Step 1.
   */
  const resetToStep1 = () => {
    setLoginStep(1);
    setPassword("");
    setTotpToken("");
    setRecoveryKey("");
    setError("");
    setTurnstileToken(null);
    setUseRecovery(false);
  };

  /**
   * Renders the cross/delete button inside input fields.
   *
   * @returns React element button or undefined.
   */
  const renderPasswordClearButton = () => {
    if (!password) return undefined;
    return (
      <Button
        minimal={true}
        icon="cross"
        onClick={() => setPassword("")}
      />
    );
  };

  return (
    <>
      <div className="flex flex-col items-center mb-8 relative">
        {loginStep === 2 && (
          <button 
            onClick={resetToStep1} 
            className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 bg-transparent border-none cursor-pointer"
            title="Back to username"
          >
            <ArrowLeft size={24} />
          </button>
        )}
        <img src={LogoIcon} alt="Obex DNS Logo" className="w-20 h-20 object-contain" />
        <H3 className="font-bold tracking-tight text-2xl mt-4">
          {loginStep === 2 ? t("auth.authRequired", "Authentication Required") : t("auth.login")}
        </H3>
        <p className="text-gray-500 mt-2 text-center text-sm leading-relaxed">
          {loginStep === 2 ? username : t("auth.welcomeBack")}
        </p>
      </div>

      {error && <Callout intent={Intent.DANGER} className="mb-6 rounded-xl" title={t("auth.error")}>{error}</Callout>}

      {/* Login Step 1 */}
      {loginStep === 1 && (
        <form onSubmit={handleStep1Submit} className="space-y-4">
          <FormGroup label={t("auth.username")} labelFor="username">
            <InputGroup
              id="username"
              leftIcon="user"
              placeholder={t("auth.usernamePlaceholder")}
              size="large"
              className="rounded-xl w-full"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </FormGroup>

          {isTurnstileEnabled && authConfig?.turnstile_site_key && (
            <div className="py-2 flex justify-center min-h-16.25"><div ref={turnstileRef} /></div>
          )}

          <Button fill size="large" intent={Intent.PRIMARY} type="submit" loading={loading || turnstileStatus === 'verifying'} disabled={isTurnstileEnabled && !!authConfig?.turnstile_site_key && turnstileStatus !== 'success'} className="mt-6 font-bold py-6 rounded-xl shadow-lg shadow-blue-500/20">
            {turnstileStatus === 'verifying' ? t("auth.verifying") : t("auth.next", "Next")}
          </Button>
        </form>
      )}

      {/* Login Step 2 */}
      {loginStep === 2 && (
        <form onSubmit={handleStep2Submit} className="space-y-4">
          {requiresPassword && (
            <FormGroup label={t("auth.password")} labelFor="password">
              <InputGroup
                id="password"
                leftIcon="lock"
                placeholder={t("auth.passwordPlaceholder")}
                type="password"
                size="large"
                className="rounded-xl"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                rightElement={renderPasswordClearButton()}
                autoFocus
                required
              />
            </FormGroup>
          )}

          {requiresTotp && (
            <>
              {useRecovery ? (
                <FormGroup label={t("account.totp.recoveryKeysTitle", "Recovery Key")}>
                  <InputGroup
                    id="recovery-key"
                    leftIcon="key"
                    placeholder="XXXXXXXXXX"
                    size="large"
                    className="rounded-xl font-mono tracking-widest"
                    value={recoveryKey}
                    onChange={(e) => setRecoveryKey(e.target.value)}
                    required
                    autoFocus={!requiresPassword}
                  />
                </FormGroup>
              ) : (
                <FormGroup label={requiresPassword ? t("account.totp.title", "Two-Factor Verification (TOTP)") : t("auth.totpVerification", "TOTP Verification")}>
                  <InputGroup
                    id="totp-code"
                    leftIcon="shield"
                    placeholder="000000"
                    size="large"
                    className="rounded-xl font-mono tracking-widest text-center"
                    value={totpToken}
                    onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    maxLength={6}
                    inputMode="numeric"
                    required
                    autoFocus={!requiresPassword}
                  />
                </FormGroup>
              )}

              <div className="text-right mt-1">
                <button
                  type="button"
                  onClick={() => { setUseRecovery(!useRecovery); setError(""); }}
                  className="text-blue-600 dark:text-blue-400 text-xs hover:underline bg-transparent border-none cursor-pointer p-0"
                >
                  {useRecovery ? t("auth.totpUseApp", "Use Authenticator App") : t("auth.totpUseRecovery", "Use Recovery Key")}
                </button>
              </div>
            </>
          )}

          <Button fill size="large" intent={Intent.PRIMARY} type="submit" loading={loading} className="mt-6 font-bold py-6 rounded-xl shadow-lg shadow-blue-500/20">
            {t("auth.loginBtn")}
          </Button>
        </form>
      )}

      {loginStep === 1 && (
        <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800 text-center">
          <button onClick={onToggleMode} className="text-blue-600 dark:text-blue-400 font-semibold hover:underline bg-transparent border-none cursor-pointer text-sm">
            {t("auth.noAccount")}
          </button>
        </div>
      )}
    </>
  );
};
