import { describe, expect, test } from "bun:test";
import type { ReleaseSource } from "../../src/application/ports/release-source";
import { ReleaseChecker } from "../../src/application/services/release-checker";
import { GithubReleaseSource } from "../../src/infrastructure/releases/github-release-source";
import { FakeClock, SilentLogger } from "../fakes";

const release = (tag: string) => ({
  tag,
  url: `https://github.com/WillDant/gravita/releases/tag/${tag}`,
  draft: false,
});

function setup(source: ReleaseSource, current = "0.4.0-beta") {
  const clock = new FakeClock();
  const seen: ({ version: string; url: string } | undefined)[] = [];
  const checker = new ReleaseChecker({
    source,
    status: { updateStatus: (p) => seen.push(p.update) },
    clock,
    logger: new SilentLogger(),
    current,
    firstDelayMs: 1_000,
    intervalMs: 10_000,
  });
  return { checker, clock, seen };
}

describe("ReleaseChecker", () => {
  test("reports a newer release, and clears it once there is none", async () => {
    let list = [release("v0.4.0-beta"), release("v0.5.0-beta")];
    const { checker, seen } = setup({ list: async () => list });
    await checker.check();
    expect(seen).toEqual([
      {
        version: "0.5.0-beta",
        url: "https://github.com/WillDant/gravita/releases/tag/v0.5.0-beta",
      },
    ]);
    list = [release("v0.4.0-beta")];
    await checker.check();
    expect(seen.at(-1)).toBeUndefined();
  });

  test("a failed look changes nothing and does not throw", async () => {
    const { checker, seen } = setup({
      list: async () => {
        throw new Error("offline");
      },
    });
    await checker.check();
    expect(seen).toEqual([]);
  });

  test("looks soon after start, then at its interval, until stopped", async () => {
    let calls = 0;
    const { checker, clock } = setup({
      list: async () => {
        calls++;
        return [];
      },
    });
    checker.start();
    expect(calls).toBe(0);
    clock.advance(1_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);
    clock.advance(10_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(2);
    checker.stop();
    clock.advance(60_000);
    await Promise.resolve();
    expect(calls).toBe(2);
  });
});

describe("GithubReleaseSource", () => {
  const answer =
    (body: unknown, status = 200) =>
    async () =>
      new Response(JSON.stringify(body), { status });

  test("asks anonymously for the list, naming the app, and keeps only the repository's own releases", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const source = new GithubReleaseSource("0.4.0-beta", async (url, init) => {
      request = { url, init };
      return answer([
        {
          tag_name: "v0.5.0-beta",
          html_url: "https://github.com/WillDant/gravita/releases/tag/v0.5.0-beta",
          draft: false,
        },
        { tag_name: "v9.9.9", html_url: "https://evil.example/releases/tag/v9.9.9", draft: false },
        { tag_name: 5, html_url: "x" },
      ])();
    });
    const releases = await source.list();
    expect(request?.url).toBe("https://api.github.com/repos/WillDant/gravita/releases?per_page=20");
    expect(JSON.stringify(request?.init.headers)).not.toMatch(/authorization/i);
    expect(request?.init.headers).toMatchObject({ "User-Agent": "gravita/0.4.0-beta" });
    expect(releases).toEqual([
      {
        tag: "v0.5.0-beta",
        url: "https://github.com/WillDant/gravita/releases/tag/v0.5.0-beta",
        draft: false,
      },
    ]);
  });

  test("an error status or an odd answer rejects", async () => {
    await expect(new GithubReleaseSource("1", answer({}, 404)).list()).rejects.toThrow("404");
    await expect(new GithubReleaseSource("1", answer({ not: "a list" })).list()).rejects.toThrow();
  });
});
