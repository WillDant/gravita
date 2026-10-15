import {
  BellRing,
  CircleCheck,
  Hand,
  Languages,
  MoonStar,
  Palette,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { useTheme, useToggleTheme } from "@/app/providers";
import { CursorKey } from "@/features/connect/CursorKey";
import { NotificationToggles } from "@/features/notifications/NotificationSettings";
import { UpdateSettings } from "@/features/update/UpdateSettings";
import { getLocale, type Locale, setLocale, t, useLocale } from "@/shared/i18n/i18n";
import { Segmented } from "@/shared/ui/Segmented";
import { Row } from "@/shared/ui/SettingsRow";

/** App settings: how Gravita looks and notifies, and the providers' credentials. */
export function Settings() {
  useLocale();
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8 px-8 pt-8 pb-16">
      <header>
        <h1 className="text-2xl font-bold tracking-[-0.02em]">{t("settings.title")}</h1>
      </header>

      <Preferences />

      <UpdateSettings />

      <section aria-labelledby="settings-providers">
        <h2 id="settings-providers" className="mb-1 text-md font-semibold">
          {t("settings.providers")}
        </h2>
        <p className="mb-4 max-w-[68ch] text-sm text-ink-2">{t("settings.providers.body")}</p>
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">{t("settings.cursor.heading")}</h3>
            <CursorKey />
          </div>
        </div>
      </section>
    </div>
  );
}

/** Theme, language and notifications: what the menu's footer shortcuts also set. */
function Preferences() {
  const theme = useTheme();
  const toggleTheme = useToggleTheme();
  const locale = getLocale();
  return (
    <section aria-labelledby="settings-prefs">
      <h2 id="settings-prefs" className="mb-1 text-md font-semibold">
        {t("settings.prefs")}
      </h2>
      <p className="mb-4 max-w-[68ch] text-sm text-ink-2">{t("settings.prefs.body")}</p>
      <div className="flex flex-col divide-y divide-hairline rounded-xl border border-hairline bg-panel">
        <Row
          icon={<Palette size={16} />}
          title={t("settings.theme")}
          body={t("settings.theme.body")}
        >
          <Segmented
            name="settings-theme"
            legend={t("settings.theme")}
            hideLegend
            options={[
              {
                value: "light",
                label: t("settings.theme.light"),
                icon: <Sun size={14} aria-hidden="true" />,
              },
              {
                value: "dark",
                label: t("settings.theme.dark"),
                icon: <MoonStar size={14} aria-hidden="true" />,
              },
            ]}
            value={theme}
            // Choosing the theme already on screen changes nothing.
            onChange={(next) => next !== theme && toggleTheme()}
          />
        </Row>
        <Row
          icon={<Languages size={16} />}
          title={t("settings.language")}
          body={t("settings.language.body")}
        >
          <Segmented<Locale>
            name="settings-language"
            legend={t("settings.language")}
            hideLegend
            options={[
              { value: "en", label: t("settings.language.en") },
              { value: "pt-BR", label: t("settings.language.pt") },
            ]}
            value={locale}
            onChange={setLocale}
          />
        </Row>
        <Row
          icon={<BellRing size={16} />}
          title={t("settings.notifications")}
          body={t("settings.notifications.body")}
          stacked
        >
          <NotificationToggles
            icons={{
              waiting: <Hand size={14} aria-hidden="true" />,
              finished: <CircleCheck size={14} aria-hidden="true" />,
              failures: <TriangleAlert size={14} aria-hidden="true" />,
            }}
          />
        </Row>
      </div>
    </section>
  );
}
