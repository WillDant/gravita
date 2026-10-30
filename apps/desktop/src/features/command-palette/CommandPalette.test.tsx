import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { started, stateOf } from "@/test/events";
import { flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { CommandPalette } from "./CommandPalette";
import { useCommandPaletteHotkey } from "./useCommandPaletteHotkey";

afterEach(cleanup);
setLocale("en");

const state = stateOf(started("s1", 5, "p1", "chat"), started("s2", 9, "p2", "chat"));

function Harness() {
  useCommandPaletteHotkey();
  return (
    <>
      <button type="button">Composer</button>
      <CommandPalette />
    </>
  );
}

const pressK = () => fireEvent.keyDown(window, { key: "k", metaKey: true });
const input = () => screen.getByRole("combobox", { name: "Command palette" });

describe("CommandPalette", () => {
  it("opens with ⌘K, focused on the search, and closes with ⌘K again", async () => {
    renderWithApp(<Harness />, { state });
    await act(flush);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(pressK);
    expect(document.activeElement).toBe(input());
    act(pressK);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens even when a terminal or editor would take the key for itself", async () => {
    renderWithApp(<Harness />, { state });
    await act(flush);
    const composer = screen.getByRole("button", { name: "Composer" });
    // A focused element that stops the key from bubbling: the capture listener still sees it.
    composer.addEventListener("keydown", (e) => e.stopPropagation());
    act(() => {
      fireEvent.keyDown(composer, { key: "k", metaKey: true });
    });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
  });

  it("filters as the user types and opens the highlighted row with return", async () => {
    const { navigate, store } = renderWithApp(<Harness />, { state });
    await act(flush);
    act(pressK);
    fireEvent.change(input(), { target: { value: "p2" } });
    const options = screen.getAllByRole("option");
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith({ level: "project", projectId: "p2" });
    expect(store.getState().paletteOpen).toBe(false);
  });

  it("says when nothing matches", async () => {
    renderWithApp(<Harness />, { state });
    await act(flush);
    act(pressK);
    fireEvent.change(input(), { target: { value: "zzzz" } });
    expect(screen.getByText("Nothing matches “zzzz”.")).toBeTruthy();
  });

  it("closes with Escape and gives the focus back", async () => {
    renderWithApp(<Harness />, { state });
    await act(flush);
    const composer = screen.getByRole("button", { name: "Composer" });
    composer.focus();
    act(pressK);
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(composer);
  });

  it("asks before stopping every agent, then shows the tray's notice", async () => {
    const { gateway, store } = renderWithApp(<Harness />, { state });
    await act(flush);
    act(pressK);
    fireEvent.change(input(), { target: { value: "stop all" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Stop all agents?" })).toBeTruthy();
    expect(gateway.callsOf("stopAll")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Stop all" }));
    await act(flush);
    expect(gateway.callsOf("stopAll")).toHaveLength(1);
    expect(store.getState().notice?.key).toBe("notice.stoppedNone");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
