# Event-driven agent supervisor

Issue #75 introduces an event-driven implementation/review loop for trusted,
same-repository pull requests.

## Goal

The repository owner should operate at the product and technical-direction layer,
not relay messages between coding and review agents.

The automated loop is:

1. a PR is opened or its head changes;
2. a read-only supervisor reviews the full PR against repository policy;
3. GitHub records one state:
   - `review:approved`;
   - `review:changes-requested`; or
   - `owner:decision`;
4. requested changes launch a bounded repair agent on the same PR branch;
5. the repair agent validates, commits, and pushes;
6. the workflow explicitly dispatches fresh CI and a fresh supervisor review;
7. the loop stops on approval, owner escalation, or the repair-round limit.

The workflow never merges.

## Why explicit dispatch is used

GitHub suppresses most workflow recursion for events created with the repository
`GITHUB_TOKEN`. Automated repair pushes therefore explicitly invoke
`workflow_dispatch` for both:

- trusted CI validation of the repaired PR head; and
- the next supervisor pass.

The normal CI workflow accepts a PR number only for this trusted manual-dispatch
path and checks out `refs/pull/<number>/head`. Deployment remains limited to a
real push to `main`.

## Required secret

Create a repository Actions secret named:

`OPENAI_API_KEY`

The workflow uses the official OpenAI Codex GitHub Action. API usage is billed
through the API account associated with that key; a ChatGPT subscription does
not by itself provide an Actions API credential.

Do not place the key in repository files, variables, PR text, prompts, or logs.

## Security boundary

The model-bearing jobs run only for same-repository PRs.

The workflow re-checks the PR head repository before exposing the model
credential, including manually dispatched runs.

The supervisor uses Codex's read-only permission profile.

The repair agent uses the workspace permission profile. It does not receive a
GitHub token while Codex is running. Git credentials are not persisted by
checkout. A later fixed shell step commits/pushes the resulting workspace with
Git hooks disabled.

Supervisor and repair jobs capture the trusted base commit before checking out
the PR head. Dependency installation uses `npm ci --ignore-scripts`, so PR and
dependency install lifecycle scripts cannot rewrite policy or other review inputs.
Immediately before each Codex step, the workflow replaces `.agent-policy/` with
policy files read from that pinned base commit; review also restores the output
schema. PR-tracked copies and install-script policy replacements are not used.

Fork PRs are intentionally excluded from this loop.

The Codex Action is pinned to a reviewed commit rather than a floating tag.

The reviewer and repair jobs temporarily pin `ubuntu-24.04` because GitHub's
`ubuntu-latest` is now Ubuntu 26.04, which fails the pinned Codex Action's
`drop-sudo` socket restriction during setup (openai/codex-action#188). This
preserves the restrictive default safety strategy. Revisit the pin after a
verified upstream fix, not by switching to the `unsafe` strategy.

## Workflow state

The workflow maintains these labels:

- `review:pending`
- `agent:working`
- `review:changes-requested`
- `review:approved`
- `owner:decision`
- `owner:merge-ready`

Supervisor comments begin with a hidden machine marker and a fixed review header
with the matching verdict. Only bot-authored comments with that exact leading
format count as review evidence or repair rounds. CI-green and owner-notification
evidence must match their complete fixed publisher bodies. Markers embedded in
model-authored summaries or findings are never evidence. CI uses the latest valid
supervisor verdict for the verified head, not an earlier superseded approval.

After five automatic requested-change rounds, the workflow stops and escalates
to `owner:decision` rather than continuing indefinitely.

## Owner responsibilities

The owner is expected to intervene only when:

- `owner:decision` is set;
- roadmap/acceptance/product intent changes;
- final merge/release authority is needed.

Approval is tied to the exact PR head SHA. The owner is mentioned only when that
same head is both supervisor-approved and CI-green, at which point
`owner:merge-ready` is applied. Merge authority remains explicit.

CI checks out the PR head (not the synthetic merge commit), captures the actual
checkout SHA before validation, and reports only that SHA. If the PR head has
changed, the completed run cannot validate the newer commit. Supervisor review
and repair also pin their checkout to the captured head; stale verdicts are
discarded without starting another repair. A repair push uses an exact-SHA lease
after verifying its parent commit, so a concurrent push or rewind cannot be
overwritten.

Only workflow-bot comments count as CI/review markers. Both publishers refresh
comments after posting their result so concurrent CI and approval can converge
on readiness. They recheck the live head around readiness updates and remove
stale labels if a change is detected. GitHub labels are not commit-scoped or
transactional: a later push can briefly leave an old label visible until the
synchronize workflow resets it. SHA-bearing comments and current-head checks,
not the label alone, are the evidence for the owner's manual merge decision.

## Disabling or recovering the loop

To stop automatic model work immediately, disable the **Agent supervisor loop**
workflow in GitHub Actions or remove/disable the `OPENAI_API_KEY` secret.

A failed automation run does not merge or rewrite `main`. The PR branch remains
the recovery point and can be continued manually.

If an automated repair produces no changes for a requested-change review, the
workflow escalates instead of repeatedly retrying the same state.
