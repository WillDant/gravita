import { CursorKey } from "@/features/connect/CursorKey";
import { t, useLocale } from "@/shared/i18n/i18n";

/** App settings: provider credentials and future preferences. */
export function Settings() {
  useLocale();
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8 px-8 pt-8 pb-16">
      <header>
        <h1 className="text-2xl font-bold tracking-[-0.02em]">{t("settings.title")}</h1>
      </header>

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
