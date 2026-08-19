# M4 focused entry audit

Date: 2026-08-17 (Asia/Shanghai)

## Result

ForkLight already reports Worker Token volume, Attempt cost/time evidence, orchestration exchange
size and two manually accepted direct-Codex calibrations. It does **not** yet have evidence that can
support the M4 claim “delegation reduced complete Main Token for equivalent work without worse
quality.” The remaining gap is a narrow evidence chain, not another statistics or routing system.

The audit followed only the M4 path:

```text
Codex terminal usage
  -> direct-Codex sample/publication
  -> Task Token report
  -> Task/portfolio economics
  -> Daemon / CLI / MCP
```

It also inspected the current Store aggregates and the existing Main-direct records. No whole-repo
scan, Task creation, Provider run, Hub/UI change or Store mutation was performed.

## Current machine truth

- The M3 boundary source passes 3,022/3,022 and the activated client/Daemon build identity is
  matched.
- Store contains 13 completed Main-direct decisions: 12 passed verification and one has verification
  unavailable. These records explain why Main acted directly and how long the decision was open;
  they contain no Main Token usage.
- Store contains 11,590 orchestration exchange receipts. These are count-only CLI/MCP request and
  response envelopes. They do not include Main's planning, source reading, reasoning, review or
  decision Token.
- Store contains two direct-Codex paired samples, two accepted reviews and two publications. Both
  are old token-calibration task classes, both lack a task family, and neither belongs to the three
  graduated representative families.
- For Task `fe894ff7-b86c-4b1b-a945-7058b4de1684`, the current report compares a direct baseline of
  4,183,926 Token with a low-confidence exchange range of 95,234–581,082 and labels the difference
  direct-Codex savings. This is useful boundary-volume evidence but not complete Main usage.
- For Task `8de01a79-91c7-4951-a8fe-24a5fac000bb`, the analogous baseline is 3,807,830 and the
  exchange range is 109,197–667,306. Its manual accepted review does not persist explicit
  same-scope, same-acceptance and quality-not-lower attestations.
- M3-C2 replacement Task `68f16585-1fec-447c-8799-4867a4731b0f` truthfully reports Worker usage
  incomplete, exchange range 44,557–271,827 and no direct baseline. ForkLight does not substitute
  zero or invent a saving.

No current pair is valid for M4. `main-token-pairs.json` does not yet exist.

## Reusable foundations

- `normalizeCodexTerminalUsage` already validates the same five disjoint Codex terminal counters
  and prevents cache/reasoning double-counting.
- Direct-Codex sample, review and publication services already demonstrate privacy-safe count-only
  capture, immutable review and exact Task/profile identity.
- StateStore has simple local insert/read patterns and foreign-key protection; no lock, lease,
  checksum or cross-node protocol is needed.
- Candidate revision, independent verification, current Main accept and Integration records already
  provide the delegated quality/delivery side.
- Task and portfolio economics already keep Worker Token, runtime estimate, official native-currency
  cost and unavailable evidence separate.
- Events already identify Worker validation repairs, Main corrections and reverifications; these
  can be counted without a new correction system.

## Real gaps

1. **Complete Main usage capture.** There is no role-aware record for a complete direct-Main run
   and a complete delegated-Main orchestration/review run measured by the same Codex profile and
   terminal-counter method. Exchange receipts must remain a separate boundary metric.
2. **Pair validity and quality gate.** Existing accepted sample review is too weak for an M4 claim:
   it does not bind both Main usage sides or persist explicit same-scope, same-acceptance and
   delegated-quality-not-lower evidence. Legacy reviews must remain readable but cannot graduate a
   pair.
3. **Family value report.** No canonical read-only report combines a valid Main pair with Worker
   Token, cost, time and correction evidence or refuses a family saving claim when a gate is
   missing.
4. **Graduation evidence.** The three representative families
   `forklight-storage-lifecycle`, `worker-runtime` and historical
   `hub-product-comprehension` have no valid Main Token pair. M4 permits one explicitly approved
   calibration pair per family; it does not permit replay to improve model rankings.

## Accepted Work Items and dependency proof

- **M4-A — complete Main usage capture**: introduce count-only direct/delegated Main usage samples
  tied to one ForkLight Task/comparison identity, using the existing Codex terminal counter
  normalizer. It exposes capture and read-only status through CLI/API but makes no saving claim.
- **M4-B — valid pair and quality gate** (`depends_on: M4-A`): bind one direct and one delegated
  Main sample, require explicit equivalence/quality evidence plus current delegated verification,
  Main accept and Integration, then compute exact Main Token change. Legacy calibration alone is
  insufficient.
- **M4-C — family value report** (`depends_on: M4-B`): aggregate only valid pairs and display Main
  Token change beside Worker Token, native-currency cost, time, repair/correction counts and typed
  unavailable reasons through canonical Daemon/CLI/MCP output.
- **M4-D — representative pair evidence** (`depends_on: M4-C`): run one explicitly approved,
  same-source/same-acceptance direct/delegated calibration for each of the three graduated families
  and materialize `main-token-pairs.json`. Historical Hub records may be read; Hub/UI may not be
  modified.

M4-A, M4-B and M4-C all require StateStore plus Daemon/CLI/MCP entry paths. Their writable-path
intersection is non-empty, so no product Writers run in parallel. They are serial vertical slices.
M4-D also runs serially because one measured Main profile owns the comparison episodes and Main
integrates every delegated result. No hash, lock, lease, version handshake or duplicate consistency
layer is introduced to manufacture parallelism.

## Stop conditions

- If the available Runtime cannot return complete comparable terminal counters for both Main roles,
  the pair stays unavailable; exchange bytes are not promoted as a substitute.
- If direct/delegated scope, acceptance or quality cannot be established, reject the pair rather
  than relaxing the gate.
- If two purposeful calibration rounds repeat the same failure or require new product scope, stop
  with the usable samples and exact missing gate.
- A family with no valid lower-Main-Token pair prevents M4 graduation. It does not justify automatic
  model switching, Competition, extra Judges or a manufactured rerun.
