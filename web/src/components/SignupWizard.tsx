import React, { useState, useEffect, useRef } from "react";
import {
  Button,
  FormGroup,
  InputGroup,
  H3,
  Intent,
  Callout,
  Tooltip,
  Position,
  Divider
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Copy } from "lucide-react";
import LogoIcon from "../assets/obex_cat_eye_logo-256.webp";
import { QRCodeCanvas } from "../views/AccountView/components/QRCodeCanvas";
import {
  validateUsername,
  validatePassword,
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
 * Properties for the SignupWizard component.
 */
interface SignupWizardProps {
  /** Authentication configuration containing site keys and toggles. */
  authConfig: AuthConfig | null;
  /** True if Turnstile library has loaded globally. */
  turnstileReady: boolean;
  /** Callback triggered on successful completion or skip of the registration flow. */
  onSuccess: () => void;
  /** Callback to toggle page mode back to login. */
  onToggleMode: () => void;
}

/**
 * SignupWizard component guides the user through registration:
 * - Step 1: Input & check username availability, solve Turnstile.
 * - Step 2: Input & validate password complexity, create account.
 * - Step 3: View QR code and confirm TOTP 2FA.
 * - Step 4: Show recovery keys.
 *
 * @param props - Component props containing authConfig, turnstileReady, and callbacks.
 * @returns React elements representing the registration steps and forms.
 */
export const SignupWizard: React.FC<SignupWizardProps> = ({
  authConfig,
  turnstileReady,
  onSuccess,
  onToggleMode
}) => {
  const [signupStep, setSignupStep] = useState<'username' | 'password' | 'totp' | 'recovery'>('username');

  // Input states
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpSetupToken, setTotpSetupToken] = useState("");

  // TOTP response states
  const [totpSetupData, setTotpSetupData] = useState<{ secret: string; uri: string } | null>(null);
  const [totpRecoveryKeys, setTotpRecoveryKeys] = useState<string[] | null>(null);

  // Status indicators
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);

  // Setup/verification loading indicators
  const [totpSetupLoading, setTotpSetupLoading] = useState(false);
  const [totpSetupError, setTotpSetupError] = useState("");

  // Turnstile state
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileStatus, setTurnstileStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const { t } = useTranslation();

  const isTurnstileEnabled = authConfig?.turnstile_enabled_signup;

  useEffect(() => {
    // Only render turnstile in Step 1 (username step)
    if (signupStep === 'username' && isTurnstileEnabled && authConfig?.turnstile_site_key && (turnstileReady || window.turnstile) && turnstileRef.current) {
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
  }, [isTurnstileEnabled, authConfig, signupStep, turnstileReady, t]);

  /**
   * Checks the availability of the username in real-time.
   *
   * @param uname - The username to query.
   */
  const checkUsernameDuplicate = async (uname: string) => {
    if (!uname || !validateUsername(uname)) return;
    try {
      const res = await fetch(`/api/auth/check-username?username=${encodeURIComponent(uname)}`);
      if (res.ok) {
        const data = await res.json() as any;
        if (data.exists) {
          setError(t("auth.usernameExists"));
        } else {
          setError(prev => prev === t("auth.usernameExists") ? "" : prev);
        }
      }
    } catch (e) {
      console.error("Failed to check username duplicate", e);
    }
  };

  /**
   * Submits the username in the signup flow and verifies availability.
   *
   * @param e - React form submit event.
   */
  const handleSignupUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateUsername(username)) { setError(t("auth.formatTipUsername")); return; }
    if (isTurnstileEnabled && authConfig?.turnstile_site_key && !turnstileToken) { setError(t("auth.turnstileRequired")); return; }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/auth/check-username?username=${encodeURIComponent(username)}`);
      if (res.ok) {
        const data = await res.json() as any;
        if (data.exists) {
          setError(t("auth.usernameExists"));
        } else {
          setSignupStep('password');
        }
      } else {
        setError(t("auth.authFailed"));
      }
    } catch (err) {
      setError(t("auth.networkError"));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Initiates the TOTP configuration setup wizard by fetching configuration details from the backend.
   */
  const startSignupTotpSetup = async () => {
    setTotpSetupLoading(true);
    setTotpSetupError("");
    try {
      const res = await fetch("/api/account/totp/setup");
      if (res.ok) {
        setTotpSetupData(await res.json());
        setSignupStep('totp');
      } else {
        console.error("Failed to start signup TOTP setup:", await res.text());
        onSuccess();
      }
    } catch (e) {
      console.error("Network error during signup TOTP setup:", e);
      onSuccess();
    } finally {
      setTotpSetupLoading(false);
    }
  };

  /**
   * Submits the user's TOTP token code to activate 2FA and get recovery keys.
   *
   * @param e - React form submit event.
   */
  const handleSignupTotpConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpSetupData) return;
    setTotpSetupLoading(true);
    setTotpSetupError("");
    try {
      const rawToken = totpSetupToken.replace(/\s/g, "");
      const salt = crypto.randomUUID();
      const hashHex = await hashTotpToken(rawToken, salt);

      const res = await fetch("/api/account/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: totpSetupData.secret,
          totpTokenHash: hashHex,
          salt: salt,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTotpRecoveryKeys(data.recovery_keys);
        setSignupStep('recovery');
      } else {
        setTotpSetupError(await res.text());
      }
    } catch {
      setTotpSetupError(t("common.errorNetwork"));
    } finally {
      setTotpSetupLoading(false);
    }
  };

  /**
   * Copies the newly generated recovery keys to the clipboard.
   */
  const handleCopySignupRecoveryKeys = () => {
    if (!totpRecoveryKeys) return;
    navigator.clipboard.writeText(totpRecoveryKeys.join("\n")).then(() => {
      setCopiedRecovery(true);
      setTimeout(() => setCopiedRecovery(false), 2000);
    });
  };

  /**
   * Submits the final registration (signup) payload with username, password, and turnstile verification.
   *
   * @param e - React form submit event.
   */
  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateUsername(username)) { setError(t("auth.formatTipUsername")); return; }
    if (!validatePassword(password)) { setError(t("auth.formatTipPassword")); return; }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, turnstileToken }),
      });

      if (res.ok) {
        await startSignupTotpSetup();
      } else {
        const msg = await res.text();
        if (isPasswordLeaked(res, msg)) {
          setError(t("auth.passwordLeaked"));
        } else if (msg === "username_exists") {
          setError(t("auth.usernameExists"));
        } else {
          setError(msg || t("auth.authFailed"));
        }
        if (window.turnstile) window.turnstile.reset();
        setTurnstileToken(null);
      }
    } catch (err) { setError(t("auth.networkError")); } finally { setLoading(false); }
  };

  /**
   * Renders the clear button in the password field.
   *
   * @returns React element or undefined.
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
        {signupStep === 'password' && (
          <button 
            onClick={() => { setSignupStep('username'); setError(""); }} 
            className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 bg-transparent border-none cursor-pointer"
            title="Back to username"
          >
            <ArrowLeft size={24} />
          </button>
        )}
        <img src={LogoIcon} alt="Obex DNS Logo" className="w-20 h-20 object-contain" />
        <H3 className="font-bold tracking-tight text-2xl mt-4">
          {signupStep === 'username' || signupStep === 'password'
            ? t("auth.signup") 
            : (signupStep === 'totp' 
                ? t("account.totp.title", "Two-Factor Authentication (2FA)") 
                : t("account.totp.recoveryKeysTitle", "Save Recovery Keys")
              )
          }
        </H3>
        <p className="text-gray-500 mt-2 text-center text-sm leading-relaxed">
          {signupStep === 'username' || signupStep === 'password'
            ? (signupStep === 'password' ? username : t("auth.protectInternet"))
            : (signupStep === 'totp' 
                ? t("account.totp.setupDesc", "Add an extra layer of security.") 
                : t("account.totp.recoveryKeysWarning", "Store keys safely.")
              )
          }
        </p>
      </div>

      {error && <Callout intent={Intent.DANGER} className="mb-6 rounded-xl" title={t("auth.error")}>{error}</Callout>}

      {/* Signup Step 1 (Username) */}
      {signupStep === 'username' && (
        <form onSubmit={handleSignupUsernameSubmit} className="space-y-4">
          <FormGroup label={t("auth.username")} labelFor="username">
            <Tooltip
              content={t("auth.formatTipUsername")}
              isOpen={usernameFocused}
              position={Position.TOP}
              intent={Intent.PRIMARY}
              className="w-full"
            >
              <div className="w-full block">
                <InputGroup
                  id="username"
                  leftIcon="user"
                  placeholder={t("auth.usernamePlaceholder")}
                  size="large"
                  className="rounded-xl w-full"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setError(prev => prev === t("auth.usernameExists") ? "" : prev);
                  }}
                  onFocus={() => setUsernameFocused(true)}
                  onBlur={() => {
                    setUsernameFocused(false);
                    checkUsernameDuplicate(username);
                  }}
                  required
                />
              </div>
            </Tooltip>
          </FormGroup>

          {isTurnstileEnabled && authConfig?.turnstile_site_key && (
            <div className="py-2 flex justify-center min-h-16.25"><div ref={turnstileRef} /></div>
          )}

          <Button fill size="large" intent={Intent.PRIMARY} type="submit" loading={loading || turnstileStatus === 'verifying'} disabled={isTurnstileEnabled && !!authConfig?.turnstile_site_key && turnstileStatus !== 'success'} className="mt-6 font-bold py-6 rounded-xl shadow-lg shadow-blue-500/20">
            {turnstileStatus === 'verifying' ? t("auth.verifying") : t("auth.next", "Next")}
          </Button>
        </form>
      )}

      {/* Signup Step 2 (Password) */}
      {signupStep === 'password' && (
        <form onSubmit={handleSignupSubmit} className="space-y-4">
          <FormGroup label={t("auth.password")} labelFor="password">
            <Tooltip
              content={t("auth.formatTipPassword")}
              isOpen={passwordFocused}
              position={Position.TOP}
              intent={Intent.PRIMARY}
              className="w-full"
            >
              <div className="w-full block">
                <InputGroup
                  id="password"
                  leftIcon="lock"
                  placeholder={t("auth.passwordPlaceholder")}
                  type="password"
                  size="large"
                  className="rounded-xl w-full"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  rightElement={renderPasswordClearButton()}
                  required
                  autoFocus
                />
              </div>
            </Tooltip>
          </FormGroup>

          <Button fill size="large" intent={Intent.PRIMARY} type="submit" loading={loading} className="mt-6 font-bold py-6 rounded-xl shadow-lg shadow-blue-500/20">
            {t("auth.signupBtn")}
          </Button>
        </form>
      )}

      {/* Signup Step 3: TOTP Setup */}
      {signupStep === 'totp' && totpSetupData && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3">
            <QRCodeCanvas uri={totpSetupData.uri} />
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-1">
                {t("account.totp.orEnterManually", "Or enter the key manually:")}
              </p>
              <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded select-all">
                {totpSetupData.secret}
              </code>
            </div>
          </div>
          <Divider />
          {totpSetupError && <Callout intent={Intent.DANGER}>{totpSetupError}</Callout>}
          <form onSubmit={handleSignupTotpConfirm} className="space-y-3">
            <FormGroup
              label={t("account.totp.enterCode", "Enter the 6-digit code to confirm:")}
              helperText={t(
                "account.totp.enterCodeHint",
                "This verifies the key was scanned correctly."
              )}
            >
              <InputGroup
                id="totp-signup-setup-token"
                placeholder="000000"
                value={totpSetupToken}
                onChange={(e) =>
                  setTotpSetupToken(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                maxLength={6}
                inputMode="numeric"
                className="font-mono tracking-widest text-center"
                required
              />
            </FormGroup>
            <div className="flex gap-2 pt-2">
              <Button
                fill
                text={t("auth.skip", "Skip")}
                onClick={() => onSuccess()}
              />
              <Button
                fill
                intent={Intent.SUCCESS}
                type="submit"
                loading={totpSetupLoading}
                text={t("account.totp.activate", "Activate")}
                disabled={totpSetupToken.length < 6}
              />
            </div>
          </form>
        </div>
      )}

      {/* Signup Step 4: TOTP Recovery Keys */}
      {signupStep === 'recovery' && totpRecoveryKeys && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 mb-4">
            {totpRecoveryKeys.map((key, i) => (
              <code
                key={i}
                className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded text-center tracking-wider"
              >
                {key}
              </code>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              fill
              icon={<Copy size={14} />}
              text={
                copiedRecovery
                  ? t("account.totp.copied", "Copied!")
                  : t("account.totp.copyKeys", "Copy All Keys")
              }
              intent={copiedRecovery ? Intent.SUCCESS : Intent.NONE}
              onClick={handleCopySignupRecoveryKeys}
            />
            <Button
              fill
              intent={Intent.PRIMARY}
              text={t("account.totp.done", "Done")}
              onClick={() => onSuccess()}
            />
          </div>
        </div>
      )}

      {signupStep === 'username' && (
        <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800 text-center">
          <button onClick={onToggleMode} className="text-blue-600 dark:text-blue-400 font-semibold hover:underline bg-transparent border-none cursor-pointer text-sm">
            {t("auth.haveAccount")}
          </button>
        </div>
      )}
    </>
  );
};
