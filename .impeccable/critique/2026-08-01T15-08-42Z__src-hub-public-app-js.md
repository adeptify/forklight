---
target: ForkLight Hub Task Detail
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-01T15-08-42Z
slug: src-hub-public-app-js
---
Method: dual-agent (A: task_detail_design_review · B: task_detail_detector)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Verdict and counts are visible, but detail loading is generic. |
| 2 | Match System / Real World | 3 | The journey is natural, while Main/Worker/Candidate/Integration still need first-use context. |
| 3 | User Control and Freedom | 2 | Back/Escape exist; failed tasks do not lead to the recommended action. |
| 4 | Consistency and Standards | 2 | The Checks tab count means failed checks while other counts mean totals. |
| 5 | Error Prevention | 2 | Risky actions are gated, but the Actions tab exposes too many competing paths. |
| 6 | Recognition Rather Than Recall | 3 | Overview carries most facts, but recovery still requires cross-tab reconstruction. |
| 7 | Flexibility and Efficiency | 2 | No deep link or complete keyboard tab pattern. |
| 8 | Aesthetic and Minimalist Design | 3 | Dense evidence is folded, but seven tabs and repeated facts remain. |
| 9 | Error Recovery | 2 | Failed checks are present, yet the hero can show a passing line as the failure reason. |
| 10 | Help and Documentation | 2 | Hints exist, but current-failure recovery guidance does not. |
| **Total** | | **24/40** | **Acceptable; failure truth and recovery are the release blockers.** |

## Design Specificity Verdict

The information architecture is authored for ForkLight: Main assignment, Worker claim, independent verification, Main decision and Integration remain separate facts. The visual system is more interchangeable: a conventional light admin shell, rounded cards and tabs do not yet express ForkLight's distinctive delegation-and-judgment chain.

The deterministic detector found zero mechanical anti-patterns in `src/hub/public/app.js`. That clean scan does not contradict the review: the major defects are semantic contradictions in real task data, not templated-markup rules. Browser overlay injection was unavailable because the in-app Browser exposes read-only evaluation only; no overlay is claimed.

## Overall Impression

Task Detail is now a credible collaboration report for successful tasks. Failed tasks break trust at the exact moment certainty matters: a failed check can be named as “all tests passed”, its summary can begin with a check mark, and the next step merely repeats “Main rejected it”.

## What's Working

- The four-part overview follows the user's natural questions and keeps Worker self-report separate from proof.
- Retained Candidate copy precisely says what remains and what it does not prove.
- Private prompts, raw logs, paths and credentials stay behind bounded safe projections and disclosures.

## Priority Issues

### [P1] Failed checks can present passing evidence

**Why it matters:** The user cannot answer why the task failed and stops trusting the verdict. In the real rejected task, the hero showed a `✔` line and the failed row was labelled “required automated behavior tests all passed”.

**Fix:** Make check names result-neutral; rank safe diagnostics for failure signals and suppress passing/noise lines; combine Main decision with actual verification state instead of saying checks may have passed.

**Suggested command:** `$impeccable clarify`

### [P1] “Next step” repeats status instead of enabling recovery

**Why it matters:** “Task rejected by Main” does not tell the user whether to revise, reverify, reuse the retained Candidate or stop.

**Fix:** Produce one evidence-backed action sentence. When no continuation is authorized, say that explicitly and name the decision needed to proceed.

**Suggested command:** `$impeccable clarify`

### [P2] Tab count semantics and keyboard behavior are inconsistent

**Why it matters:** “Checks 0” can mean all five checks passed, while the Process and Result badges show totals. The tablist lacks the complete ARIA/roving-keyboard pattern.

**Fix:** Label failure counts as failures, and implement IDs, controls, labelled-by, roving tabindex and arrow/Home/End navigation. Consider reducing seven top-level tabs later.

**Suggested command:** `$impeccable harden`

### [P2] Success and failure heroes share the same visual tone

**Why it matters:** Failure's two primary boxes look like positive confirmation surfaces, weakening the status message.

**Fix:** Apply semantic success/caution/failure/neutral tones while keeping the recommended action calm and readable.

**Suggested command:** `$impeccable colorize`

### [P2] Dialog and loading state are incomplete

**Why it matters:** The full-screen workbench is announced as a generic English “Details” dialog, lacks complete focus containment, and gives no useful progress or retry path during multi-second loading.

**Fix:** Bind the accessible name to the task title, finish modal/focus semantics or promote it to a true page, and add a bounded loading/retry state.

**Suggested command:** `$impeccable harden`

## Persona Red Flags

**Jordan (First-Timer):** Main, Worker, Candidate and Integration are not defined; the failed page contradicts itself; the stated next step names no action. Jordan will still ask “what broke and what do I click?” after reading Overview.

**Alex (Power User):** Seven tabs lack arrow-key navigation and task deep links; a session-global active tab can open the next task in an unexpected place; the hero cannot jump to the recommended action.

**Sam (Accessibility / incident response):** Failed diagnostics can be polluted by passing output, check names collapse distinct commands into one sentence, and evidence must be reconstructed across Hero, Overview, Actions and More.

## Minor Observations

- The overview displays raw `zh-CN` instead of the existing readable language label helper.
- Truncated Worker prose retains an internal “use deep inspect” instruction.
- A successful corrected task would be clearer with one sentence explaining that the second attempt fixed the first.
- Responsive selectors exist, but tests do not prove tab overflow, keyboard behavior or actual visual order.

## Questions to Consider

- If the failure reason can show a check mark, why should the user trust any later verdict?
- Is “Main rejected it” a next step, or the same state stated a third time?
- Should Task Detail optimize for complete audit evidence or for a 30-second handoff, with audit evidence as progressive disclosure?
- How can the Main → Worker → verification → delivery chain become the interface's most memorable product-specific structure?
