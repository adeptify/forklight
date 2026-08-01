import { cp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  materializeDependencySet,
  RUNTIME_DEPENDENCY_DIRECTORIES,
} from "../workspace/dependency-materializer.js";

/**
 * Isolated verification environment owned by Integration and Main remediation.
 *
 * Layout (one disposable container):
 *   cleanupRoot/
 *     project/          ← command cwd (isolated project copy)
 *     <sibling>/...     ← declared relative file:/link: package mirrors
 *
 * Callers always delete `cleanupRoot` in finally so sibling mirrors are never
 * left beside /tmp. `projectCwd` is intentionally distinct from `cleanupRoot`
 * so relative dependencies such as file:../sibling/sdk resolve inside the
 * owned container. Setup failures also remove the partial container before
 * rethrowing so no sibling mirror is leaked.
 */
export interface VerificationEnvironment {
  /** Working directory for acceptance commands (isolated project root). */
  projectCwd: string;
  /** Owned container root that callers must delete in finally. */
  cleanupRoot: string;
}

/**
 * Copy the current original project into an isolated temporary verification
 * container. Excluded directories (.git, node_modules, configured excludes)
 * are not copied. Runtime dependencies and root-manifest declared relative
 * file:/link: package roots are materialized via the canonical dependency-set
 * rule (declared packages first, then runtime trees with exact declared-package
 * link rewrite) so verifiers never see an external symlink outside the owned
 * container.
 *
 * Extracted from integration.ts so that the Main remediation verification
 * service can reuse the same isolated-acceptance pattern without changing
 * Integration behavior.
 */
export async function copyForVerification(
  sourcePath: string,
  excludes: string[],
): Promise<VerificationEnvironment> {
  const cleanupRoot = path.join(
    tmpdir(),
    `fl-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const projectCwd = path.join(cleanupRoot, "project");

  try {
    await mkdir(projectCwd, { recursive: true, mode: 0o700 });

    const excludeSet = new Set([".git", "node_modules", ...excludes]);
    const filter = (src: string): boolean => {
      const rel = path.relative(sourcePath, src);
      if (!rel || rel === ".") return true;
      return !rel.split(path.sep).some((part) => excludeSet.has(part));
    };

    await cp(sourcePath, projectCwd, { recursive: true, filter });
    await materializeDependencySet(
      sourcePath,
      projectCwd,
      cleanupRoot,
      RUNTIME_DEPENDENCY_DIRECTORIES,
    );

    return { projectCwd, cleanupRoot };
  } catch (error) {
    await rm(cleanupRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
