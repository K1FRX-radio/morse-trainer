import { useStatsHistory } from "../hooks/useStatsHistory.ts";
import { useSettings } from "../settings-context.ts";

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
  const { settings } = useSettings();
  const {
    loading,
    error,
    summary,
    windows,
    streaks,
    trends,
    currentCharacter,
    activeCharacters,
    recentConfusions,
    milestones,
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
    trends.length === 0;

  return (
    <section>
      <h2>History</h2>
      <p className="stats__note">
        Progress dashboard from bounded analytics projections.
      </p>

      {empty && (
        <p className="stats__empty">
          No training history yet. Complete a Learn or Practice session to see
          summary stats here.
        </p>
      )}

      <div className="stats__summary-grid" aria-label="Overall summary">
        <article className="stats__card">
          <h3>Current character</h3>
          <p>{currentCharacter ?? "N/A"}</p>
        </article>
        <article className="stats__card">
          <h3>Current WPM</h3>
          <p>
            {settings.charWpm} / {settings.effectiveWpm}
          </p>
        </article>
        <article className="stats__card">
          <h3>Today active time</h3>
          <p>{formatDuration(windows.today.activeMs)}</p>
        </article>
        <article className="stats__card">
          <h3>This week active time</h3>
          <p>{formatDuration(windows.thisWeek.activeMs)}</p>
        </article>
        <article className="stats__card">
          <h3>All-time active time</h3>
          <p>{formatDuration(windows.allTime.activeMs)}</p>
        </article>
        <article className="stats__card">
          <h3>Eligible sessions</h3>
          <p>{windows.allTime.sessionCount}</p>
        </article>
        <article className="stats__card">
          <h3>Avg session duration</h3>
          <p>
            {windows.allTime.averageSessionDurationMs === null
              ? "N/A"
              : formatDuration(windows.allTime.averageSessionDurationMs)}
          </p>
        </article>
        <article className="stats__card">
          <h3>Practice days</h3>
          <p>{streaks.practiceDayCount}</p>
        </article>
        <article className="stats__card">
          <h3>Current streak</h3>
          <p>{streaks.currentStreakDays}</p>
        </article>
        <article className="stats__card">
          <h3>Longest streak</h3>
          <p>{streaks.longestStreakDays}</p>
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
      </div>

      <h3>30-day trends</h3>
      {trends.length === 0 ? (
        <p className="stats__note">No daily activity yet.</p>
      ) : (
        <ul className="stats__list" aria-label="30-day trends">
          {[...trends].reverse().map((row) => (
            <li key={row.localDate} className="stats__list-row">
              <strong>{row.localDate}</strong>
              <span>Active {formatDuration(row.activeMs)}</span>
              <span>Sessions {row.sessionCount}</span>
              <span>Avg WPM {formatWpm(row.averageEffectiveWpm)}</span>
              <span>RX {formatAccuracy(row.rx.accuracy)}</span>
              <span>TX {formatAccuracy(row.tx.accuracy)}</span>
            </li>
          ))}
        </ul>
      )}

      <h3>Current character metrics</h3>
      {activeCharacters.length === 0 ? (
        <p className="stats__note">No character-level observations yet.</p>
      ) : (
        <ul className="stats__list" aria-label="Current character metrics">
          {activeCharacters.map((row) => (
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
                  RX response median {Math.round(row.rxResponseTime.medianMs)}ms
                  ({row.rxResponseTime.samples} samples)
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Recent confusions</h3>
      {recentConfusions.length === 0 ? (
        <p className="stats__note">No recurring confusion pairs yet.</p>
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

      <h3>Latest milestones</h3>
      {milestones.length === 0 ? (
        <p className="stats__note">No milestones yet.</p>
      ) : (
        <ul className="stats__list" aria-label="Latest milestones">
          {milestones.map((row) => (
            <li key={row.id} className="stats__list-row">
              <strong>{row.type}</strong>
              <span>{row.occurredAtUtc}</span>
              {row.character && <span>Character {row.character}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
