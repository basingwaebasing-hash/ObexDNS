import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Elevation,
  H4,
  Button,
  Switch,
  HTMLSelect,
  Intent
} from "@blueprintjs/core";
import { ShieldCheck } from "lucide-react";
import type { UserInfo } from "../../../services";
import { SetupPinDialog } from "./SetupPinDialog";
import { DisablePinDialog } from "./DisablePinDialog";

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
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);

  const isPinEnabled = !!user?.pin_enabled;

  const handleToggleLock = (e: React.FormEvent<HTMLInputElement>) => {
    const checked = e.currentTarget.checked;
    if (checked && !isPinEnabled) {
      // Must set a PIN first
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
    setSetupDialogOpen(true);
  };

  const handleOpenDisable = () => {
    setDisableDialogOpen(true);
  };

  const handleSetupSuccess = () => {
    setSetupDialogOpen(false);
    setLockEnabled(true);
    localStorage.setItem("obex_session_lock_enabled", "true");
    onRefresh();
  };

  const handleDisableSuccess = () => {
    setDisableDialogOpen(false);
    setLockEnabled(false);
    localStorage.setItem("obex_session_lock_enabled", "false");
    onRefresh();
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

      {/* Dialog Components */}
      <SetupPinDialog
        isOpen={setupDialogOpen}
        onClose={() => setSetupDialogOpen(false)}
        user={user}
        onSuccess={handleSetupSuccess}
      />

      <DisablePinDialog
        isOpen={disableDialogOpen}
        onClose={() => setDisableDialogOpen(false)}
        user={user}
        onSuccess={handleDisableSuccess}
      />
    </Card>
  );
};
