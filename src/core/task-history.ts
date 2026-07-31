import { isLegalBoardPlacement, type SafeTaskSummary } from "./task-summary.js";

/** Default page size for one History page. */
export const HISTORY_DEFAULT_LIMIT = 25;
/** Minimum page size for one History page. */
export const HISTORY_MIN_LIMIT = 10;
/** Maximum page size for one History page. */
export const HISTORY_MAX_LIMIT = 50;
/** Maximum length of a History search query after trimming. */
export const HISTORY_MAX_QUERY_LENGTH = 100;

/**
 * Fixed privacy-safe reason for any malformed cursor, cross-query cursor, or
 * out-of-range request. Never echoes the query, a path, Task content, or
 * cursor internals. Callers surface this verbatim; the Hub maps it to a plain
 * user instruction without parsing it.
 */
export const HISTORY_INVALID_REQUEST_REASON =
  "History continuation is invalid; start a new search.";

/** Request shape for one bounded History page. All fields optional. */
export interface TaskHistoryPageRequest {
  /** Integer from 10 through 50; defaults to 25. */
  limit?: number;
  /** Trimmed, case-insensitive search; maximum 100 characters after trimming. */
  query?: string;
  /** Opaque continuation value issued by a previous response. */
  cursor?: string;
}

/** One bounded History page response. */
export interface TaskHistoryPage {
  /** Privacy-safe SafeTaskSummary records, canonical History only. */
  items: SafeTaskSummary[];
  /** Total matching canonical History records for this query (pre-page). */
  totalCount: number;
  /** Whether another page can be requested. */
  hasMore: boolean;
  /** Opaque continuation for the next page; absent when hasMore is false. */
  nextCursor?: string;
}

/** Internal cursor shape. Encoded opaquely (base64url JSON) for transport. */
interface HistoryCursor {
  v: 1;
  /** updatedAt of the last item on the issuing page. */
  ts: string;
  /** taskId of the last item on the issuing page. */
  id: string;
  /** Normalized query bound to this continuation. */
  q: string;
}

/**
 * Normalize a History search query: trim and lowercase so the case-insensitive
 * search and the cursor binding stay consistent. The cursor binds this
 * normalized form, so the same search continued with different casing is
 * allowed, while a different query is rejected.
 */
export function normalizeHistoryQuery(query: unknown): string {
  if (typeof query !== "string") return "";
  return query.trim().toLowerCase();
}

/**
 * Validate a page limit. Returns the default when absent; throws the fixed
 * invalid-request reason for non-integer or out-of-range values so callers
 * fail closed instead of silently clamping.
 */
function resolveLimit(limit: unknown): number {
  if (limit === undefined) return HISTORY_DEFAULT_LIMIT;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit)) {
    throw new Error(HISTORY_INVALID_REQUEST_REASON);
  }
  if (limit < HISTORY_MIN_LIMIT || limit > HISTORY_MAX_LIMIT) {
    throw new Error(HISTORY_INVALID_REQUEST_REASON);
  }
  return limit;
}

function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(opaque: unknown): HistoryCursor {
  if (typeof opaque !== "string" || opaque.length === 0) {
    throw new Error(HISTORY_INVALID_REQUEST_REASON);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(opaque, "base64url").toString("utf8"));
  } catch {
    throw new Error(HISTORY_INVALID_REQUEST_REASON);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(HISTORY_INVALID_REQUEST_REASON);
  }
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1) throw new Error(HISTORY_INVALID_REQUEST_REASON);
  if (typeof record.ts !== "string" || record.ts.length === 0) {
    throw new Error(HISTORY_INVALID_REQUEST_REASON);
  }
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new Error(HISTORY_INVALID_REQUEST_REASON);
  }
  if (typeof record.q !== "string") {
    throw new Error(HISTORY_INVALID_REQUEST_REASON);
  }
  return { v: 1, ts: record.ts, id: record.id, q: record.q };
}

/**
 * Safe summary fields searched by History. Limited to Task name, machine
 * status, Provider, model, and runtime. Never searches prompts, commands,
 * command output, errors, diffs, source/workspace paths, sessions, credentials,
 * free-text review reasons, or event payloads.
 */
function historyItemMatches(summary: SafeTaskSummary, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true;
  const haystack = [
    summary.name,
    summary.status,
    summary.provider,
    summary.model,
    summary.runtime,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  return haystack.includes(normalizedQuery);
}

/** Canonical History filter: a legal placement pair with boardScope "history". */
function isCanonicalHistory(summary: SafeTaskSummary): boolean {
  return summary.boardScope === "history"
    && isLegalBoardPlacement(summary.boardScope, summary.boardReason);
}

/**
 * Deterministic order: newest updatedAt first, taskId as the tie-breaker
 * (DESC so equal timestamps page without duplication or omission).
 */
function compareHistoryOrder(a: SafeTaskSummary, b: SafeTaskSummary): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  if (a.taskId !== b.taskId) return a.taskId < b.taskId ? 1 : -1;
  return 0;
}

/**
 * Select canonical closed outcomes and return one deterministic bounded page.
 *
 * Read-only and pure: consumes an already-projected SafeTaskSummary list,
 * keeps only canonical History (legal placement pair with boardScope
 * "history"), applies the safe summary search, and pages with a deterministic
 * (updatedAt DESC, taskId DESC) order. The opaque cursor binds the
 * continuation point and the normalized query, so a cursor issued for one
 * query is rejected when sent with a different query. Equal timestamps page
 * deterministically without duplication or omission because the id tie-breaker
 * is stable. Never mutates Tasks, echoes private fields, or infers client-side
 * lifecycle.
 */
export function paginateTaskHistory(
  summaries: readonly SafeTaskSummary[],
  request: TaskHistoryPageRequest = {},
): TaskHistoryPage {
  const limit = resolveLimit(request.limit);
  const normalizedQuery = normalizeHistoryQuery(request.query);
  if (normalizedQuery.length > HISTORY_MAX_QUERY_LENGTH) {
    throw new Error(HISTORY_INVALID_REQUEST_REASON);
  }
  // Canonical History filter + safe search, then deterministic order.
  const ordered = summaries
    .filter(isCanonicalHistory)
    .filter((summary) => historyItemMatches(summary, normalizedQuery))
    .sort(compareHistoryOrder);
  const totalCount = ordered.length;

  // Apply the opaque cursor continuation (keyset paging).
  let startIndex = 0;
  if (request.cursor !== undefined) {
    const cursor = decodeCursor(request.cursor);
    if (cursor.q !== normalizedQuery) {
      throw new Error(HISTORY_INVALID_REQUEST_REASON);
    }
    // Require the exact anchor that issued the continuation. A structurally
    // valid but forged or stale cursor must fail closed instead of silently
    // restarting, skipping records, or returning a duplicate first page.
    // Newer inserts remain safe: they sort before the still-present anchor,
    // and the next page starts immediately after that anchor.
    const anchorIndex = ordered.findIndex(
      (summary) => summary.updatedAt === cursor.ts && summary.taskId === cursor.id,
    );
    if (anchorIndex < 0) throw new Error(HISTORY_INVALID_REQUEST_REASON);
    startIndex = anchorIndex + 1;
  }

  const pageItems = ordered.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + pageItems.length < totalCount;
  const nextCursor = hasMore && pageItems.length > 0
    ? encodeCursor({
        v: 1,
        ts: pageItems[pageItems.length - 1]!.updatedAt,
        id: pageItems[pageItems.length - 1]!.taskId,
        q: normalizedQuery,
      })
    : undefined;

  return {
    items: pageItems,
    totalCount,
    hasMore,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}
