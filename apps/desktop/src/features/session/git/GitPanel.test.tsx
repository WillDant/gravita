import type { GitInfo } from "@gravita/protocol";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { GitButton } from "./GitPanel";

afterEach(cleanup);
setLocale("en");

const REPO: GitInfo = {
  repo: true,
  root: "/work/p1",
  branch: "feat/git-panel",
  head: "abc1234",
  upstream: "origin/feat/git-panel",
  ahead: 2,
  behind: 0,
  files: [
    { path: "src/app.ts", state: "modified", staged: false },
    { path: "notes.md", state: "untracked", staged: false },
  ],
  diff: [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1 +1 @@",
    "-const a = 1;",
    "+const a = 2;",
    "diff --git a/notes.md b/notes.md",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/notes.md",
    "@@ -0,0 +1 @@",
    "+hello",
    "",
  ].join("\n"),
  diffTruncated: false,
  pr: {
    number: 42,
    title: "Show git in the session",
    url: "https://github.com/o/r/pull/42",
    state: "open",
    draft: false,
    base: "main",
    checks: "failing",
  },
};

async function open(info: GitInfo) {
  const gateway = new FakeGateway();
  gateway.gitInfoResult = info;
  renderWithApp(<GitButton cwd="/work/p1" />, { gateway });
  await act(flush);
  return gateway;
}

describe("GitButton", () => {
  it("shows the branch and the changed-file count, read without diff or PR", async () => {
    const gateway = await open(REPO);
    const button = screen.getByRole("button", { name: /feat\/git-panel, 2 files changed/ });
    expect(button.textContent).toContain("2");
    expect(gateway.callsOf("gitInfo")).toEqual([{ cwd: "/work/p1", summary: true }]);
  });

  it("opens the panel with the branch, its PR and the diff of each file", async () => {
    const gateway = await open(REPO);
    fireEvent.click(screen.getByRole("button", { name: /feat\/git-panel/ }));
    await act(flush);
    expect(gateway.callsOf("gitInfo").at(-1)).toEqual({ cwd: "/work/p1" });
    const dialog = screen.getByRole("dialog", { name: "Git" });
    expect(dialog.textContent).toContain("2 commits ahead");
    expect(screen.getByRole("link", { name: /#42.*Show git in the session/ })).toHaveProperty(
      "href",
      "https://github.com/o/r/pull/42",
    );
    expect(dialog.textContent).toContain("Checks failing");
    expect(dialog.textContent).toContain("+const a = 2;");
    expect(dialog.textContent).toContain("+hello");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toggles with ⇧⌘G and says why there is no PR", async () => {
    await open({ ...REPO, pr: null, prUnavailable: "not-installed" });
    fireEvent.keyDown(window, { key: "G", metaKey: true, shiftKey: true });
    await act(flush);
    expect(screen.getByRole("dialog").textContent).toContain("Install the GitHub CLI (gh)");
    fireEvent.keyDown(window, { key: "G", metaKey: true, shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays hidden outside a repository", async () => {
    await open({ repo: false });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
