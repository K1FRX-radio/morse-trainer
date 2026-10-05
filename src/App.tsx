import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { NavigationGuardContext } from "./ui/navigation-guard-context.ts";
import { LearnScreen } from "./ui/screens/LearnScreen.tsx";
import { PracticeScreen } from "./ui/screens/PracticeScreen.tsx";
import { StatsHistoryScreen } from "./ui/screens/StatsHistoryScreen.tsx";
import { SettingsScreen } from "./ui/screens/SettingsScreen.tsx";

const NAV = [
  { to: "/learn", label: "Learn" },
  { to: "/practice", label: "Practice" },
  { to: "/history", label: "History" },
  { to: "/settings", label: "Settings" },
] as const;

export type StorageLifecycleNotice = {
  message: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
};

export function App({
  storageNotice,
}: {
  storageNotice?: StorageLifecycleNotice;
}) {
  const [navigationBlocked, setNavigationBlocked] = useState(false);

  useEffect(() => {
    if (!navigationBlocked) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [navigationBlocked]);

  return (
    <NavigationGuardContext.Provider
      value={{ blocked: navigationBlocked, setBlocked: setNavigationBlocked }}
    >
      <div className="app">
        <header className="app__header">
          <h1 className="app__title">K1FRX Morse Trainer</h1>
          <p className="app__tagline">Learn CW by ear.</p>
          {storageNotice && (
            <div
              className="feedback feedback--neutral app__notice"
              role="alert"
            >
              <p>{storageNotice.message}</p>
              {storageNotice.onAction && storageNotice.actionLabel && (
                <button
                  type="button"
                  onClick={storageNotice.onAction}
                  disabled={storageNotice.actionDisabled}
                >
                  {storageNotice.actionLabel}
                </button>
              )}
            </div>
          )}
        </header>

        <main className="app__main">
          <Routes>
            <Route path="/" element={<Navigate to="/learn" replace />} />
            <Route path="/learn" element={<LearnScreen />} />
            <Route path="/practice" element={<PracticeScreen />} />
            <Route path="/history" element={<StatsHistoryScreen />} />
            <Route
              path="/progress"
              element={<Navigate to="/history" replace />}
            />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to="/learn" replace />} />
          </Routes>
        </main>

        <nav className="app__nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              aria-disabled={navigationBlocked}
              onClick={(event) => {
                if (navigationBlocked) event.preventDefault();
              }}
              className={({ isActive }) => (isActive ? "is-active" : "")}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </NavigationGuardContext.Provider>
  );
}
