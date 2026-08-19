# M5-B final responsive-shell stop

Date: 2026-08-19 (Asia/Shanghai)

## Result

M5-B is stopped before Judge and Integration. Final responsive-shell Task
`64b4ac59-c3a7-4eb2-bd18-02294045be8b` preserved the seven-path redesign and improved the
mobile shell, but the same accepted mobile-fit gap remains. The frozen Work Item permits no
further replacement, Main correction or reverify.

## ForkLight evidence

- Runtime: Grok CLI `grok-4.6`, `xhigh`, native Goal, one base Attempt.
- Candidate Revision: `8454e3cf-ea26-4b8f-892f-234b7835e13c`.
- Candidate digest: `1bd59768d702566e0577a382c573728eef1cdfd218044825fe7932104b2a91a8`.
- Independent verification sequence: `3176`.
- Passed: bootstrap syntax, 422/422 focused tests, `app.js` parse and visible-dash check,
  `git diff --check`.
- Failed: `npm run build`. `tests/hub-responsive-layout.test.ts:1706` returns `match[1]` as
  `string | undefined` where the helper promises `string`.
- The declared same-Worker validation-repair allowance remained unused. This Task was launched
  through the local `forklight run` path, which does not enqueue the daemon's automatic repair;
  ordinary `resume` was rejected before mutation by the frozen one-Attempt cap. This did not cause
  the final rejection because the Candidate also failed the required real mobile QA.
- Main recorded exact Candidate failure attribution at event sequence `3178`.

## Real browser evidence

The Candidate was copied unchanged into an isolated QA runtime and served against the restored
isolated ForkLight Home. No source or Task Workspace was modified.

- Desktop `1440x900` passes the intended composition: product bar `52px`, page bar about `66.8px`,
  zero page overflow, readable Goal prose about `551px` wide, hidden mobile Back, and a real
  Decision Center route with one Decision Center body and no retained Goal-file body.
- At `390x844`, permanent chrome is improved to `96px` and Chinese labels remain horizontal, but
  the product and page bars render about `405.3px` wide. Back ends at about `397.3px`, outside the
  viewport. The opened System menu spans about `278.6px` to `446.6px`, clipping theme/language and
  connection utilities.
- At `360x800`, the same `405.3px` shell remains. Back is entirely off-screen and the System menu
  still extends to about `446.6px`. The page hides overflow instead of fitting the controls.

Screenshots:

- `m5-b-final-desktop-work.jpg`
- `m5-b-final-mobile-390-system-clipped.jpg`
- `m5-b-final-mobile-360-shell-clipped.jpg`

## Reusable output and stop boundary

The desktop Goal-first composition, Decision Center route, compact `96px` mobile chrome,
single-line labels, zero-scroll Goal entry and resize-triggered Back update remain reusable in the
protected Candidate. The unresolved layout cause is structural: brand, Work, Decision Center,
System and Back are all competing for one `360-390px` product row, while the dropdown is anchored
without a viewport-fitting edge.

No Judge, Main accept, Integration, source build, full check, commit, push, reset or reclaim ran.
M5-C remains dependency-held. Continuing requires a new explicit decision that supersedes the
no-further-replacement boundary and admits a different mobile hierarchy, not another unchanged
retry.
