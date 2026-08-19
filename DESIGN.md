# ForkLight Hub design

ForkLight is the execution-and-delivery member of the GoalBoard product family. GoalBoard holds
what a Goal is and how it is complete. This Hub holds what is true now, whether a decision is
needed, what was retained, and what happens next. The two products share a light, compact, flat
visual language. They do not share a data model.

## Tokens

- Field `#f6f7f9`, paper `#ffffff`, ink `#171a21`, muted `#5b616c`
- Action `#1677ff` / `#0958d9` with soft `#e6f0ff`
- Semantic green `#389e0d`, amber `#d48806`, violet `#722ed1`, red `#cf1322`
- Cool hairline `#e4e7ec`, radii 4-6px (never above 8px)
- Type: Inter, SF Pro Text, PingFang SC, Hiragino Sans GB
- Line icons in the product bar; color always has a text label

The authored default is light. A quiet dark theme exists for preference only and does not restore
the old teal sidebar.

## Hierarchy

1. Compact product bar: ForkLight identity, Work, one Decision Center, a System disclosure
2. Work: searchable, resizable Now/History execution tree plus one continuous Goal file
3. Contextual Task detail host (`#fl-detail`) for confirmed actions
4. System routes (Models, Worker, Main, Delivery, Competition, Insights) stay auxiliary

One `#fl-view` and one detail host remain. Authentication, fetch, privacy projections and confirmed
mutations are unchanged.

## Components

- **Product bar.** Work and Decision Center are the only primary routes. System holds Models, Worker, Main, Delivery, Limits, Competition and Insights.
- **Execution tree.** Goal → Plan → Task is communicated by nested position, branch lines and
  disclosure, not by a paragraph that asks users to choose an internal shape. Sibling Plans and
  Tasks read as parallel work. Search keeps a matching child's ancestors. Independent Plans and
  one-off Tasks remain in a quieter independent-work group. Width is a bounded CSS variable
  (`200-420px`) written without `.style` property access. Finished Goals stay in History.
- **Contextual creation.** The root adds a Goal, a Goal adds a Plan and a Plan adds a Task. The
  outcome composer is hidden until one of those actions is chosen, fixes the requested shape from
  that location, and uses the existing intake/confirmation contract. It never claims creation
  before confirmation or replaces hierarchy with a teaching block.
- **Goal file.** Fixed reading order: desired result; one current-truth sentence; decision needed
  (link only); phase and checkpoint; current Task with fact, reason and retained work; blockers
  with next action; delivery/History; folded technical evidence (ids, Runtime, Attempt, Token, cost,
  the seven-column board).
- **Decision Center.** Browser grouping of `waiting-user-decision` cards by Goal, plus one
  parentless group. Each item shows fact, reason, retained work, impact and the existing confirmed
  Task actions. No stored decision list and no second mutation path.
- **Task detail.** Existing drawer/sheet. Machine result, retained Candidate, Judge opinion and
  Main state stay distinct.

## Content rules

Important state uses fact, then reason, then next action. Page-visible copy has no em dash or en
dash. Raw ids, Runtime, Attempt, Token, cost and logs stay inside explicit disclosures. A
suggestion is never rendered as an executed action.

Primary copy names the user's result and next action. It does not explain “how to choose Goal,
Plan or Task”; the interface structure carries that meaning. Technical English labels may appear
as quiet secondary vocabulary, never as the sentence the user has to decode first.

## States

Loading, empty, filtered-empty, stale, error, disabled and reduced-motion keep their previous
honest treatments. Setup blockers appear in the Goal file with the exact missing prerequisite and
a link to the System surface. Live refresh keeps the DOM when the current route and canonical
truth are unchanged. Switching Work and Decision Center always replaces `#fl-view`. A real update
restores Goal/Task selection, tree width/query/scope, scroll, filters, open evidence and
unsubmitted drafts without stealing focus.

Status labels stay on one line. Goal file and Decision Center narrative uses a readable measure
(about 68 characters). Accents are hairline, not thick left bars.

## Responsive behavior

Desktop: product bar, Goal Tree and Goal file side by side, detail as a right-hand panel.

At `760px` and below: exactly one primary pane (tree, Goal file, or detail). Opening a Goal starts
the file at its header and desired-result section. Back restores the tree and its reading position.
Chrome stays compact (no full-width nav/utils wrap) and the connection status stays visible. Status
groups stack. The real tree appears before any creation form; a form opens only after an explicit
contextual add action. Touch targets on Back and contextual add controls are at least 44px.
