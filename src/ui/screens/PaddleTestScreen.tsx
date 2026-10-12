import { useEffect, useState } from "react";
import {
  attachKeyboardPaddle,
  type PaddleInputEvent,
} from "../../input/paddle-keyboard.ts";

const MAX_LOG = 12;

export function PaddleTestScreen() {
  const [ditDown, setDitDown] = useState(false);
  const [dahDown, setDahDown] = useState(false);
  const [events, setEvents] = useState<PaddleInputEvent[]>([]);

  useEffect(
    () =>
      attachKeyboardPaddle({
        onEvent: (event) => {
          if (event.channel === "dit") setDitDown(event.action === "down");
          if (event.channel === "dah") setDahDown(event.action === "down");
          setEvents((current) => [...current.slice(-(MAX_LOG - 1)), event]);
        },
      }),
    [],
  );

  return (
    <section>
      <h2>USB paddle test</h2>
      <p>
        Compatibility spike for the K1FRX paddle adapter. Current Rev 0 firmware
        should expose DIT as <kbd>A</kbd> and DAH as <kbd>B</kbd>.
      </p>

      <div className="paddle-test__contacts" aria-label="Paddle contact state">
        <div
          className={`paddle-test__contact ${ditDown ? "is-down" : ""}`}
          data-testid="dit-contact"
        >
          <strong>DIT</strong>
          <span>{ditDown ? "DOWN" : "UP"}</span>
        </div>
        <div
          className={`paddle-test__contact ${dahDown ? "is-down" : ""}`}
          data-testid="dah-contact"
        >
          <strong>DAH</strong>
          <span>{dahDown ? "DOWN" : "UP"}</span>
        </div>
      </div>

      <p className="field__label">
        The page records raw press/release edges. It does not decode Morse or
        perform iambic keying.
      </p>

      <h3>Recent events</h3>
      {events.length === 0 ? (
        <p className="field__label">Press either paddle to begin.</p>
      ) : (
        <ol className="paddle-test__log">
          {events.map((event, index) => (
            <li key={`${event.timestamp}-${index}`}>
              {event.channel.toUpperCase()} {event.action} ·{" "}
              {event.timestamp.toFixed(1)} ms
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
