import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Elevation,
  H4,
  Button,
  FormGroup,
  InputGroup,
  Switch,
  HTMLSelect,
  Dialog,
  Callout,
  Intent,
  Classes,
  Divider
} from "@blueprintjs/core";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { hashPasswordClient, hashPin, hashTotpToken } from "../../../utils/auth";
import { setPin, clearPin } from "../../../services";
import type { UserInfo } from "../../../services";
import { DigitInput } from "../../../components/DigitInput";

interface SessionLockCardProps {
  user: UserInfo | null;
  onRefresh: () => void;
}

export const SessionLockCard: React.FC<SessionLockCardProps> = ({ user, onRefresh }) => {
  const { t } = useTranslation();

  // Local state for lock configuration
  const [lockEnabled, setLockEnabled] = useState<boolean>(() => {
    return localStorage.getItem("obex_session_lock_enabled") === "true";
  });
  const [timeout, setTimeoutVal] = useState<number>(() => {
    return Number(localStorage.getItem("obex_session_lock_timeout")) || 15;
  });

  // Modal / Setup state
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [verifyTotp, setVerifyTotp] = useState("");
  const [useTotpForVerify, setUseTotpForVerify] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Disable / Clear state
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);

  const isPinEnabled = !!user?.pin_enabled;

  const handleToggleLock = (e: React.FormEvent<HTMLInputElement>) => {
    const checked = e.currentTarget.checked;
    if (checked && !isPinEnabled) {
      // Must set a PIN first
      setError("");
      setNewPin("");
      setConfirmPin("");
      setVerifyPassword("");
      setVerifyTotp("");
      setSetupDialogOpen(true);
    } else {
      setLockEnabled(checked);
      localStorage.setItem("obex_session_lock_enabled", checked ? "true" : "false");
    }
  };

  const handleTimeoutChange = (e: React.FormEvent<HTMLSelectElement>) => {
    const val = Number(e.currentTarget.value);
    setTimeoutVal(val);
    localStorage.setItem("obex_session_lock_timeout", val.toString());
  };

  const handleOpenSetup = () => {
    setError("");
    setNewPin("");
    setConfirmPin("");
    setVerifyPassword("");
    setVerifyTotp("");
    setSetupDialogOpen(true);
  };

  const handleOpenDisable = () => {
    setError("");
    setVerifyPassword("");
    setVerifyTotp("");
    setDisableDialogOpen(true);
  };

  const handleSetupPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      setError(t("auth.pinFormatTip", "PIN must be exactly 4 digits"));
      return;
    }
    if (newPin !== confirmPin) {
      setError(t("auth.pinMatchTip", "PINs do not match"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const pinHashValue = await hashPin(newPin);
      
      // Build verification payload
      const verificationPayload: { password?: string; totpTokenHash?: string; totpSalt?: string } = {};
      if (user?.totp_enabled && useTotpForVerify) {
        const salt = crypto.randomUUID();
        const hashHex = await hashTotpToken(verifyTotp.replace(/\s/g, ""), salt);
        verificationPayload.totpTokenHash = hashHex;
        verificationPayload.totpSalt = salt;
      } else {
        if (!verifyPassword) {
          setError(t("auth.passwordRequired", "Password is required for verification"));
          setLoading(false);
          return;
        }
        let passwordPayload = verifyPassword;
        if (user?.password_version === 2) {
          passwordPayload = await hashPasswordClient(verifyPassword, user.username);
        }
        verificationPayload.password = passwordPayload;
      }

      await setPin(pinHashValue, verificationPayload);

      // Success! Enable session lock
      setSetupDialogOpen(false);
      setLockEnabled(true);
      localStorage.setItem("obex_session_lock_enabled", "true");
      onRefresh();
    } catch (err: any) {
      setError(err.bodyText || err.message || t("common.errorNetwork"));
    } finally {
      setLoading(false);
    }
  };

  const handleClearPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const verificationPayload: { password?: string; totpTokenHash?: string; totpSalt?: string } = {};
      if (user?.totp_enabled && useTotpForVerify) {
        const salt = crypto.randomUUID();
        const hashHex = await hashTotpToken(verifyTotp.replace(/\s/g, ""), salt);
        verificationPayload.totpTokenHash = hashHex;
        verificationPayload.totpSalt = salt;
      } else {
        if (!verifyPassword) {
          setError(t("auth.passwordRequired", "Password is required for verification"));
          setLoading(false);
          return;
        }
        let passwordPayload = verifyPassword;
        if (user?.password_version === 2) {
          passwordPayload = await hashPasswordClient(verifyPassword, user.username);
        }
        verificationPayload.password = passwordPayload;
      }

      await clearPin(verificationPayload);

      // Success! Disable session lock and clear
      setDisableDialogOpen(false);
      setLockEnabled(false);
      localStorage.setItem("obex_session_lock_enabled", "false");
      onRefresh();
    } catch (err: any) {
      setError(err.bodyText || err.message || t("common.errorNetwork"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card elevation={Elevation.ONE} className="mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-indigo-600" />
          <H4 className="m-0!">{t("auth.sessionLockTitle", "Idle Session Lock")}</H4>
        </div>
      </div>

      <p className="text-gray-500 text-sm mb-4">
        {t(
          "auth.sessionLockDesc",
          "Lock the interface with a 4-digit PIN when the application is idle to protect active sessions from unauthorized physical access."
        )}
      </p>

      {/* Configurations */}
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex items-center justify-between">
          <span>{t("auth.enableSessionLock", "Enable Session Lock")}</span>
          <Switch
            checked={lockEnabled && isPinEnabled}
            onChange={handleToggleLock}
            className="m-0"
          />
        </div>

        <div className="flex items-center justify-between">
          <span>{t("auth.inactivityTimeout", "Inactivity Timeout")}</span>
          <HTMLSelect
            value={timeout}
            onChange={handleTimeoutChange}
            disabled={!isPinEnabled}
            options={[
              { label: t("auth.timeout1m", "1 Minute"), value: 1 },
              { label: t("auth.timeout2m", "2 Minutes"), value: 2 },
              { label: t("auth.timeout5m", "5 Minutes"), value: 5 },
              { label: t("auth.timeout15m", "15 Minutes"), value: 15 },
              { label: t("auth.timeout30m", "30 Minutes"), value: 30 },
              { label: t("auth.timeout60m", "60 Minutes"), value: 60 }
            ]}
          />
        </div>
      </div>

      {/* PIN configuration controls */}
      <div className="flex items-center gap-3">
        {isPinEnabled ? (
          <>
            <Button icon="edit" onClick={handleOpenSetup}>
              {t("auth.changePin", "Change PIN")}
            </Button>
            <Button icon="trash" intent={Intent.DANGER} onClick={handleOpenDisable}>
              {t("auth.disablePin", "Disable PIN & Lock")}
            </Button>
          </>
        ) : (
          <Button icon="key" intent={Intent.PRIMARY} onClick={handleOpenSetup}>
            {t("auth.configurePin", "Configure 4-Digit PIN")}
          </Button>
        )}
      </div>

      {/* Configure PIN Dialog */}
      <Dialog
        isOpen={setupDialogOpen}
        onClose={() => setSetupDialogOpen(false)}
        title={isPinEnabled ? t("auth.changePin", "Change PIN") : t("auth.configurePin", "Configure PIN")}
        icon="key"
        className="pb-0"
        style={{ width: "400px" }}
      >
        <form onSubmit={handleSetupPin}>
          <div className={Classes.DIALOG_BODY}>
            {error && (
              <Callout intent={Intent.DANGER} className="mb-4">
                {error}
              </Callout>
            )}

            <FormGroup 
              label={t("auth.newPin", "New 4-Digit PIN")} 
              labelFor="new-pin-input"
              helperText={t("auth.pinHelper", "Digits only, e.g., 1234")}
            >
              <DigitInput
                length={4}
                value={newPin}
                onChange={setNewPin}
                type="password"
                disabled={loading}
                autoFocus
              />
            </FormGroup>

            <FormGroup label={t("auth.confirmPin", "Confirm New PIN")} labelFor="confirm-pin-input">
              <DigitInput
                length={4}
                value={confirmPin}
                onChange={setConfirmPin}
                type="password"
                disabled={loading}
              />
            </FormGroup>

            <Divider className="my-4" />

            <div className="flex justify-between items-center mb-2">
              <span className="font-semibold text-sm">{t("auth.verifyIdentity", "Verify Identity")}</span>
              {user?.totp_enabled && (
                <Button
                  minimal
                  small
                  intent={Intent.PRIMARY}
                  onClick={() => setUseTotpForVerify(!useTotpForVerify)}
                >
                  {useTotpForVerify ? t("auth.usePassword", "Use Password") : t("auth.use2fa", "Use 2FA Code")}
                </Button>
              )}
            </div>

            {user?.totp_enabled && useTotpForVerify ? (
              <FormGroup label={t("auth.totpCode", "2FA Code")} labelFor="verify-totp-input">
                <DigitInput
                  length={6}
                  value={verifyTotp}
                  onChange={setVerifyTotp}
                  disabled={loading}
                />
              </FormGroup>
            ) : (
              <FormGroup label={t("auth.currentPassword", "Current Password")} labelFor="verify-pw-input">
                <InputGroup
                  id="verify-pw-input"
                  type="password"
                  placeholder={t("auth.passwordPlaceholder", "Enter current password")}
                  value={verifyPassword}
                  onChange={(e) => setVerifyPassword(e.target.value)}
                  leftIcon="lock"
                  required
                />
              </FormGroup>
            )}
          </div>

          <div className={Classes.DIALOG_FOOTER}>
            <div className={Classes.DIALOG_FOOTER_ACTIONS}>
              <Button onClick={() => setSetupDialogOpen(false)}>{t("common.cancel", "Cancel")}</Button>
              <Button type="submit" intent={Intent.PRIMARY} loading={loading}>
                {t("common.save", "Save")}
              </Button>
            </div>
          </div>
        </form>
      </Dialog>

      {/* Disable PIN / Lock Dialog */}
      <Dialog
        isOpen={disableDialogOpen}
        onClose={() => setDisableDialogOpen(false)}
        title={t("auth.disablePin", "Disable Session Lock")}
        icon="trash"
        className="pb-0"
        style={{ width: "400px" }}
      >
        <form onSubmit={handleClearPin}>
          <div className={Classes.DIALOG_BODY}>
            {error && (
              <Callout intent={Intent.DANGER} className="mb-4">
                {error}
              </Callout>
            )}

            <Callout intent={Intent.WARNING} className="mb-4" icon={<ShieldAlert size={20} />}>
              {t("auth.disablePinWarning", "Disabling the PIN will disable the inactivity session locking feature completely.")}
            </Callout>

            <div className="flex justify-between items-center mb-2">
              <span className="font-semibold text-sm">{t("auth.verifyIdentity", "Verify Identity")}</span>
              {user?.totp_enabled && (
                <Button
                  minimal
                  small
                  intent={Intent.PRIMARY}
                  onClick={() => setUseTotpForVerify(!useTotpForVerify)}
                >
                  {useTotpForVerify ? t("auth.usePassword", "Use Password") : t("auth.use2fa", "Use 2FA Code")}
                </Button>
              )}
            </div>

            {user?.totp_enabled && useTotpForVerify ? (
              <FormGroup label={t("auth.totpCode", "2FA Code")} labelFor="disable-totp-input">
                <DigitInput
                  length={6}
                  value={verifyTotp}
                  onChange={setVerifyTotp}
                  disabled={loading}
                />
              </FormGroup>
            ) : (
              <FormGroup label={t("auth.currentPassword", "Current Password")} labelFor="disable-pw-input">
                <InputGroup
                  id="disable-pw-input"
                  type="password"
                  placeholder={t("auth.passwordPlaceholder", "Enter current password")}
                  value={verifyPassword}
                  onChange={(e) => setVerifyPassword(e.target.value)}
                  leftIcon="lock"
                  required
                />
              </FormGroup>
            )}
          </div>

          <div className={Classes.DIALOG_FOOTER}>
            <div className={Classes.DIALOG_FOOTER_ACTIONS}>
              <Button onClick={() => setDisableDialogOpen(false)}>{t("common.cancel", "Cancel")}</Button>
              <Button type="submit" intent={Intent.DANGER} loading={loading}>
                {t("common.disable", "Disable")}
              </Button>
            </div>
          </div>
        </form>
      </Dialog>
    </Card>
  );
};
