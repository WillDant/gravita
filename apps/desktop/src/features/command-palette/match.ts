// Fuzzy matching for the command palette: the query's letters in order, anywhere in the text.
// Case and accents don't count, so "sessao" finds "Sessão".

export interface FuzzyMatch {
  /** Higher is better: word starts and runs of letters score, gaps cost. */
  score: number;
  /** Indices of the matched characters in the original text, for highlighting. */
  indices: number[];
}

interface Folded {
  chars: string;
  /** For each folded character, the index of the original character it came from. */
  at: number[];
}

function fold(text: string): Folded {
  let chars = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const folded = (text[i] as string).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (const c of folded) {
      chars += c;
      at.push(i);
    }
  }
  return { chars, at };
}

const isWordStart = (chars: string, i: number) =>
  i === 0 || /[\s\-_/.:·›]/.test(chars[i - 1] ?? "");

/** Positions of each query letter, preferring word starts; null when the letters aren't there in order. */
function locate(q: string, chars: string, preferWordStarts: boolean): number[] | null {
  const out: number[] = [];
  let from = 0;
  for (const c of q) {
    let found = -1;
    const prev = out[out.length - 1];
    if (prev !== undefined && chars[prev + 1] === c) found = prev + 1;
    if (found < 0 && preferWordStarts) {
      for (let i = from; i < chars.length; i++) {
        if (chars[i] === c && isWordStart(chars, i)) {
          found = i;
          break;
        }
      }
    }
    if (found < 0) found = chars.indexOf(c, from);
    if (found < 0) return null;
    out.push(found);
    from = found + 1;
  }
  return out;
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = fold(query.replace(/\s+/g, "")).chars;
  if (q === "") return { score: 0, indices: [] };
  const t = fold(text);
  // Jumping to word starts can strand later letters; plain left-to-right always finds a match if one exists.
  const pos = locate(q, t.chars, true) ?? locate(q, t.chars, false);
  if (!pos) return null;

  let score = 0;
  for (let k = 0; k < pos.length; k++) {
    const i = pos[k] as number;
    if (isWordStart(t.chars, i)) score += 10;
    const prev = pos[k - 1];
    if (prev !== undefined) score += i === prev + 1 ? 5 : -Math.min(i - prev - 1, 5);
  }
  const whole = t.chars.replace(/\s+/g, "");
  if (whole.startsWith(q)) score += 20;
  else if (whole.includes(q)) score += 10;

  return { score, indices: [...new Set(pos.map((i) => t.at[i] as number))] };
}
