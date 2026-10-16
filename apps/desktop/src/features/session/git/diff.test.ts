import { describe, expect, it } from "vitest";
import { parseDiff } from "./diff";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 keep
-old
+new
+more
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
\\ No newline at end of file
diff --git a/logo.png b/logo.png
new file mode 100644
Binary files /dev/null and b/logo.png differ
diff --git a/old name.md b/new name.md
similarity 100%
rename from old name.md
rename to new name.md
`;

describe("parseDiff", () => {
  it("cuts the diff into files with their counts", () => {
    const files = parseDiff(DIFF);
    expect(files.map((f) => [f.path, f.additions, f.deletions, f.binary])).toEqual([
      ["src/a.ts", 2, 1, false],
      ["gone.txt", 0, 1, false],
      ["logo.png", 0, 0, true],
      ["new name.md", 0, 0, false],
    ]);
  });

  it("keeps hunk headers, context and notes in order", () => {
    const [a, gone] = parseDiff(DIFF);
    expect(a?.lines.map((l) => l.kind)).toEqual(["hunk", "context", "del", "add", "add"]);
    expect(gone?.lines.at(-1)).toEqual({ kind: "note", text: "\\ No newline at end of file" });
  });

  it("reads an empty diff as no files", () => {
    expect(parseDiff("")).toEqual([]);
  });
});
