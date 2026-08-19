# M5-A3 clean bundle — repeated owned-process cleanup stop

Date: 2026-08-19 (Asia/Shanghai)

Two fresh external destinations independently ran the current `npm run bundle:clean` path. Both
completed the long prepack/install/lifecycle sequence but refused publication with the same bounded
terminal result:

`cleanup-failed: owned Hub or isolated daemon did not stop after verification failure`

No bundle directory was published and no real Task started. The private staging directories were
removed by the product. A separate install-only diagnostic used the same frozen built package and
an isolated prefix/Home. It observed the exact owned Hub exit immediately after `SIGTERM`; the
installed public `daemon stop` returned `Daemon stopped` in one second and the exact Daemon PID was
gone. No owned diagnostic process remains. The real ForkLight Home was not used.

The focused call-chain audit finds that `stopDaemon()` already returns `Daemon stopped` only after
the captured old PID and socket are both gone. `stopOwnedProcesses()` nevertheless always probes
and may signal the stored numeric PID again after that authoritative success. A PID can be reused
after the old process exits; the second numeric-only probe can therefore classify or signal an
unrelated new process and report a false cleanup failure. The repeated bundle failure plus the
passing direct lifecycle narrows the blocker to this duplicate post-stop ownership check. There is
no evidence that the public 10-second Daemon stop window caused this run, so this Work Item does
not change that timeout.

The accepted recovery changes only `src/clean-run/build-clean-run-bundle.ts` and
`tests/clean-run-bundle.test.ts`. An authoritative installed `daemon stop` result must end Daemon
cleanup without a second PID signal. A missing/not-running/failed command still uses the exact
recorded PID fallback and retains cleanup-failed truth if that PID does not leave. Tests must prove
that an immediately reused numeric PID is never signalled after authoritative stop, while the
fallback still signals a genuinely retained owned PID. No retry, process-name scan, lock, lease,
Hub/UI change or broader lifecycle redesign is admitted.

## Recovery delivery and post-fix stop

ForkLight Task `00a083f1-87f6-42cd-b1c4-260d18e23922` used Grok 4.6 Xhigh through its truthful
native Goal path. After one Main correction narrowed the authority rule to exit `0`, no timeout and
the exact stopped projection, final Revision `08b61065-b563-408f-a801-294a1212debc` (digest
`ddada25294f623b98cd93042482066907be3bfe5a5bf138f8f85d1b53fd1a37b`) changed exactly the two
accepted paths. ForkLight independently passed build, the focused clean-run tests and diff
validation. Fresh Review Graph `794bda56-348e-4ce6-941a-da08ee74eba0` retained two usable accepts.
Receipt `db245475-a614-4f84-950f-d53c0612bcc4` had zero rejections and Integration
`0cfebb72-16b7-4c8e-912d-c45b544fa8fa` applied normally.

Post-Integration `npm run check` then passed 3,143/3,143 and `git diff --check` passed. The source
Daemon was restarted and reported matched client/Daemon build identity
`aeba9c0e83fb54899c6fa8368198fce3adb6f30a859a5adbfc68edd2fca5b59c`.

The one contract-authorized post-fix run used a third new destination,
`/Users/yijunwang/code/forklight-m5-a3-evidence/2026-08-19-bundle-03`. It again terminated with the
same bounded result:

`cleanup-failed: owned Hub or isolated daemon did not stop after verification failure`

It published no bundle directory. A focused post-run process view found no process referring to
that destination or its removed private staging root. The current error projection does not retain
the earlier verification failure or distinguish `hubGone` from `daemonGone`, so the real run does
not prove that the duplicate Daemon PID check was the remaining cause. The integrated guard is a
valid focused safety improvement and its three regressions pass, but it did not graduate A3.

This is the third same-terminal bundle run and the first after a purposeful product correction.
The no-loop rule now stops A3: no fourth bundle, replacement Worker, timeout increase, retry, Hub/UI
work or speculative cleanup patch is authorized from this evidence. The reusable output is the
integrated two-path guard plus its verification and Judge chain. The remaining gap is exact
classification of the hidden prior verification failure and which owned cleanup result stayed
false. Continuation needs a new accepted diagnostic-only boundary that exposes only those bounded
facts before Main decides whether any further product behavior is warranted.

## Bounded diagnostic delivery and proven root cause

Diagnostic Task `91321ce5-c8ae-4154-8da3-a58d87eb5750` used Grok 4.6 Xhigh native Goal and changed
exactly the clean-run builder plus focused test. Revision
`e5466ab0-d7e2-4d93-83c0-77fcc28cabe0`, digest
`713930c620d8add4e65da2fa9e6e111e778fb0486b2ee7420316a86edd116956`, passed all three ForkLight
commands. Review Graph `41dd0d5d-ff54-4971-8ff8-1d367642b8be` retained two usable accepts. Receipt
`05d0062e-cd8c-4053-b48e-544b835a62df` had zero rejection and Integration
`e282a286-e92b-4483-ad48-3121ceaa3a22` applied normally. The 206-line advisory warning is accepted:
the production branch is small and the remainder is four required exact-shape/privacy tests.
Post-Integration `npm run check` passed 3,147/3,147.

The only admitted diagnostic external destination then published nothing and returned:

`cleanup-failed: prior=daemon-identity-mismatch cleanup=returned hubGone=true daemonGone=false`

This proves Hub cleanup is not the blocker. A fresh install-only copy of the same package then passed
packaged/installed identity, immediate Hub status, Daemon status, health identity and authoritative
Daemon stop from an isolated Home whose `forklight.sock` path is 93 UTF-8 bytes. The same immediate
sequence also passed, so a general startup wait or stop timeout is not supported by the evidence.

The real bundle's staging-derived socket path is 113 UTF-8 bytes. The authoritative local macOS SDK
header declares `sockaddr_un.sun_path[104]`, including the terminating null. The Daemon cannot bind
that endpoint. Hub's accepted startup behavior continues after an internal Daemon start failure,
which explains why Hub was ready while installed Daemon identity and later cleanup failed. No
diagnostic Hub or Daemon process remains; the external install-only root is retained as M5 evidence.

Main admits one new two-path recovery from this concrete local IPC failure. Only the ephemeral
bundle `FORKLIGHT_HOME` moves to a unique private OS temp root; npm prefix/Home/cache, artifacts and
publication staging remain unchanged. A Darwin byte guard fails before launch if even that socket
path would not fit. Owned processes stop before exact-root removal on success and failure. No retry,
timeout increase, process scan, global socket change, symlink, lock, lease, UI or schema change is
admitted. Accepted Spec:
`specs/m5-product-graduation/work-items/clean-bundle-short-runtime-home/spec.md`.
