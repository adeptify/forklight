# M5-A1 credential-label Judge-repair audit

Date: 2026-08-18 (Asia/Shanghai)

## Proven cause

`src/core/review-graph.ts` currently rejects
`/API[_-]?KEY/i` anywhere in every bounded summary/finding string. That protects no value boundary:
a bare field or option name is rejected exactly like a secret. MiniMax's retained strict JSON
contains `--api-key`/`API-key` as documentation terms and no credential value, yet received
`failureCode: unsafe-content`.

The same raw JSON has the exact five root keys, current Revision, `accept`, six bounded findings
with safe relative paths and no actual token/header/password value. It is otherwise valid.

## Reusable path

The existing result-repair lifecycle already provides the required authority:

- explicit Main confirmation;
- one append-only allowance on the original assignment;
- same frozen Judge identity and private packet;
- read-only derived Task, one Attempt and zero fallback;
- original failure evidence unchanged;
- exact Revision/disposition/findings equality;
- newer terminal evidence and fresh Main decision.

Only strict label/value parsing and eligibility selection are missing. No Store schema, new command,
new entity, Judge replacement or Candidate Task is required.

## Frozen boundary

Refine actual-value detection with focused positive/negative cases. Admit historical
`unsafe-content` only when the retained original fully passes the refined strict parser and
contains a known label. Do not repair any real secret value or semantic/schema failure. No Hub UI,
A2/A3, lock/hash/lease/version or multi-user work belongs here.
