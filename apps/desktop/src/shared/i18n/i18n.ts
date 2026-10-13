import { useSyncExternalStore } from "react";
import { en, type MessageKey } from "./locales/en";
import { ptBR } from "./locales/pt-BR";

// A deliberately tiny i18n: two catalogs, {param} interpolation and plural keys.
// Keeps the bundle light; swap for a full library only if we outgrow it.

type Locale = "en" | "pt-BR";
const catalogs: Record<Locale, Partial<Record<MessageKey, string>>> = { en, "pt-BR": ptBR };

function detect(): Locale {
  const pref = (() => {
    try {
      return localStorage.getItem("gravita.locale");
    } catch {
      return null;
    }
  })();
  if (pref === "en" || pref === "pt-BR") return pref;
  return navigator.language.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

let locale: Locale = detect();
const listeners = new Set<() => void>();

export function setLocale(next: Locale) {
  locale = next;
  try {
    localStorage.setItem("gravita.locale", next);
  } catch {
    // Storage unavailable: the choice lasts for this window only.
  }
  for (const l of listeners) l();
}

export function getLocale(): Locale {
  return locale;
}

const plural = { en: new Intl.PluralRules("en"), "pt-BR": new Intl.PluralRules("pt-BR") };

export function t(key: string, params: Record<string, string | number> = {}): string {
  const cat = catalogs[locale];
  let k = key;
  if (typeof params.count === "number" && !(key in en)) {
    // Zero reads as plural in both languages ("0 subagentes"), whatever CLDR says for pt.
    const form =
      params.count !== 0 && plural[locale].select(params.count) === "one" ? "one" : "other";
    k = `${key}.${form}`;
  }
  const template = cat[k as MessageKey] ?? en[k as MessageKey] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => locale,
  );
}

const rtf: Record<Locale, Intl.RelativeTimeFormat> = {
  en: new Intl.RelativeTimeFormat("en", { numeric: "auto" }),
  "pt-BR": new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" }),
};

export function ago(ts: string | undefined, now: number): string {
  if (!ts) return "";
  const diff = Math.max(0, now - Date.parse(ts));
  const min = Math.round(diff / 60_000);
  if (min < 1) return t("time.justNow");
  if (min < 60) return rtf[locale].format(-min, "minute");
  const h = Math.round(min / 60);
  if (h < 24) return rtf[locale].format(-h, "hour");
  return rtf[locale].format(-Math.round(h / 24), "day");
}

const nf: Record<Locale, Intl.NumberFormat> = {
  en: new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }),
  "pt-BR": new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }),
};

export function compact(n: number): string {
  return nf[locale].format(n);
}
