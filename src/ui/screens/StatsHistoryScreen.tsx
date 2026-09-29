import { useStatsHistory } from "../hooks/useStatsHistory.ts";

function formatAccuracy(value: number | null): string {
  if (value === null) return "N/A";
  return `${Math.round(value * 100)}%`;
}

function formatDuration(activeMs: number): string {
  const totalSeconds = Math.floor(activeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatWpm(value: number | null): string {
  if (value === null) return "N/A";
  return value.toFixed(1);
}

export function StatsHistoryScreen() {
  const {
    loading,
    error,
    summary,
    recentDailyRows,
    difficultCharacters,
    recentConfusions,
  } = useStatsHistory();

  if (loading) {
    return (
      <section>
        <h2>History</h2>
        <p className="stats__note">Loading training history...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section>
        <h2>History</h2>
        <p role="alert" className="stats__note">
          Unable to load history: {error}
        </p>
      </section>
    );
  }

  const empty =
    summary.totalSessions === 0 &&
    summary.totalAttempts === 0 &&
    recentDailyRows.length === 0;

  return (
    <section>
      <h2>History</h2>
      <p className="stats__note">Last 30 days of analytics data.</p>

      {empty && (
        <p className="stats__empty">
          No training history yet. Complete a Learn or Practice session to see
          summary stats here.
        </p>
      )}

      <div className="stats__summary-grid" aria-label="Overall summary">
        <article className="stats__card">
          <h3>Active time</h3>
          <p>{formatDuration(summary.totalActiveMs)}</p>
        </article>
        <article className="stats__card">
          <h3>Sessions</h3>
          <p>{summary.totalSessions}</p>
        </article>
        <article className="stats__card">
          <h3>Attempts</h3>
          <p>{summary.totalAttempts}</p>
        </article>
        <article className="stats__card">
          <h3>RX accuracy</h3>
          <p>{formatAccuracy(summary.rx.accuracy)}</p>
        </article>
        <article className="stats__card">
          <h3>TX accuracy</h3>
          <p>{formatAccuracy(summary.tx.accuracy)}</p>
        </article>
        <article className="stats__card">
          <h3>Avg effective WPM</h3>
          <p>{formatWpm(summary.averageEffectiveWpm)}</p>
        </article>
        <article className="stats__card">
          <h3>Active days</h3>
          <p>{summary.activeDayCount}</p>
        </article>
      </div>

      <h3>Recent daily activity</h3>
      {recentDailyRows.length === 0 ? (
        <p className="stats__note">No daily activity yet.</p>
      ) : (
        <ul className="stats__list" aria-label="Recent daily activity">
          {recentDailyRows.map((row) => (
            <li key={row.localDate} className="stats__list-row">
              <strong>{row.localDate}</strong>
              <span>Active {formatDuration(row.activeMs)}</span>
              <span>Sessions {row.sessionCount}</span>
              <span>Attempts {row.attemptCount}</span>
              <span>RX {formatAccuracy(row.rx.accuracy)}</span>
              <span>TX {formatAccuracy(row.tx.accuracy)}</span>
              <span>WPM {formatWpm(row.averageEffectiveWpm)}</span>
            </li>
          ))}
        </ul>
      )}

      <h3>Difficult characters</h3>
      {difficultCharacters.length === 0 ? (
        <p className="stats__note">No character-level observations yet.</p>
      ) : (
        <ul className="stats__list" aria-label="Difficult characters">
          {difficultCharacters.map((row) => (
            <li
              key={`${row.direction}:${row.character}`}
              className="stats__list-row"
            >
              <strong>
                {row.character} ({row.direction.toUpperCase()})
              </strong>
              <span>Accuracy {formatAccuracy(row.recentAccuracy)}</span>
              <span>Observations {row.recentObservationCount}</span>
              {row.mostRecentObservationUtc && (
                <span>Recent {row.mostRecentObservationUtc}</span>
              )}
              {row.rxResponseTime && (
                <span>
                  RX response {Math.round(row.rxResponseTime.averageMs)}ms avg (
                  {row.rxResponseTime.samples} samples)
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Recent confusions</h3>
      {recentConfusions.length === 0 ? (
        <p className="stats__note">No confusion pairs yet.</p>
      ) : (
        <ul className="stats__list" aria-label="Recent confusions">
          {recentConfusions.map((row) => (
            <li key={`${row.target}:${row.answer}`} className="stats__list-row">
              <strong>
                {row.target} -&gt; {row.answer}
              </strong>
              <span>Count {row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
