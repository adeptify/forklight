import { cp, lstat, mkdir, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Copy the current original project to an isolated temporary verification
 * directory.  Excluded directories (.git, node_modules, configured excludes)
 * are not copied.  If the source has a node_modules directory it is
 * symlinked rather than copied so dependency resolution works.
 *
 * Extracted from integration.ts so that the Main remediation verification
 * service can reuse the same isolated-acceptance pattern without changing
 * Integration behavior.
 */
export async function copyForVerification(
  sourcePath: string,
  excludes: string[],
): Promise<string> {
  const tmpDir = path.join(
    tmpdir(),
    `fl-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmpDir, { recursive: true, mode: 0o700 });

  const excludeSet = new Set([".git", "node_modules", ...excludes]);
  const filter = (src: string): boolean => {
    const rel = path.relative(sourcePath, src);
    if (!rel || rel === ".") return true;
    return !rel.split(path.sep).some((part) => excludeSet.has(part));
  };

  await cp(sourcePath, tmpDir, { recursive: true, filter });

  const srcModules = path.join(sourcePath, "node_modules");
  try {
    const st = await lstat(srcModules);
    const dependencyPath = st.isSymbolicLink()
      ? await realpath(srcModules)
      : srcModules;
    if ((await lstat(dependencyPath)).isDirectory()) {
      await symlink(dependencyPath, path.join(tmpDir, "node_modules"), "dir");
    }
  } catch {
    // No node_modules in source — fine for simple projects
  }

  return tmpDir;
}
