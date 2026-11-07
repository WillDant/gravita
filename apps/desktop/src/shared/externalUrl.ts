/**
 * True for a web page the user's browser may open from a link an agent wrote: http or https
 * with a host, and nothing that could disguise where it goes (no credentials, no whitespace,
 * control characters or backslashes). The shell checks again (`external_link.rs`).
 */
export function isExternalUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url) || /[\s\p{Cc}\\]/u.test(url)) return false;
  try {
    const { hostname, username, password } = new URL(url);
    return hostname !== "" && username === "" && password === "";
  } catch {
    return false;
  }
}
