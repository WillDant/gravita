import { describe, expect, test } from "bun:test";
import { compareVersions, newerRelease, parseVersion } from "../../src/domain/release-version";

const cmp = (a: string, b: string) =>
  Math.sign(compareVersions(parseVersion(a) as never, parseVersion(b) as never));

describe("release versions", () => {
  test("reads tags and versions, with or without the v, and refuses anything else", () => {
    expect(parseVersion("v0.5.0-beta")).toEqual({ numbers: [0, 5, 0], label: ["beta"] });
    expect(parseVersion("1.2.3")).toEqual({ numbers: [1, 2, 3], label: [] });
    expect(parseVersion("1.2.3-rc.1+build5")).toEqual({ numbers: [1, 2, 3], label: ["rc", "1"] });
    for (const bad of ["", "latest", "1.2", "v1.2.x", "1.2.3."])
      expect(parseVersion(bad)).toBeUndefined();
  });

  test("orders numbers, then labels (a final release is after its pre-releases)", () => {
    expect(cmp("0.5.0-beta", "0.4.0-beta")).toBe(1);
    expect(cmp("0.10.0-beta", "0.9.0-beta")).toBe(1);
    expect(cmp("0.4.0-beta", "0.4.0-beta")).toBe(0);
    expect(cmp("0.4.0-alpha", "0.4.0-beta")).toBe(-1);
    expect(cmp("0.4.0-beta", "0.4.0-rc.1")).toBe(-1);
    expect(cmp("0.4.0-rc.2", "0.4.0-rc.10")).toBe(-1);
    expect(cmp("0.4.0", "0.4.0-rc.1")).toBe(1);
    expect(cmp("0.4.0-beta", "0.4.0-beta.1")).toBe(-1);
  });

  test("picks the newest published release above the current one", () => {
    const releases = [
      { tag: "v0.3.0-beta", url: "https://x/0.3", draft: false },
      { tag: "v0.6.0-beta", url: "https://x/0.6-draft", draft: true },
      { tag: "v0.5.0-beta", url: "https://x/0.5", draft: false },
      { tag: "nightly", url: "https://x/n", draft: false },
      { tag: "v0.4.0-beta", url: "https://x/0.4", draft: false },
    ];
    expect(newerRelease(releases, "0.4.0-beta")).toEqual({
      version: "0.5.0-beta",
      url: "https://x/0.5",
    });
    expect(newerRelease(releases, "0.5.0-beta")).toBeUndefined();
    expect(newerRelease(releases, "0.9.0")).toBeUndefined();
    expect(newerRelease(releases, "not-a-version")).toBeUndefined();
    expect(newerRelease([], "0.4.0-beta")).toBeUndefined();
  });
});
