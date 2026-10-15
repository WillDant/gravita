import { Download, RefreshCw, Tag } from "lucide-react";
import { useState } from "react";
import { useGateway, useOpenRelease } from "@/app/providers";
import { t, useLocale } from "@/shared/i18n/i18n";
import { Row } from "@/shared/ui/SettingsRow";
import { Button } from "@/shared/ui/ui";
import { useAvailableUpdate, useEngineVersion } from "@/state/hooks";

type Check = "idle" | "checking" | "upToDate" | "failed";
type Install = "idle" | "installing" | "opened" | "failed";

/**
 * Settings' "Updates" section: the version you run, a button to look for a newer one now,
 * and, when there is one, "Install": the engine downloads the .dmg, checks its SHA-256 and
 * opens it, and you drag Gravita to Applications. A release without an installer (or an
 * engine that can't fetch it) falls back to its page.
 */
export function UpdateSettings() {
  useLocale();
  const gateway = useGateway();
  const openRelease = useOpenRelease();
  const version = useEngineVersion();
  const update = useAvailableUpdate();
  const [check, setCheck] = useState<Check>("idle");
  const [install, setInstall] = useState<Install>("idle");

  const look = () => {
    setCheck("checking");
    setInstall("idle");
    gateway.checkForUpdate().then(
      ({ update: found }) => setCheck(found ? "idle" : "upToDate"),
      () => setCheck("failed"),
    );
  };
  const run = () => {
    setInstall("installing");
    gateway.installUpdate().then(
      () => setInstall("opened"),
      () => setInstall("failed"),
    );
  };

  return (
    <section aria-labelledby="settings-updates">
      <h2 id="settings-updates" className="mb-1 text-md font-semibold">
        {t("settings.updates")}
      </h2>
      <p className="mb-4 max-w-[68ch] text-sm text-ink-2">{t("settings.updates.body")}</p>
      <div className="flex flex-col divide-y divide-hairline rounded-xl border border-hairline bg-panel">
        <Row
          icon={<Tag size={16} />}
          title={t("settings.updates.version")}
          body={version ?? t("settings.updates.versionUnknown")}
        >
          <Button onClick={look} disabled={check === "checking"}>
            <RefreshCw size={14} aria-hidden="true" />
            {check === "checking" ? t("settings.updates.checking") : t("settings.updates.check")}
          </Button>
        </Row>
        {(update || check === "upToDate" || check === "failed") && (
          <Row
            icon={<Download size={16} />}
            title={
              update
                ? t("settings.updates.available", { version: update.version })
                : check === "failed"
                  ? t("settings.updates.checkFailed")
                  : t("settings.updates.upToDate")
            }
            body={
              install === "opened"
                ? t("settings.updates.opened")
                : install === "failed"
                  ? t("settings.updates.installFailed")
                  : ""
            }
          >
            {update &&
              (update.asset && install !== "failed" ? (
                <Button
                  variant="primary"
                  onClick={run}
                  disabled={install === "installing" || install === "opened"}
                >
                  {install === "installing"
                    ? t("settings.updates.installing")
                    : t("settings.updates.install")}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => void openRelease(update.url).catch(() => {})}
                >
                  {t("settings.updates.openPage")}
                </Button>
              ))}
          </Row>
        )}
      </div>
    </section>
  );
}
