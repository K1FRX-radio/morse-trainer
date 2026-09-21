import { NavLink, Navigate, Route, Routes } from "react-router-dom";

const NAV = [
  { to: "/learn", label: "Learn" },
  { to: "/practice", label: "Practice" },
  { to: "/progress", label: "Progress" },
  { to: "/settings", label: "Settings" },
] as const;

function Placeholder({ title }: { title: string }) {
  return (
    <section>
      <h2>{title}</h2>
      <p style={{ color: "var(--k1frx-muted)" }}>
        Coming soon. The tested pure core (Morse, timing, curriculum, scheduler)
        is in place; screens are built in later milestones.
      </p>
    </section>
  );
}

export function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">K1FRX Morse Trainer</h1>
        <p className="app__tagline">Learn CW by ear.</p>
      </header>

      <main className="app__main">
        <Routes>
          <Route path="/" element={<Navigate to="/learn" replace />} />
          <Route path="/learn" element={<Placeholder title="Learn" />} />
          <Route path="/practice" element={<Placeholder title="Practice" />} />
          <Route path="/progress" element={<Placeholder title="Progress" />} />
          <Route path="/settings" element={<Placeholder title="Settings" />} />
          <Route path="*" element={<Navigate to="/learn" replace />} />
        </Routes>
      </main>

      <nav className="app__nav">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? "is-active" : "")}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
