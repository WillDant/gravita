import * as m from "motion/react-m";
import { t } from "@/shared/i18n/i18n";
import { ProviderLogo } from "@/shared/ui/ProviderLogo";

/** A new chat's first sight: who is on the other side, and that it is ready for work. */
export function Welcome({ provider }: { provider: string }) {
  const name = providerName(provider);
  return (
    <m.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex h-full flex-col items-center justify-center gap-4 px-8 pb-10 text-center"
    >
      <ProviderLogo provider={provider} />
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink">
          {t("conversation.welcome.title", { name })}
        </h2>
        <p className="text-sm text-ink-2">{t("conversation.welcome.hint")}</p>
      </div>
    </m.div>
  );
}

/** The provider's name, or the generic "main agent" for one without a mark. */
function providerName(provider: string): string {
  const key = `newSession.provider.${provider}`;
  const name = t(key);
  return name === key ? t("agent.main") : name;
}
