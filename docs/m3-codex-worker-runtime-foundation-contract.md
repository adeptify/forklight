# M3 Codex Worker Runtime foundation contract

## User outcome

A saved ForkLight Worker can select `runtime=codex-cli`, one explicit Codex
model, and one supported reasoning effort. ForkLight launches that Worker in
the Task's isolated workspace, receives machine-readable progress and terminal
usage, and keeps Main responsible for verification, acceptance, and
Integration.

This first slice establishes the executable foundation. It does not yet claim
the full Hub editing and resume experience described in `PROJECT.md`.

## Verified local inputs

- Local executable: `codex-cli 0.146.0`.
- Official non-interactive interface: `codex exec --json`; JSONL includes
  `thread.started`, item lifecycle, terminal success/failure, and terminal
  usage.
- `--ignore-user-config` keeps authentication but excludes mutable personal
  configuration; `--ignore-rules` excludes personal/project exec-policy rules.
- One run selects `--model` and `model_reasoning_effort` explicitly.
- Local `models_cache.json` publishes each visible model's exact supported
  reasoning levels. `ultra` is deliberately rejected because it may delegate
  work outside ForkLight's Worker accounting.
- A task-local Codex home containing only mode-0600 auth plus the safe model
  catalog completed a real `gpt-5.6-luna` / `low` JSONL probe. WebSocket
  attempts timed out, HTTPS fallback succeeded, and terminal usage was present.

## Modules

### Runtime and Provider identity

Consumes a saved Worker selection and produces the immutable identity
`openai + codex-cli + model + effort`. `codex-cli` may pair only with `openai`;
`openai` may pair only with `codex-cli`. Existing Claude and Grok pairings stay
unchanged.

### Model/effort contract

An optional closed `supportedEfforts` list belongs to a saved model config.
When present, Worker Profile validation rejects an unsupported effort before a
Task is created. Existing model configs without this field remain compatible.
The initial OpenAI model config is sourced from a bounded local catalog
projection; no prompt, token, account, or credential data is copied into
settings or Hub responses.

### Codex Runtime adapter

Consumes the bounded Task prompt, workspace, exact model/effort, edit policy,
and Task runtime home. It produces normalized progress, session identity,
terminal result, and exact terminal Token counters.

The adapter must:

- seed a Task-only Codex home with the minimum auth and safe catalog files,
  both mode 0600;
- use `--ignore-user-config`, `--ignore-rules`, `--json`, explicit model,
  explicit effort, `approval_policy=never`, disabled apps/multi-agent/web, and
  `project_doc_max_bytes=0`;
- select `workspace-write` only for editable Tasks and `read-only` otherwise;
- never enable `danger-full-access`, `ultra`, plugins, MCP, web, nested agents,
  or extra writable roots;
- expose the same spawn/interruption/no-progress hooks as other Workers;
- report missing/malformed usage as unavailable rather than estimating it;
- reject resume in this foundation slice instead of silently starting a fresh
  session.

### Readiness

Doctor/readiness consumes only executable/version, `codex login status`, safe
model catalog metadata, and the saved model/effort. It produces a bounded ready
or needs-attention result. It never reads or returns credential contents.

## Call chain

1. Settings validate the saved OpenAI model and Codex Worker Profile.
2. Task resolution freezes provider, runtime, model, effort, and limits.
3. Launch authentication proves local Codex sign-in before workspace mutation.
4. Runner dispatches to the Codex adapter.
5. Adapter seeds Task-only auth, launches non-interactive JSONL in the isolated
   workspace, and normalizes events and usage.
6. Existing ForkLight verification creates the Candidate and decides machine
   success; Main then reviews and may authorize Integration.

## Acceptance

1. Runtime registry, Provider pairing, defaults, model catalog, Worker Profile,
   Task parsing, routing identity, and policy capability accept `codex-cli`
   without changing existing identities.
2. Unsupported model/effort pairs and `ultra` fail before Task creation.
3. Adapter arguments are exact, least-privilege, and contain no user config,
   MCP, web, nested agent, full-access, or silent fallback path.
4. A strict normalizer maps representative Codex JSONL and terminal usage;
   malformed/duplicate terminal evidence fails closed.
5. Task-local auth seeding copies only allowed files with private permissions
   and never logs contents or source paths.
6. Focused tests, build, full suite, and `git diff --check` pass. Main reviews
   the Candidate before any Integration; commit and push remain forbidden.

## Out of scope for this slice

- Hub model import/editor polish, Main-client installation, pricing, Provider
  probe network requests, Competition, resume/recovery, direct-Main calibration,
  automatic Integration, commit, push, and all non-ForkLight repositories.
- No changes to existing Claude/Grok Provider behavior or saved identities.

