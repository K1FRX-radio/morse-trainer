import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { useReloadSafety } from "./ui/reload-safety-context.ts";

type SessionState = "active" | "completed";

const { resetSessionStates, setSessionState, getSessionState } = vi.hoisted(
  () => {
    const sessionStates: Record<"learn" | "copy" | "send", SessionState> = {
      learn: "completed",
      copy: "completed",
      send: "completed",
    };

    return {
      resetSessionStates: () => {
        sessionStates.learn = "completed";
        sessionStates.copy = "completed";
        sessionStates.send = "completed";
      },
      setSessionState: (
        session: "learn" | "copy" | "send",
        state: SessionState,
      ) => {
        sessionStates[session] = state;
      },
      getSessionState: (session: "learn" | "copy" | "send") =>
        sessionStates[session],
    };
  },
);

function GuardedScreen({
  session,
  title,
}: {
  session: "learn" | "copy" | "send";
  title: string;
}) {
  const { setBlocked } = useReloadSafety();

  useEffect(() => {
    setBlocked(getSessionState(session) === "active");
    return () => {
      setBlocked(false);
    };
  }, [session, setBlocked]);

  return <h2>{title}</h2>;
}

function MockPracticeScreen() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const sessionParam = params.get("session");
  const session = sessionParam === "send" ? "send" : "copy";
  const title = session === "send" ? "Send Practice" : "Copy Practice";

  return <GuardedScreen session={session} title={title} />;
}

vi.mock("./ui/screens/LearnScreen.tsx", () => ({
  LearnScreen: () => <GuardedScreen session="learn" title="Learn" />,
}));

vi.mock("./ui/screens/PracticeScreen.tsx", () => ({
  PracticeScreen: MockPracticeScreen,
}));

vi.mock("./ui/screens/StatsHistoryScreen.tsx", () => ({
  StatsHistoryScreen: () => <h2>History</h2>,
}));

vi.mock("./ui/screens/SettingsScreen.tsx", () => ({
  SettingsScreen: () => <h2>Settings</h2>,
}));

describe("App PWA update safety", () => {
  beforeEach(() => {
    resetSessionStates();
  });

  const routes = [
    { label: "Learn", entry: "/learn", session: "learn" as const },
    {
      label: "CopyPractice",
      entry: "/practice?session=copy",
      session: "copy" as const,
    },
    {
      label: "SendPractice",
      entry: "/practice?session=send",
      session: "send" as const,
    },
  ];

  for (const route of routes) {
    it(`keeps update activation blocked during active ${route.label} sessions`, async () => {
      setSessionState(route.session, "active");
      const applyUpdate = vi.fn();

      render(
        <MemoryRouter initialEntries={[route.entry]}>
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

      fireEvent.click(updateButton);
      expect(applyUpdate).toHaveBeenCalledTimes(0);
    });

    it(`allows update activation after ${route.label} sessions are completed`, async () => {
      setSessionState(route.session, "completed");
      const applyUpdate = vi.fn();

      render(
        <MemoryRouter initialEntries={[route.entry]}>
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
      expect(updateButton).toBeEnabled();
      expect(
        screen.queryByText("Finish or save current training before updating."),
      ).toBeNull();

      fireEvent.click(updateButton);
      expect(applyUpdate).toHaveBeenCalledTimes(1);
    });
  }

  it("preserves ordinary navigation behavior while reload safety is active", async () => {
    setSessionState("learn", "active");

    render(
      <MemoryRouter initialEntries={["/learn"]}>
        <App
          pwaNotice={{
            offlineReady: false,
            updateReady: true,
            activatingUpdate: false,
            applyUpdate: vi.fn(),
          }}
        />
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Update now" });
    expect(screen.getByRole("link", { name: "Practice" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });
});
