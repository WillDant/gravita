/**
 * Whether the user is looking at Gravita: its window is visible and focused. Notifications
 * only go out while it isn't, and a pending deep link is followed when it is again.
 */
export interface WindowAttention {
  attended(): boolean;
  /** Called each time the window becomes visible and focused again. */
  onAttend(listener: () => void): () => void;
}

export function domAttention(doc: Document = document, win: Window = window): WindowAttention {
  const attended = () => !doc.hidden && doc.hasFocus();
  return {
    attended,
    onAttend(listener) {
      // Focus and visibility arrive in either order when the window comes back; fire once
      // per return, when both hold.
      let was = attended();
      const check = () => {
        const now = attended();
        if (now && !was) listener();
        was = now;
      };
      const away = () => {
        was = false;
      };
      win.addEventListener("focus", check);
      win.addEventListener("blur", away);
      doc.addEventListener("visibilitychange", check);
      return () => {
        win.removeEventListener("focus", check);
        win.removeEventListener("blur", away);
        doc.removeEventListener("visibilitychange", check);
      };
    },
  };
}
