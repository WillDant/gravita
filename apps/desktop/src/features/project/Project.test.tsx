import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { PROJECT, SQ, squadFixture } from "@/test/squadFixtures";
import { Project } from "./Project";

afterEach(cleanup);
setLocale("en");

describe("Project", () => {
  it("lists a squad as one row and keeps its role sessions inside it", async () => {
    const { navigate } = renderWithApp(<Project projectId={PROJECT} />, {
      state: squadFixture("run").state,
    });
    await act(flush);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("Squad · 3 roles");
    expect(rows[0]?.textContent).toContain("Waiting for you");
    expect(rows[0]?.textContent).toContain("3 of 8 tasks done");
    fireEvent.click(rows[0] as HTMLElement);
    expect(navigate).toHaveBeenCalledWith({ level: "squad", projectId: PROJECT, squadId: SQ });
  });

  it("opens the new squad panel next to New session", async () => {
    renderWithApp(<Project projectId={PROJECT} />, { state: squadFixture("run").state });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New squad" }));
      await flush();
    });
    expect(screen.getByRole("heading", { name: "New squad" })).toBeTruthy();
    expect(screen.getByLabelText("Folder").textContent).toContain("/work/todo");
  });
});
