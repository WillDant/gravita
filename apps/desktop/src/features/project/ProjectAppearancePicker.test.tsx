import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sidebar } from "@/features/navigation/Sidebar";
import { Project } from "@/features/project/Project";
import { setLocale } from "@/shared/i18n/i18n";
import { started, stateOf } from "@/test/events";
import { flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";

afterEach(cleanup);
setLocale("en");

const state = stateOf(started("s1", 5, "p1"), started("s2", 4, "p2"));

function renderBoth(projectId = "p1") {
  return renderWithApp(
    <>
      <Sidebar />
      <Project projectId={projectId} />
    </>,
    { state },
  );
}

const opener = () => screen.getByRole("button", { name: "Change icon and colour" });
/** The tiles of projects (the picker's own colour swatches don't count). */
const tiles = () =>
  [...document.querySelectorAll<HTMLElement>("[data-tone]")].filter(
    (el) => !el.closest('[role="dialog"]'),
  );

describe("project appearance", () => {
  it("opens from the project's tile and closes with Escape or a click outside", async () => {
    renderBoth();
    await act(flush);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(opener());
    expect(screen.getByRole("dialog", { name: "Project appearance" })).toBeTruthy();
    expect(opener().getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(opener());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a chosen colour and icon show on the header tile and in the side menu at once", async () => {
    renderBoth();
    await act(flush);
    expect(tiles()).toHaveLength(0);
    fireEvent.click(opener());
    fireEvent.click(screen.getByRole("radio", { name: "Violet" }));
    fireEvent.click(screen.getByRole("radio", { name: "Rocket" }));

    // The header's tile and the menu's both wear it.
    const violet = tiles().filter((el) => el.dataset.tone === "violet");
    expect(violet.length).toBeGreaterThanOrEqual(2);
    expect(violet.every((el) => el.querySelector("svg"))).toBe(true);
  });

  it("only changes the project it was chosen for, and Reset brings the default back", async () => {
    const view = renderBoth();
    await act(flush);
    fireEvent.click(opener());
    fireEvent.click(screen.getByRole("radio", { name: "Green" }));
    // Only p1's tiles (header and menu) are coloured: p2 keeps its neutral one.
    expect(tiles()).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tiles()).toHaveLength(0);
    view.unmount();
  });

  it("each group is a radio group, so the arrow keys move within it", async () => {
    renderBoth();
    await act(flush);
    fireEvent.click(opener());
    const colours = screen.getByRole("group", { name: "Colour" });
    expect(colours.querySelectorAll('input[type="radio"]').length).toBe(9);
    const icons = screen.getByRole("group", { name: "Icon" });
    expect(icons.querySelectorAll('input[type="radio"]').length).toBe(29);
    expect((screen.getByRole("radio", { name: "Gray" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Initial" }) as HTMLInputElement).checked).toBe(true);
  });
});
