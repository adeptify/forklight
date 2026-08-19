# M4-E Daemon socket probe permission safety delivery

## Delivered result

ForkLight now distinguishes a healthy connected Daemon, a genuinely stale refused Unix socket and
an indeterminate/permission-denied probe. Only `ECONNREFUSED` may enter the existing same-inode
unlink path. `EPERM`, `EACCES`, timeout and unknown errors fail closed and preserve the endpoint.

## ForkLight execution and Candidate

- Task: `b664e69e-ee30-4268-8de3-1f7c07fb808d`
- Session: `8e28cbeb-be88-4143-97d5-bd8f66891ba3`
- Grok 4.6 Xhigh native Goals:
  `fce04a03-7228-4f67-b4bd-ed47e4bb9504` and its validation-repair successor
  `f6a22c2b-fde9-40b8-ab7e-d6459dfe0c19`
- Base Attempt: `1b96c266-ff9d-4637-87c1-645ca30d6f1d`
- One accepted validation-repair Attempt:
  `e81e8421-39a7-42cb-a544-bbcd4823c9a8`
- Final Revision: `d2066be2-ae14-420d-b09d-103eb0019561`
- Full digest: `c98adc67e5525033e6c861fda9d4bd2937588d3eed523d78bad21e03d4a9a638`
- Final scope: `src/daemon/server.ts`, `tests/daemon.test.ts`; 124 changed lines

The base Candidate's focused tests passed but `npm run build` found one
`exactOptionalPropertyTypes` assignment of `string | undefined`. The single allowed repair omitted
the optional field when no code exists. It did not alter probe semantics or add a new path.

## Quality chain and Integration

- ForkLight independent verification: build, all 198 Daemon tests and diff check passed
- Review Graph: `2b394964-36f8-4b12-a025-6087375818b7`
- Codex Luna Max Judge: `74f7e255-4e90-42ca-a4f9-1add56427378`, usable accept
- DeepSeek Pro Judge: `319ad757-7ac8-461f-95e6-78725cf525c3`, usable accept
- Main accepted the exact Revision/digest
- Preflight receipt: `d6ba976a-ab08-4bf4-a692-d7b15b5d66d6`, no rejection
- Integration: `b3bcaf00-f15f-4fbc-93fe-3648fbc254d8`, applied and activated
- Post-Integration `npm run check`: 3,096/3,096 passed

The Worker Runtime exposed no complete official terminal Token counters. ForkLight reports only two
runtime estimates, USD 0.37650308 and USD 0.25339214; no official-cost or saving claim is made.

## Live proof and final runtime truth

Against the activated build, Main kept one healthy operator Daemon and launched a second compiled
Daemon under a network/socket-denied macOS sandbox. The second instance exited 1 with the bounded
`socket probe failed (EPERM); leaving the existing endpoint unchanged` diagnostic. The canonical
socket dev/inode stayed exactly `16777234:124953509` before and after, and health remained true.

After the full check, Main restarted the Daemon once to match the newly generated build identity.
Client and Daemon now match build `2399b5af...` and source digest `9bad0039...`; Grok 4.6 Xhigh is
launchable as `native-goal`.

This delivery adds no lock, lease, PID registry, checksum, version handshake, retry, Hub/UI or
comparison replay. No commit, push or reset occurred.
