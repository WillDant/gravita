import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SplitPane } from "./SplitPane";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const renderSplit = () =>
  render(
    <SplitPane
      storageKey="test.split"
      label="Resize the map"
      defaultEnd={440}
      minEnd={360}
      start={<p>talk</p>}
      end={<p>map</p>}
    />,
  );

describe("SplitPane", () => {
  it("resizes the end pane from the keyboard, within its bounds, and remembers it", () => {
    renderSplit();
    const handle = screen.getByRole("separator", { name: "Resize the map" });
    expect(handle.getAttribute("aria-valuenow")).toBe("440");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("416");
    fireEvent.keyDown(handle, { key: "End" });
    expect(handle.getAttribute("aria-valuenow")).toBe("360");
    expect(localStorage.getItem("test.split")).toBe("360");

    cleanup();
    renderSplit();
    expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("360");
  });

  it("goes back to its default width on double click", () => {
    renderSplit();
    const handle = screen.getByRole("separator");
    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.doubleClick(handle);
    expect(handle.getAttribute("aria-valuenow")).toBe("440");
  });
});
