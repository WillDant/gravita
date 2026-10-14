import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@/shared/i18n/i18n";
import { cn } from "@/shared/utils";

const COPIED_MS = 1500;

/** Copies `text` to the clipboard; the icon turns into a check for a moment. */
export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={copied ? t("conversation.copied") : label}
      title={label}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => {},
        );
      }}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-panel-2 hover:text-ink",
        className,
      )}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}
