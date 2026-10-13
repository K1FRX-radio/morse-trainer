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
6. the workflow explicitly dispatches a fresh supervisor review;
7. the loop stops on approval, owner escalation, or the repair-round limit.

The workflow never merges.

## Why explicit dispatch is used

GitHub suppresses most workflow recursion for events created with the repository
`GITHUB_TOKEN`. Automated repair pushes therefore explicitly invoke
`workflow_dispatch` for the next supervisor pass rather than assuming the push
will create another run.

## Required secret

Create a repository Actions secret named:

`OPENAI_API_KEY`

The workflow uses the official OpenAI Codex GitHub Action. API usage is billed
through the API account associated with that key; a ChatGPT subscription does
not by itself provide an Actions API credential.

Do not place the key in repository files, variables, PR text, prompts, or logs.

## Security boundary

The model-bearing jobs run only for same-repository PRs.

The supervisor uses Codex's read-only permission profile.

The repair agent uses the workspace permission profile. It does not receive a
GitHub token while Codex is running. Git credentials are not persisted by
checkout. A later fixed shell step commits/pushes the resulting workspace with
Git hooks disabled.

Fork PRs are intentionally excluded from this loop.

The Codex Action is pinned to a reviewed commit rather than a floating tag.

## Workflow state

The workflow maintains these labels:

- `agent:working`
- `review:changes-requested`
- `review:approved`
- `owner:decision`

Supervisor comments include a hidden machine marker so review rounds can be
counted deterministically.

After five automatic requested-change rounds, the workflow stops and escalates
to `owner:decision` rather than continuing indefinitely.

## Owner responsibilities

The owner is expected to intervene only when:

- `owner:decision` is set;
- roadmap/acceptance/product intent changes;
- final merge/release authority is needed.

An approved PR still waits for CI and explicit merge authority.

## Disabling or recovering the loop

To stop automatic model work immediately, disable the **Agent supervisor loop**
workflow in GitHub Actions or remove/disable the `OPENAI_API_KEY` secret.

A failed automation run does not merge or rewrite `main`. The PR branch remains
the recovery point and can be continued manually.

If an automated repair produces no changes for a requested-change review, the
workflow escalates instead of repeatedly retrying the same state.
