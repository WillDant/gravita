import { describe, expect, it } from "vitest";
import { isReleaseUrl } from "./tauri";

describe("isReleaseUrl", () => {
  it("accepts only the repository's own release pages", () => {
    expect(isReleaseUrl("https://github.com/WillDant/gravita/releases")).toBe(true);
    expect(isReleaseUrl("https://github.com/WillDant/gravita/releases/tag/v0.5.0-beta")).toBe(true);
    expect(isReleaseUrl("https://github.com/WillDant/gravita/releases?page=2")).toBe(true);
    for (const bad of [
      "http://github.com/WillDant/gravita/releases",
      "https://github.com/WillDant/gravita",
      "https://github.com/WillDant/gravita/releases-evil",
      "https://github.com.evil.example/WillDant/gravita/releases",
      "https://github.com/WillDant/other/releases/tag/v1",
      "https://github.com/WillDant/gravita/releases/tag/v1 x",
      "javascript:alert(1)",
      "",
    ]) {
      expect(isReleaseUrl(bad), bad).toBe(false);
    }
  });
});
