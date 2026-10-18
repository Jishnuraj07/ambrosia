import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a model-supplied path inside the project root, or throw. The model's
 * path is untrusted output: `..` and absolute paths outside the root are refused,
 * and existing paths are canonicalised so a symlink can't point outside either.
 */
export function confine(root: string, requested: string): string {
  const base = fs.realpathSync(path.resolve(root));
  const target = path.resolve(base, requested);
  let real = target;
  try {
    real = fs.realpathSync(target);
  } catch {
    // New file: check its nearest existing parent instead.
    let parent = path.dirname(target);
    while (!fs.existsSync(parent) && path.dirname(parent) !== parent) parent = path.dirname(parent);
    real = path.join(fs.realpathSync(parent), path.relative(parent, target));
  }
  const rel = path.relative(base, real);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`path escapes the project root: ${requested}`);
  }
  return real;
}

const RISKY = [
  /\brm\s+-[a-z]*r/i,
  /\bRemove-Item\b/i,
  /\b(del|erase|rmdir|rd)\s/i,
  /\bgit\s+(push|reset\s+--hard|clean|checkout\s+--|rebase)/i,
  /--force\b/i,
  /\b(format|mkfs|diskpart|shutdown|Stop-Computer|Restart-Computer)\b/i,
  /\b(npm|pnpm|yarn)\s+publish\b/i,
  /\bcurl\b.*\|\s*(sh|bash|iex)/i,
  /\bInvoke-Expression\b|\biex\b/i,
];

/** Commands the Oracle warns about. Approving one that then fails earns the Icarus labour. */
export function isRisky(command: string): boolean {
  return RISKY.some((re) => re.test(command));
}
