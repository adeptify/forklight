# M3 Hub durable Task History contract

## Outcome

The Task page keeps its small, frequently refreshed **Now** view, while **History** can deliberately search and page through every durably closed outcome. A user should be able to find an older delivery without knowing how ForkLight stores Tasks, and opening History must not turn the archive into another background poll.

## Product truth

- `Now` remains the default and continues to use the existing bounded `/api/ops/tasks` response.
- `History` contains only Tasks whose canonical Core projection says `boardScope: history`. A machine-successful Worker that still awaits Main review or Integration stays out of History.
- The first History page loads only after the user selects History. It is never added to `PAGE_DEPS`, overview refresh, hidden-tab refresh, or the normal page refresh plan.
- History uses an explicit search submit and an explicit **Load more** action. It never requests on every keystroke, automatically walks every page, or retries in a loop.
- `All` remains the currently loaded operational board. This slice does not redefine All as a full archive.

## Daemon boundary

Add one read-only daemon operation for a History page. Its request accepts:

- `limit`: default 25; integer from 10 through 50.
- `query`: optional, trimmed, maximum 100 characters.
- `cursor`: optional opaque continuation value issued by the previous response.

Its response contains:

- `items`: the same privacy-safe `SafeTaskSummary` records used by the existing list projection, restricted to canonical History.
- `nextCursor`: present only when more matching records exist.
- `hasMore`: whether another page can be requested.
- `totalCount`: total matching canonical History records for this query.

Order is deterministic: newest `updatedAt` first, with Task id as the tie-breaker. The cursor binds the continuation point and normalized query. A malformed cursor, a cursor used with a different query, or an out-of-range request fails with a short fixed error that does not echo the query, a path, Task content, or cursor internals.

This is an explicit archive read, so the first implementation may derive canonical History from stored terminal Tasks before taking the bounded page. The response and UI work must be bounded; do not claim this slice has already optimized all database work.

## Search and privacy

Server search is case-insensitive and limited to safe summary facts: Task name, machine status, Provider, model, and runtime. It must not search or return prompts, commands, command output, errors, diffs, source/workspace paths, environment values, credentials, free-text review reasons, or event payloads.

The Hub must use one shared compact Task projection for both recent Tasks and History so a new field cannot silently appear in only one route. Invalid or contradictory board placement codes are removed and therefore never become archived UI records.

## Hub interaction

- Keep a separate History state: loaded items, submitted query, draft query, next cursor, total count, loading state, error, and request generation.
- Selecting History starts the first request only when the current submitted query has not been loaded. Re-entering it reuses loaded results until the user chooses Refresh or submits another query.
- Submitting search or choosing Refresh clears the old cursor and replaces the page only after a successful current-generation response. **Load more** appends and de-duplicates by Task id.
- Only one request is in flight. Late responses from an older search cannot overwrite the current search.
- If the first request fails, say History is unavailable and offer retry. If a later request fails, keep the already loaded records, mark them as possibly stale, and offer retry. Do not show an empty-history message for a failed request.
- Display honest progress such as “25 of 83 loaded”. Loaded count is never labelled as the total archive size.
- Search is a labelled form that works with Enter; Load more, Refresh, retry, and scope controls are keyboard accessible. At about 390 px, controls wrap without horizontal page scrolling.
- Chinese and English copy is written independently in ordinary language. Primary UI must not say cursor, daemon, projection, lifecycle, endpoint, or similar implementation terms.

## Boundaries

This slice does not change Task status, Task persistence/schema, retention, deletion, archive mutation, retry/correction, Main review, Integration, routing, Provider configuration, economics, or any consumer App. It does not broadly redesign Task cards or Task Detail. Main Codex owns the final visual hierarchy, interaction judgment, Candidate acceptance, repair if needed, and Integration.

## Acceptance examples

1. A repaired failed Worker delivery whose canonical placement is History is findable; a machine success awaiting Main is not.
2. Two Tasks with the same timestamp page without duplication or omission because the id tie-breaker is stable.
3. A new Task inserted between page requests does not duplicate a Task already returned.
4. A cursor from query `glm` is rejected when used with query `deepseek`.
5. History is absent from the normal Task page request plan and makes no request until selected.
6. A failed Load more keeps the already visible records and explains what the user can do next.
7. The two Hub Task routes expose the same compact allowlist and no private source/workspace/session content.
