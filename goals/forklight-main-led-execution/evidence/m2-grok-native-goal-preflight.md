# M2 Grok CLI native Goal preflight

Date: 2026-08-15 (Asia/Shanghai)

## Proven runtime surface

- Installed CLI: `grok 1.0.3 (1a29d5bc12d4)`; stable update channel also reports 1.0.3.
- Official 1.0.3 source commit inspected: `eb267feff13129e568df38fb6fdf0ceb65f735d6`.
- Official `/goal` grammar: `<objective> [--budget <tokens>]`, `status`, `pause`, `resume`, `clear`.
- The 1.0.3 headless `-p` path sends the prompt through the same shell slash-command resolver.
- Durable Runtime state is `<task-local GROK_HOME>/sessions/<workspace>/<session>/goal/state.json`;
  it carries `goal_id`, objective, status, phase, usage, history, rounds and classifier evidence.

## Real isolated smoke

No-Goal status smoke:

- Session `9e1e35ef-6474-4231-a2d6-8731ce64310f`
- `GROK_GOAL=1 GROK_WORKFLOWS=1 grok -p '/goal status' ...`
- exit 0, `No goal is currently set`, and advertised command list contains `goal`.

Native Goal smoke:

- Session `94c508c7-7ebf-4d97-b762-f5c8c1968bc9`
- native Goal id `f88df868-008a-43ae-a4ec-1dd5881d1f44`
- model/effort: `grok-4.6` / `xhigh`
- objective: read an isolated README and report the first heading without Workspace edits.

The first process printed a plausible completion answer but native state was only
`user_paused/Idle`: planner construction failed because removing the shell tool made Grok's
internal planner dependencies unsatisfied. This proves CLI prose/exit is not native completion.

The same Session/Goal then resumed. Keeping the shell registered while denying actual Bash fixed
the planner dependency; replacing the global Write/Edit deny with path-specific Workspace and
credential protection allowed the native planner/state/scratch paths to function. The final state:

```json
{
  "goal_id": "f88df868-008a-43ae-a4ec-1dd5881d1f44",
  "status": "complete",
  "total_worker_rounds": 1,
  "classifier_runs_attempted": 1,
  "classifier_max_runs": 6,
  "last_classifier_verdict": "achieved"
}
```

The durable classifier details say `0 of 3 skeptics refuted` and inline all three independent
reports. Source README and isolated README both have SHA-256
`2f58327a9bfb5754708031de678d28ad404bdbf8fa53125d8e3826f1002402cb`.

## Cost and design consequence

The successful terminal headless result reported 470,355 total tokens, 26 model calls and
USD 0.5794094 for this deliberately tiny smoke. This is required one-time launch evidence, not a
benchmark or reason to create more proof Tasks. Product behavior must expose native usage/cost,
omit an absolute Goal token budget by default, and reserve `/goal` for meaningful bounded work.

## Current boundary

The Grok CLI native Goal is real. ForkLight's integrated adapter still freezes Grok as
`persistent-session` and does not read the Runtime state, so no existing ForkLight Task may yet be
labelled `native-goal`. The accepted supplemental Work Item is
`specs/m2-a-grok-execution-truth/work-items/grok-native-goal/spec.md`. Until that Candidate is
verified, judged, safely integrated and live-smoked through ForkLight, the current adapter truth
remains unchanged.
