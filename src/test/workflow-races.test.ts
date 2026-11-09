// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

interface WorkflowStep {
  name?: string;
  id?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
  run?: string;
}

interface Workflow {
  jobs: Record<
    string,
    { outputs?: Record<string, string>; steps: WorkflowStep[] }
  >;
}

function readWorkflow(name: string): Workflow {
  return parse(
    readFileSync(
      new URL(`../../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    ),
  ) as Workflow;
}

const ci = readWorkflow("ci");
const supervisor = readWorkflow("agent-supervisor");
const verifiedSha = "a".repeat(40);
const newerSha = "b".repeat(40);
const marker = (kind: string, sha = verifiedSha) =>
  `<!-- ${kind} head=${sha} -->`;
const botComment = (body: string) => ({
  body,
  user: { login: "github-actions[bot]", type: "Bot" },
});

function createHarness(initialHead = verifiedSha) {
  const pull = {
    head: { sha: initialHead, repo: { full_name: "owner/repo" } },
    state: "open",
    draft: false,
  };
  const comments: ReturnType<typeof botComment>[] = [];
  const issues = {
    listComments: vi.fn(),
    createComment: vi.fn(async (comment: { body: string }) => {
      comments.push(botComment(comment.body));
    }),
    createLabel: vi.fn(),
    addLabels: vi.fn(),
    removeLabel: vi.fn(),
  };
  const github = {
    rest: { pulls: { get: vi.fn(async () => ({ data: pull })) }, issues },
    paginate: vi.fn(async () => [...comments]),
  };
  const core = { setOutput: vi.fn() };

  async function run(step: WorkflowStep, env: Record<string, string> = {}) {
    expect(step.with?.script).toBeTruthy();
    const execute = new Function(
      "github",
      "context",
      "core",
      "process",
      `return (async () => { ${step.with?.script} })();`,
    );
    await execute(github, { repo: { owner: "owner", repo: "repo" } }, core, {
      env: {
        PR_NUMBER: "76",
        OWNER_LOGIN: "owner",
        VERIFIED_SHA: verifiedSha,
        ...env,
      },
    });
  }

  return { pull, comments, github, issues, core, run };
}

describe("CI commit identity", () => {
  const report = ci.jobs["report-pr-state"].steps[0];

  it("exports the actual checkout SHA and validates PR heads, not merge refs", () => {
    const verify = ci.jobs.verify;
    expect(verify.outputs?.verified_sha).toBe(
      "${{ steps.checkout-sha.outputs.sha }}",
    );
    expect(verify.steps[0].with?.ref).toBe(
      "${{ github.event.pull_request.head.sha || github.sha }}",
    );
    const captureIndex = verify.steps.findIndex(
      (step) => step.id === "checkout-sha",
    );
    expect(captureIndex).toBeGreaterThan(1);
    expect(captureIndex).toBeLessThan(
      verify.steps.findIndex((step) => step.run === "npm ci"),
    );
    expect(verify.steps[captureIndex].run).toContain("git rev-parse HEAD");
    expect(report.env?.VERIFIED_SHA).toBe(
      "${{ needs.verify.outputs.verified_sha }}",
    );
  });

  it("does not report green or readiness when the head changed during CI", async () => {
    const harness = createHarness(newerSha);
    harness.comments.push(
      botComment(marker("agent-supervisor:approve", newerSha)),
    );
    await harness.run(report);
    expect(harness.issues.createComment).not.toHaveBeenCalled();
    expect(harness.issues.addLabels).not.toHaveBeenCalled();
  });

  it("requires approval for the verified commit", async () => {
    const harness = createHarness();
    harness.comments.push(
      botComment(marker("agent-supervisor:approve", newerSha)),
    );
    await harness.run(report);
    expect(harness.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(marker("agent-ci:green")),
      }),
    );
    expect(harness.issues.addLabels).not.toHaveBeenCalled();
  });

  it("marks an unchanged approved and verified commit ready only once", async () => {
    const harness = createHarness();
    harness.comments.push(botComment(marker("agent-supervisor:approve")));
    await harness.run(report);
    await harness.run(report);
    expect(harness.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["owner:merge-ready"] }),
    );
    expect(harness.issues.createComment).toHaveBeenCalledTimes(2);
  });

  it("does not label a head that changes while the green marker is written", async () => {
    const harness = createHarness();
    harness.comments.push(botComment(marker("agent-supervisor:approve")));
    harness.issues.createComment.mockImplementationOnce(async () => {
      harness.pull.head.sha = newerSha;
    });
    await harness.run(report);
    expect(harness.issues.addLabels).not.toHaveBeenCalled();
    expect(harness.issues.createComment).toHaveBeenCalledTimes(1);
  });

  it("removes readiness if the head changes during the label write", async () => {
    const harness = createHarness();
    harness.comments.push(botComment(marker("agent-supervisor:approve")));
    harness.issues.addLabels.mockImplementationOnce(async () => {
      harness.pull.head.sha = newerSha;
    });
    await harness.run(report);
    expect(harness.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "owner:merge-ready" }),
    );
    expect(harness.issues.createComment).toHaveBeenCalledTimes(1);
  });

  it.each(["fork", "draft", "closed", "missing SHA"])(
    "does not report a %s PR as validated",
    async (reason) => {
      const harness = createHarness();
      if (reason === "fork") harness.pull.head.repo.full_name = "fork/repo";
      if (reason === "draft") harness.pull.draft = true;
      if (reason === "closed") harness.pull.state = "closed";
      await harness.run(report, {
        VERIFIED_SHA: reason === "missing SHA" ? "" : verifiedSha,
      });
      expect(harness.issues.createComment).not.toHaveBeenCalled();
      expect(harness.issues.addLabels).not.toHaveBeenCalled();
    },
  );

  it("ignores approval markers not authored by the workflow bot", async () => {
    const harness = createHarness();
    harness.comments.push({
      body: marker("agent-supervisor:approve"),
      user: { login: "contributor", type: "User" },
    });
    await harness.run(report);
    expect(harness.issues.addLabels).not.toHaveBeenCalled();
  });

  it("sees approval published while CI is recording green", async () => {
    const harness = createHarness();
    harness.issues.createComment.mockImplementationOnce(async ({ body }) => {
      harness.comments.push(botComment(body));
      harness.comments.push(botComment(marker("agent-supervisor:approve")));
    });
    await harness.run(report);
    expect(harness.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["owner:merge-ready"] }),
    );
  });
});

describe("supervisor commit identity", () => {
  const prepare = supervisor.jobs["prepare-state"].steps[0];
  const route = supervisor.jobs.route.steps[0];
  const reviewEnv = (verdict = "approve") => ({
    REVIEW_JSON: JSON.stringify({ verdict, summary: "Review", findings: [] }),
    HEAD_SHA: verifiedSha,
    EXPECTED_HEAD_SHA: verifiedSha,
    MAX_REPAIR_ROUNDS: "5",
  });

  it("ignores an outdated PR event before changing state", async () => {
    const harness = createHarness(newerSha);
    await harness.run(prepare, { EVENT_HEAD_SHA: verifiedSha });
    expect(harness.core.setOutput).toHaveBeenCalledWith("eligible", "false");
    expect(harness.issues.removeLabel).not.toHaveBeenCalled();
    expect(harness.issues.addLabels).not.toHaveBeenCalled();
  });

  it("pins review and repair to the captured head and carries the reviewed SHA", () => {
    const review = supervisor.jobs.review;
    const contextStep = review.steps.find(
      (step) => step.id === "review-context",
    );
    expect(contextStep?.env?.EXPECTED_HEAD_SHA).toBe(
      "${{ needs.prepare-state.outputs.head_sha }}",
    );
    expect(contextStep?.run).toContain(
      'test "$(git rev-parse "refs/remotes/origin/pr-$PR_NUMBER")" = "$EXPECTED_HEAD_SHA"',
    );
    expect(contextStep?.run).toContain(
      'git checkout --detach "$EXPECTED_HEAD_SHA"',
    );
    expect(contextStep?.run).toContain('echo "head_sha=$(git rev-parse HEAD)"');
    expect(review.outputs?.reviewed_sha).toBe(
      "${{ steps.review-context.outputs.head_sha }}",
    );
    expect(route.env?.HEAD_SHA).toBe(
      "${{ needs.review.outputs.reviewed_sha }}",
    );

    const repair = supervisor.jobs.repair.steps.find((step) =>
      step.name?.startsWith("Check out PR branch"),
    );
    expect(repair?.env?.EXPECTED_HEAD_SHA).toBe(
      "${{ needs.review.outputs.reviewed_sha }}",
    );
    expect(repair?.env?.REVIEW_JSON).toBe(
      "${{ needs.review.outputs.review_json }}",
    );
    expect(repair?.run).toContain(
      'git checkout -B "$head_ref" "$EXPECTED_HEAD_SHA"',
    );
    expect(repair?.run).toContain("printf '%s\\n' \"$REVIEW_JSON\"");

    const publish = supervisor.jobs.repair.steps.at(-1);
    expect(publish?.env?.EXPECTED_HEAD_SHA).toBe(
      "${{ needs.review.outputs.reviewed_sha }}",
    );
    expect(publish?.run).toContain(
      'test "$(git rev-parse HEAD)" = "$EXPECTED_HEAD_SHA"',
    );
    expect(publish?.run).toContain(
      '--force-with-lease="refs/heads/$HEAD_REF:$EXPECTED_HEAD_SHA"',
    );
  });

  it.each(["approve", "changes_requested", "owner_decision"])(
    "discards stale %s results without changing labels or launching repair",
    async (verdict) => {
      const harness = createHarness(newerSha);
      harness.comments.push(botComment(marker("agent-ci:green")));
      await harness.run(route, reviewEnv(verdict));
      expect(harness.issues.createComment).not.toHaveBeenCalled();
      expect(harness.issues.addLabels).not.toHaveBeenCalled();
      expect(harness.issues.removeLabel).not.toHaveBeenCalled();
      expect(harness.core.setOutput).not.toHaveBeenCalled();
    },
  );

  it("rejects a reviewed checkout different from the prepared head", async () => {
    const harness = createHarness();
    await harness.run(route, { ...reviewEnv(), EXPECTED_HEAD_SHA: newerSha });
    expect(harness.issues.createComment).not.toHaveBeenCalled();
    expect(harness.core.setOutput).not.toHaveBeenCalled();
  });

  it.each(["other commit", "untrusted author"])(
    "does not accept CI green from an %s",
    async (reason) => {
      const harness = createHarness();
      harness.comments.push({
        body: marker(
          "agent-ci:green",
          reason === "other commit" ? newerSha : verifiedSha,
        ),
        user:
          reason === "untrusted author"
            ? { login: "contributor", type: "User" }
            : { login: "github-actions[bot]", type: "Bot" },
      });
      await harness.run(route, reviewEnv());
      expect(harness.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({ labels: ["review:approved"] }),
      );
      expect(harness.issues.addLabels).not.toHaveBeenCalledWith(
        expect.objectContaining({ labels: ["owner:merge-ready"] }),
      );
    },
  );

  it("sees CI green recorded while approval is being published", async () => {
    const harness = createHarness();
    harness.issues.createComment.mockImplementationOnce(async ({ body }) => {
      harness.comments.push(botComment(body));
      harness.comments.push(botComment(marker("agent-ci:green")));
    });
    await harness.run(route, reviewEnv());
    expect(harness.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["owner:merge-ready"] }),
    );
    expect(harness.core.setOutput).toHaveBeenCalledWith("verdict", "approve");
  });

  it("clears stale approval if a push happens while publishing the verdict", async () => {
    const harness = createHarness();
    harness.comments.push(botComment(marker("agent-ci:green")));
    harness.issues.createComment.mockImplementationOnce(async () => {
      harness.pull.head.sha = newerSha;
    });
    await harness.run(route, reviewEnv());
    expect(harness.issues.addLabels).not.toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["owner:merge-ready"] }),
    );
    expect(harness.issues.removeLabel).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "owner:merge-ready" }),
    );
    expect(harness.core.setOutput).not.toHaveBeenCalled();
  });

  it("removes readiness if the PR changes during its label write", async () => {
    const harness = createHarness();
    harness.comments.push(botComment(marker("agent-ci:green")));
    harness.issues.addLabels.mockImplementation(async ({ labels }) => {
      if (labels.includes("owner:merge-ready"))
        harness.pull.head.sha = newerSha;
    });
    await harness.run(route, reviewEnv());
    expect(harness.issues.removeLabel).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "owner:merge-ready" }),
    );
    expect(harness.issues.createComment).toHaveBeenCalledTimes(1);
    expect(harness.core.setOutput).not.toHaveBeenCalled();
  });

  it.each([4, 5])(
    "preserves the five-round repair limit after %i prior rounds",
    async (rounds) => {
      const harness = createHarness();
      for (let round = 0; round < rounds; round += 1) {
        harness.comments.push(
          botComment(marker("agent-supervisor:changes_requested")),
        );
      }
      await harness.run(route, reviewEnv("changes_requested"));
      expect(route.env?.MAX_REPAIR_ROUNDS).toBe("5");
      expect(harness.core.setOutput).toHaveBeenCalledWith(
        "verdict",
        rounds === 5 ? "owner_decision" : "changes_requested",
      );
    },
  );
});
