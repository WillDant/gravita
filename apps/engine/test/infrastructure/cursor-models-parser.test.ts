import { describe, expect, test } from "bun:test";
import { parseCursorModelsOutput } from "../../src/infrastructure/cursor/cursor-models-parser";

describe("parseCursorModelsOutput", () => {
  test("parses CLI lines and maps auto to default", () => {
    const out = parseCursorModelsOutput(`
Available models
auto - Auto (current, default)
composer-2.5 - Composer 2.5
grok-4.5-high - Grok 4.5 High
`);
    expect(out).toEqual([
      { value: "default", displayName: "Auto" },
      { value: "composer-2.5", displayName: "Composer 2.5" },
      { value: "grok-4.5-high", displayName: "Grok 4.5 High" },
    ]);
  });

  test("strips NO ZDR suffix from labels", () => {
    const out = parseCursorModelsOutput("gpt-5 - GPT-5 (NO ZDR)");
    expect(out).toEqual([{ value: "gpt-5", displayName: "GPT-5" }]);
  });
});
