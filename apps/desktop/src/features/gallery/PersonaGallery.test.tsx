import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { renderWithApp } from "@/test/render";
import { PersonaGallery } from "./PersonaGallery";
import { galleryPersonas } from "./personas";

afterEach(cleanup);
setLocale("en");
// jsdom has no 2D context (and says so loudly): the canvas cells must cope with null.
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

describe("PersonaGallery", () => {
  const personas = galleryPersonas();

  it("enumerates distinct personas, from every lifecycle and activity", () => {
    expect(new Set(personas.map((p) => p.id)).size).toBe(personas.length);
    const moods = new Set(personas.map((p) => p.persona.mood));
    for (const m of ["idle", "thinking", "focused", "busy", "delegating", "waiting", "blocked"])
      expect(moods.has(m as never)).toBe(true);
    for (const m of ["error", "done", "stopped", "away"]) expect(moods.has(m as never)).toBe(true);
    const glyphs = new Set(personas.map((p) => p.persona.glyph));
    for (const g of ["hand", "question", "file", "terminal", "branch", "eye", "moon", "unlink"])
      expect(glyphs.has(g)).toBe(true);
  });

  it("renders a cell for every persona, with its label and glyph id", () => {
    const { container } = renderWithApp(<PersonaGallery />);
    const cells = container.querySelectorAll("li[data-persona]");
    expect(cells).toHaveLength(personas.length);
    for (const { id, persona } of personas) {
      const cell = container.querySelector(`li[data-persona="${id}"]`)!;
      expect(cell.textContent).toContain(persona.glyph);
      expect(cell.querySelector("svg")).toBeTruthy();
      expect(cell.querySelector("canvas")).toBeTruthy();
    }
    expect(screen.getAllByText("is waiting for your approval").length).toBeGreaterThan(0);
  });

  it("plays the 1/3 budget: of nine waiting orbs only three bounce, all keep the halo", () => {
    renderWithApp(<PersonaGallery />);
    const row = screen.getByTestId("gallery-budget-row");
    expect(row.querySelectorAll(".orb-bounce")).toHaveLength(3);
    expect(row.querySelectorAll(".ring-pulse")).toHaveLength(9);
  });

  it("switches reduced motion on for its own subtree", () => {
    const { container } = renderWithApp(<PersonaGallery />);
    const toggle = screen.getByRole("button", { name: "Reduced motion" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".persona-gallery[data-reduced-motion]")).toBeTruthy();
  });
});
