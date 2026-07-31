# M3 Worker model-processing observability contract

## Outcome

When a Worker is quiet, Main and the Hub can distinguish three different facts:

1. the Worker process started and ForkLight is waiting for the first model signal;
2. the runtime is reporting that the model is actively processing but has not produced visible content yet;
3. the model produced visible content or started a tool.

This prevents ordinary long reasoning from looking like an unexplained stuck process. It does not claim network connectivity, successful implementation progress, or a future result, and it never starts a retry.

## Production and consumption behavior

- Claude-compatible runtimes already emit `system / thinking_tokens` telemetry. Normalize that closed signal as model processing without storing token estimates or raw runtime payloads.
- A high-frequency source must produce at most one durable processing event per bounded interval. The first signal is visible immediately; later signals inside the interval are dropped before Store writes.
- Grok `thought` / `thinking` events mean model processing. Grok `text` events continue to mean visible model response.
- Core replays the durable closed activity marker into a distinct `model-processing` live stage. An open tool remains stronger evidence and must stay `using-tool`; verification and terminal evidence still win.
- Task list, Decision View, status/inspect, and Hub consume the same Core live-stage projection. No UI is allowed to infer the stage from prose, elapsed time, log size, model name, or Provider.
- Hub copy is independently readable in Chinese and English: “model is processing” means the runtime is still reporting activity, not that useful code has been produced.

## Efficiency and safety boundary

- Processing telemetry is an observability heartbeat only. It does not reset the existing no-progress watchdog, extend duration/Token limits, change Task `updatedAt`, authorize another Attempt, or change routing/model-quality statistics.
- Do not persist estimated thinking-token counts, prompts, response text, endpoints, credentials, paths, commands, tool arguments, raw events, or Provider diagnostics.
- Rate limiting is internal backpressure, not a quality threshold. It does not stop the Worker and is not a success gate.
- Existing legacy events keep their current honest fallback. Missing runtime telemetry remains “waiting for model” or generic running rather than an invented processing claim.

## Call chain

1. Claude Code or Grok emits a structured processing signal.
2. The runtime normalizer recognizes only the closed event kind and rate-limits durable emission.
3. The Worker adapter stores a bounded privacy-safe activity event through the existing event path.
4. Core live-stage replay chooses processing, visible response, open tool, verification, or terminal state by evidence precedence.
5. Task surfaces and Hub translate the same closed code for Main and the user.

## Acceptance examples

1. Tens of thousands of Claude `thinking_tokens` lines over one interval create one durable-safe normalized event, not tens of thousands.
2. A later processing signal outside the interval becomes visible without exposing the estimated count.
3. Processing after Worker start projects `model-processing`; a text response projects `model-responding`.
4. Processing while a tool remains open cannot replace `using-tool`.
5. Thirty seconds without a new bounded signal changes only the observation to quiet; it never changes the stage to failed or starts a retry.
6. Grok thought and text are distinguishable without inspecting their prose.
7. Restart replay of the same events produces the same live stage.

## Out of scope

- Provider retry counters, network/socket detection, billing, reasoning-token accounting, watchdog policy changes, Task status/schema changes, retries, correction policy, routing scores, Competition, Integration semantics, or another scheduler.
- Broad Task Detail redesign, new dependencies, other projects, commit, or push.

