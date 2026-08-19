# M4-E storage Main Token amplification audit

Date: 2026-08-18 (Asia/Shanghai)

## Result

The valid negative storage pair was not made expensive by a large ForkLight checkpoint. Its
`delivery prepare` and `delivery decide` CLI responses were 7,871 and 5,108 UTF-8 bytes. The prior
positive worker-runtime pair returned nearly identical 7,971- and 5,133-byte checkpoints.

The dominant cost was keeping one Codex Main session alive while a 19-minute-55-second Worker /
Judge flow ran. That session produced 15 model Token turns and 13 command-tool calls, compared with
7 turns and 6 calls in the positive worker-runtime delegated run.

## Count-only evidence

- Storage delegated run: `codex-run:01a011b6-a653-72e0-ba00-d508b259476a`, 553,038 gross Main
  Tokens.
- Direct storage run: `codex-run:01a011b5-2d21-77e1-8529-50314a7b5b93`, 154,171 gross Main
  Tokens.
- Before the real prepare command, five discovery turns had already accumulated 138,983 input and
  1,453 output, or 140,436 gross Tokens. They reread the ForkLight skill, bounded input/Task, local
  executable and installed CLI implementation. Those facts were already fixed by the accepted
  handoff and were not Candidate evidence.
- While the same `delivery prepare` process remained active, one short wait plus five 300-second
  session observations caused six model wake-ups. Their individual gross costs were 39,299,
  39,498, 39,717, 39,915, 40,109 and 40,304 Tokens: 238,842 total. The intermediate outputs were
  only session-still-running observations; they added no Candidate, verification, Judge or decision
  evidence.
- The final Candidate and decision were sound. The one Grok native Goal, validator, two Judges,
  exact Main accept and Integration all passed, so lower quality or failure recovery is not the
  explanation.

## Concrete product gap

ForkLight delivery already preserves Task/Review/Integration truth when an observation request
times out, but Main Token capture accepts exactly one terminal Codex run per role. A Main therefore
cannot end its model session while ForkLight works and later sum every resumed Main segment into
one canonical pair. Keeping the session open makes Worker duration multiply cached Main context;
omitting earlier sessions would undercount.

The minimum cross-project fix is:

1. keep the existing prepare timeout/re-entry semantics and document a staged Main-offline path:
   dispatch, later review readiness, then decision/Integration;
2. add one count-only `main-token capture-episode` input that validates and sums all named Codex
   terminal segments into one durable role sample;
3. retain every segment run reference and disjoint counters in the sample so no Main work is hidden;
4. keep the existing pair quality gates and report arithmetic unchanged.

This needs no new Goal/Plan/Task/Work Item entity, delivery operation, lock, lease, checksum,
content hash or distributed coordination. It changes neither Worker limits nor review authority.

## Next boundary

The accepted implementation Work Item is
`specs/m4-e-main-efficient-delivery/work-items/main-offline-usage-episode/spec.md`. After activation,
one new storage subject may use multiple fully counted Main segments. The valid negative pair stays
immutable contrary evidence; the new run is not a replacement or replay.
