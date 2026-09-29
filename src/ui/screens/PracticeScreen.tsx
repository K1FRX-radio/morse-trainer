import { useState } from "react";
import { useNavigationGuard } from "../navigation-guard-context.ts";
import { CopyPractice } from "./CopyPractice.tsx";
import { ImportedTextPractice } from "./ImportedTextPractice.tsx";
import { SendPractice } from "./SendPractice.tsx";

type Tab = "copy" | "send" | "imported";

export function PracticeScreen() {
  const [tab, setTab] = useState<Tab>("copy");
  const { blocked } = useNavigationGuard();

  return (
    <section>
      <h2>Practice</h2>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "copy"}
          className={tab === "copy" ? "tab is-active" : "tab"}
          disabled={blocked && tab !== "copy"}
          onClick={() => setTab("copy")}
        >
          Copy
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "send"}
          className={tab === "send" ? "tab is-active" : "tab"}
          disabled={blocked && tab !== "send"}
          onClick={() => setTab("send")}
        >
          Send
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "imported"}
          className={tab === "imported" ? "tab is-active" : "tab"}
          disabled={blocked && tab !== "imported"}
          onClick={() => setTab("imported")}
        >
          Text RX
        </button>
      </div>

      {tab === "copy" ? (
        <CopyPractice />
      ) : tab === "send" ? (
        <SendPractice />
      ) : (
        <ImportedTextPractice />
      )}
    </section>
  );
}
