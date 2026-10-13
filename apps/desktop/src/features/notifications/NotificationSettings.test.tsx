import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTICE_MS, NoticeLine } from "@/features/notice/NoticeLine";
import { setLocale } from "@/shared/i18n/i18n";
import { renderWithApp } from "@/test/render";
import { NotificationSettings } from "./NotificationSettings";

beforeEach(() => setLocale("en"));
afterEach(cleanup);

describe("NotificationSettings", () => {
  it("opens a small popover with three switches, all on, that remember changes", () => {
    renderWithApp(<NotificationSettings />);
    const toggle = screen.getByRole("button", { name: "Notifications" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const finished = screen.getByRole("checkbox", {
      name: "A chat Gravita runs finishes its turn",
    });
    expect(screen.getAllByRole("checkbox").map((c) => (c as HTMLInputElement).checked)).toEqual([
      true,
      true,
      true,
    ]);
    fireEvent.click(finished);
    expect((finished as HTMLInputElement).checked).toBe(false);

    // Escape closes it; reopening shows the remembered choice.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(toggle);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "A chat Gravita runs finishes its turn",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });
});

describe("NoticeLine", () => {
  afterEach(() => vi.useRealTimers());

  it("shows the kill switch's result calmly and clears itself", () => {
    vi.useFakeTimers();
    const { store } = renderWithApp(<NoticeLine />);
    act(() => store.getState().showNotice("notice.stopped", { count: 2 }));
    expect(screen.getByRole("status").textContent).toContain("Stopped 2 Gravita sessions.");
    act(() => vi.advanceTimersByTime(NOTICE_MS));
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("can be dismissed", () => {
    const { store } = renderWithApp(<NoticeLine />);
    act(() => store.getState().showNotice("notice.stoppedNone"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
