// Shared helpers for the sdlc plugin scripts. No dependencies beyond Node 20.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const STAGES = ["propose", "tests", "build", "verify", "ship"];

export const DEFAULT_CONFIG = {
  srcDirs: ["src"],
  testDirs: ["test"],
  testCommand: "npm test",
  typecheckCommand: "",
  testFilePattern: "\\.(test|spec)\\.[cm]?[jt]sx?$|_test\\.(py|go)$|^test_.*\\.py$",
};

export function projectDir(start = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  // Walk up to the directory that holds .sdlc/ or openspec/, else use start.
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".sdlc")) || existsSync(join(dir, "openspec"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export const sdlcDir = (root) => join(root, ".sdlc");
export const configPath = (root) => join(sdlcDir(root), "config.json");
export const statePath = (root) => join(sdlcDir(root), "state.json");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function loadConfig(root) {
  return { ...DEFAULT_CONFIG, ...(readJson(configPath(root)) || {}) };
}

export function saveConfig(root, config) {
  mkdirSync(sdlcDir(root), { recursive: true });
  writeFileSync(configPath(root), JSON.stringify(config, null, 2) + "\n");
}

export function loadState(root) {
  return readJson(statePath(root));
}

export function saveState(root, state) {
  mkdirSync(sdlcDir(root), { recursive: true });
  writeFileSync(statePath(root), JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) + "\n");
}

/** Project-relative POSIX path, or null if the path is outside the project. */
export function toRel(root, filePath) {
  if (!filePath) return null;
  const abs = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/** True if rel is dir itself or inside it. */
export function within(rel, dir) {
  const d = dir.replace(/\/+$/, "");
  return rel === d || rel.startsWith(d + "/");
}

export function walk(dir, keep = () => true) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".git") return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, keep) : keep(p) ? [p] : [];
  });
}

export function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function isTestFile(config, relPath) {
  const re = new RegExp(config.testFilePattern);
  const base = relPath.split("/").pop();
  return config.testDirs.some((d) => within(relPath, d)) && (re.test(relPath) || re.test(base));
}

/** Map of project-relative path -> sha256 for every file under the given dirs. */
export function snapshot(root, dirs, keep = () => true) {
  const out = {};
  for (const d of dirs) {
    for (const file of walk(join(root, d))) {
      const rel = toRel(root, file);
      if (rel && keep(rel)) out[rel] = hashFile(file);
    }
  }
  return out;
}

/** Paths whose content differs from a snapshot: changed, deleted or (optionally) added. */
export function diffSnapshot(root, before, dirs, { includeAdded = true, keep = () => true } = {}) {
  const now = snapshot(root, dirs, keep);
  const changed = [];
  for (const [p, h] of Object.entries(before)) {
    if (!(p in now)) changed.push(`${p} (deleted)`);
    else if (now[p] !== h) changed.push(`${p} (modified)`);
  }
  if (includeAdded) for (const p of Object.keys(now)) if (!(p in before)) changed.push(`${p} (added)`);
  return changed;
}

export const CHANGE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
