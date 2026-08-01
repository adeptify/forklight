# M3 Declared Local Dependency Runtime-Link Contract

## Outcome

ForkLight can prepare, reverify, and Integration-verify a project whose root
`package.json` declares a relative `file:` or `link:` package and whose
`node_modules/<package-name>` is a symlink to that exact declared package.
The Worker still receives only local mirrors inside its owned isolation
container. No undeclared link may cross the project boundary.

This closes the real Flyleaf failure recorded by Task
`5a37f666-0298-477d-8acd-0c5b84c8fb6e` without changing Flyleaf or Adeptify,
without installing packages, and without weakening the existing escape gate.

## User-visible behavior

- A normal package-manager symlink for an explicitly declared sibling package
  no longer prevents workspace preparation.
- The link inside the isolated `node_modules` tree points to the copied sibling
  package inside the same Task/verification container, never to the original.
- An undeclared external symlink, a declared package whose real target differs,
  or a symlink inside the copied package that escapes its package root still
  fails closed with the existing safe error.
- Failed preparation remains retryable only after Main activates a verified
  ForkLight build; the historical failed Flyleaf Task is not rewritten.

## Modules and behavior

### 1. Declared-local planning

Consumes the source root `package.json`, destination project path, and owned
isolation-container path. Produces the existing validated local-package plans:
package name, exact real source root, and exact destination mirror root.

Boundary: only relative root declarations using `file:` or `link:` are
authoritative. Package names must map to their exact `node_modules` location;
the declaration is not a general permission to follow external links.

### 2. Runtime dependency materializer

Consumes `node_modules` plus a narrow allowlist derived from validated plans.
When it encounters an external symlink, it may rewrite that link only when:

1. its path relative to `node_modules` equals the declared package name
   (`@scope/name` maps to `@scope/name`), and
2. its resolved target equals the plan's exact real source package root.

It produces a relative symlink whose destination is the plan's copied package
root inside the isolation container.

Boundary: every link that does not satisfy both checks follows the existing
escape rejection. Matching a target alone, matching a name alone, pointing
into a subdirectory, or pointing through a different real path is insufficient.

### 3. Canonical dependency-set materialization

Consumes one source project, one destination project, one owned container, and
the selected runtime dependency directory names. Produces local sibling-package
mirrors and a local runtime tree wired together only inside the container.

It must be the shared behavior for:

- initial Worker workspace preparation;
- retained-Candidate dependency restoration/reverification;
- disposable Integration/Main-remediation verification copies.

Boundary: the baseline and Candidate diff remain dependency-free. No source
file, source dependency, package manifest, lockfile, credential, or Git state
is mutated.

## Call chain

1. Main submits a bounded Task for a project.
2. ForkLight copies the dependency-free baseline and Worker project snapshot.
3. ForkLight validates declared local-package plans inside the owned container.
4. ForkLight copies each declared package into its isolated relative location.
5. ForkLight mirrors `node_modules`; only an exact declared-package link may be
   rewritten to that isolated local-package mirror.
6. Worker and verifier commands resolve the same package topology without
   reaching the original sibling project.
7. Patch generation excludes runtime and declared-package mirrors.

## Required scenarios

1. **Flyleaf-shaped scoped dependency**: root dependency
   `@adeptify/client-core: file:../adeptify/.../sdk` and
   `node_modules/@adeptify/client-core` symlink to that exact SDK prepares and
   verifies successfully; both destination entries stay inside the container.
2. **Same name, wrong target**: the declared package name exists in
   `node_modules`, but its symlink resolves somewhere else; preparation fails.
3. **Undeclared external link**: another `node_modules` symlink escapes; the
   existing escape gate rejects the Task.
4. **Package-internal escape**: the declared package contains an external
   symlink; copying the declared package rejects it.
5. **Source immutability and diff hygiene**: edits in mirrors cannot mutate the
   source package and never enter the Candidate patch.
6. **All three consumers**: prepare, retained-workspace mirror restoration, and
   disposable verification copies use the same rule.

## Risks and controls

- **Accidental broad allowlist**: bind approval to both exact package path and
  exact real target; keep the generic escape branch unchanged.
- **Scoped package path confusion**: test `@scope/name` explicitly and reject
  package-name path traversal or malformed segments.
- **Broken isolated link**: create/copy the declared mirror before or as one
  atomic dependency-set operation, then point runtime links only to its planned
  destination.
- **Partial materialization**: preserve existing cleanup behavior and add tests
  that no command-ready external link remains after rejection.
- **Divergent prepare/reverify/Integration behavior**: expose one canonical
  helper or equivalently prove all three call sites with executable tests.

## Independent acceptance

- A Flyleaf-shaped fixture passes workspace preparation and disposable
  verification without touching a real Flyleaf/Adeptify checkout.
- The isolated `node_modules/@adeptify/client-core` is a relative symlink whose
  real target is the copied SDK inside the owned container.
- Wrong-target, undeclared, malformed/path-traversal, and package-internal
  escaping links still fail closed.
- Existing dependency-materializer, workspace, Integration, and Main
  remediation tests remain green.
- Full `npm test`, `npm run build`, and `git diff --check` pass.

## Runtime activation gate

This is a shared-Daemon self-upgrade. Main may retain a verified Candidate while
other projects run, but must not apply Integration or restart/activate ForkLight
until the global Daemon reports no active or queued Tasks. One shared Daemon and
one shared database remain authoritative; no second Daemon is allowed.
