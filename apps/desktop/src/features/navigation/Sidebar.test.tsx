import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { started, stateOf } from "@/test/events";
import { flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { Sidebar } from "./Sidebar";

afterEach(cleanup);
setLocale("en");

const state = stateOf(started("s1", 5, "p1"));

describe("Sidebar", () => {
  it("keeps Home on its own at the top, ahead of the projects", async () => {
    renderWithApp(<Sidebar />, { state });
    await act(flush);
    const nav = screen.getByRole("navigation", { name: "Gravita" });
    const home = screen.getByRole("button", { name: "Home" });
    const heading = screen.getByText("Projects");
    // Home comes before the Projects heading, and nothing else sits between them and the top.
    expect(home.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.contains(home)).toBe(true);
    expect(home.className).toContain("font-semibold");
    expect(screen.queryByRole("button", { name: "Needs you" })).toBeNull();
  });

  it("keeps only Settings and Notifications in the footer, and opens Settings", async () => {
    const { navigate } = renderWithApp(<Sidebar />, { state });
    await act(flush);
    const settings = screen.getByRole("button", { name: "Settings" });
    const heading = screen.getByText("Projects");
    const notifications = screen.getByRole("button", { name: /notif/i });
    expect(
      heading.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(settings.parentElement?.contains(notifications)).toBe(true);
    expect(screen.queryByRole("button", { name: /theme/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(EN|PT)$/ })).toBeNull();
    fireEvent.click(settings);
    expect(navigate).toHaveBeenCalledWith({ level: "settings" });
  });
});
