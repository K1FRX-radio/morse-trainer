import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { useNavigationGuard } from "./ui/navigation-guard-context.ts";

function BlockingPracticeScreen() {
  const { setBlocked } = useNavigationGuard();
  useEffect(() => {
    setBlocked(true);
    return () => {
      setBlocked(false);
    };
  }, [setBlocked]);
  return <h2>Practice</h2>;
}

vi.mock("./ui/screens/LearnScreen.tsx", () => ({
  LearnScreen: () => <h2>Learn</h2>,
}));

vi.mock("./ui/screens/PracticeScreen.tsx", () => ({
  PracticeScreen: BlockingPracticeScreen,
}));

vi.mock("./ui/screens/StatsHistoryScreen.tsx", () => ({
  StatsHistoryScreen: () => <h2>History</h2>,
}));

vi.mock("./ui/screens/SettingsScreen.tsx", () => ({
  SettingsScreen: () => <h2>Settings</h2>,
}));

describe("App PWA update safety", () => {
  it("does not allow update activation while navigation is blocked", async () => {
    const applyUpdate = vi.fn();

    render(
      <MemoryRouter initialEntries={["/practice"]}>
        <App
          pwaNotice={{
            offlineReady: false,
            updateReady: true,
            activatingUpdate: false,
            applyUpdate,
          }}
        />
      </MemoryRouter>,
    );

    const updateButton = await screen.findByRole("button", {
      name: "Update now",
    });
    expect(updateButton).toBeDisabled();
    expect(
      screen.getByText("Finish or save current training before updating."),
    ).toBeInTheDocument();

    act(() => {
      fireEvent.click(updateButton);
    });

    expect(applyUpdate).toHaveBeenCalledTimes(0);
  });
});
