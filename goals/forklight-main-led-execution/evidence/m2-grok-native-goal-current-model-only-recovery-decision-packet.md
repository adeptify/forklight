# M2 native `/goal` current-model-only recovery — decision packet

Recorded: 2026-08-15 Asia/Shanghai

## Outcome

The final authorized recovery Task stopped during bootstrap before Grok CLI created a native Goal.
It produced no product diff, Candidate Revision, ForkLight verification, Judge review or
Integration. The retained 14-path Candidate remains unchanged and protected.

## Exact execution evidence

- Task: `08832868-30e1-4950-81c4-d575adf98117`
- Session: `5f1de2fd-4bb7-4c1c-b066-e8330394194b`
- Attempt: `d008a116-4a43-40cc-bc91-aefa131e9844`, ordinal 1 of 1
- Recorded execution truth: `persistent-session`
- Runtime/Profile: Grok Build, Grok 4.6 Xhigh
- Terminal: failed, exit 66
- Public failure: `ForkLight native Goal Candidate does not match this Workspace source base.`
- Diff: absent, 0 files and 0 lines
- Native Goal state/id: absent
- Verification/Judges/Integration/usage/cost: not recorded because execution never reached them

The exact seed artifact is Revision `00d99db6-429f-4786-b982-740f19581b31`, digest
`e12f45e8d2b9daceebc1b5d53929a455e7ae0965110853b3e677960a0fd42f62`. Preflight proved it
forward-applies to current source. After failure, the same forward check also passed directly in
the Task Workspace, proving the Workspace source base is compatible and the public error is not the
root cause.

## Root cause proof

The recovery wrapper invokes `git apply` after ForkLight has placed the Runtime inside the macOS
sandbox. The sandbox permits the Workspace but denies user-home file data. A read-only reproduction
using the same Workspace and equivalent sandbox boundary returned exactly:

`fatal: unable to access '/Users/yijunwang/.gitconfig': Operation not permitted`

The wrapper did not set an isolated Git configuration such as `GIT_CONFIG_GLOBAL=/dev/null` for
its internal checks. It also suppressed Git stderr and interpreted both forward and reverse process
failure as source-base mismatch. This repeats the already known storage bootstrap environment
failure, but the final Task contract does not allow another remedy round.

A second read-only reproduction used the same failed Workspace and equivalent sandbox, changing
only the diagnostic process environment to `GIT_CONFIG_GLOBAL=/dev/null` and
`GIT_CONFIG_SYSTEM=/dev/null`. The exact same `git apply -p2 --check` then passed with exit 0. It did
not apply the patch or write the Workspace. This proves Git configuration isolation is sufficient;
no Candidate, product, model, Runtime or scope change is needed to cross this bootstrap boundary.

## Actions deliberately not taken

- No Task resume, extra Attempt, validation repair, Main correction or reverification.
- No wrapper change after failure and no replacement Task.
- No model/Profile switch, handoff, reroute or Competition.
- No Candidate revision, Judge Graph, Main accept, Integration or activation.
- No source edit, storage repair/reclaim, commit, push, Hub/UI or M3 work.

## Reusable output and disposition

Keep the original Task `010812a2-0939-4315-9e19-ae7b892e677b`, Revision `00d99db6...`, its two
usable Judge accepts, and the failed final Task evidence protected. The 14-path Candidate remains
the complete reusable product output; its sole known product gap is still
`GROK_GOAL_USE_CURRENT_MODEL_ONLY=1` plus focused native/persistent env assertions. No destructive
cleanup is authorized.

## Required decision

The explicit final-task allowance is exhausted. Any continuation would require a new
Milestone-level authorization that knowingly supersedes the no-replacement boundary. Main does not
infer that authority from the smallness of the environment fix or from the retained Candidate.
