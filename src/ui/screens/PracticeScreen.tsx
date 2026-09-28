import { useState } from "react";
import { useNavigationGuard } from "../navigation-guard-context.ts";
import { CopyPractice } from "./CopyPractice.tsx";
import { SendPractice } from "./SendPractice.tsx";

type Tab = "copy" | "send";

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
      </div>

      {tab === "copy" ? <CopyPractice /> : <SendPractice />}
    </section>
  );
}
