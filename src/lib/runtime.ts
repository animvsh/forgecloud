import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb, type RuntimeCheck } from "./db";
import type { CodeFile } from "./ai";

type CheckStatus = "passed" | "failed";

type CheckInput = {
  projectId: string;
  runId: string;
  taskId: string;
  files: CodeFile[];
};

type CheckResult = {
  status: CheckStatus;
  checks: RuntimeCheck[];
  artifactDir: string;
};

const MAX_FILES = 20;
const MAX_FILE_BYTES = 200_000;
const ARTIFACT_ROOT = process.env.FORGECLOUD_RUNTIME_ARTIFACT_DIR
  ? path.resolve(process.env.FORGECLOUD_RUNTIME_ARTIFACT_DIR)
  : process.env.INSFORGE_DB_PATH
    ? path.join(path.dirname(path.resolve(process.env.INSFORGE_DB_PATH)), "runtime-artifacts")
    : path.resolve(process.cwd(), ".data", "runtime-artifacts");

export function getRuntimeArtifactRoot(): string {
  return ARTIFACT_ROOT;
}

const SECRET_PATTERNS = [
  /sk-(?:proj-|ant-|test-|live-|org-|prod-)[A-Za-z0-9_-]{16,}/i,
  /sk_(?:live|test)_[A-Za-z0-9]{12,}/i,
  /pk_(?:live|test)_[A-Za-z0-9]{12,}/i,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /AIza[0-9A-Za-z_-]{35}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /xox[abp]-[a-zA-Z0-9-]+/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
];

export async function runCodingTaskChecks(input: CheckInput): Promise<CheckResult> {
  const artifactDir = path.join(ARTIFACT_ROOT, input.runId);
  const checks: RuntimeCheck[] = [];

  const validation = validateGeneratedFiles(input.files);
  checks.push(
    recordRuntimeCheck({
      ...input,
      checkType: "generated_files",
      status: validation.length > 0 ? "failed" : "passed",
      summary:
        validation.length > 0
          ? `Generated file validation failed: ${validation.join("; ")}`
          : `Validated ${input.files.length} generated file${input.files.length === 1 ? "" : "s"}`,
    }),
  );

  const secretHits = scanForSecrets(input.files);
  checks.push(
    recordRuntimeCheck({
      ...input,
      checkType: "secret_scan",
      status: secretHits.length > 0 ? "failed" : "passed",
      summary:
        secretHits.length > 0
          ? `Potential secret found in ${secretHits.join(", ")}`
          : "No hardcoded credential patterns found in generated files",
    }),
  );

  if (validation.length > 0 || secretHits.length > 0) {
    return { status: "failed", checks, artifactDir };
  }

  const manifest = await writeArtifacts(artifactDir, input.files);
  checks.push(
    recordRuntimeCheck({
      ...input,
      checkType: "artifact_manifest",
      status: "passed",
      summary: `Stored generated artifact manifest with ${manifest.files.length} file${manifest.files.length === 1 ? "" : "s"}`,
      artifactPath: path.join(artifactDir, "manifest.json"),
      stdout: JSON.stringify(manifest, null, 2),
    }),
  );

  return { status: "passed", checks, artifactDir };
}

function validateGeneratedFiles(files: CodeFile[]): string[] {
  const failures: string[] = [];
  if (!Array.isArray(files) || files.length === 0) {
    failures.push("no files were generated");
    return failures;
  }
  if (files.length > MAX_FILES) {
    failures.push(`generated ${files.length} files, max is ${MAX_FILES}`);
  }

  const seen = new Set<string>();
  for (const file of files) {
    const safePath = normalizeSafePath(file.path);
    if (!safePath) {
      failures.push(`unsafe path "${file.path}"`);
      continue;
    }
    if (seen.has(safePath)) failures.push(`duplicate path "${safePath}"`);
    seen.add(safePath);
    if (typeof file.content !== "string" || file.content.trim().length === 0) {
      failures.push(`${safePath} is empty`);
    }
    if (Buffer.byteLength(file.content ?? "", "utf8") > MAX_FILE_BYTES) {
      failures.push(`${safePath} exceeds ${MAX_FILE_BYTES} bytes`);
    }
  }
  return failures;
}

function normalizeSafePath(filePath: string): string | null {
  if (!filePath || path.isAbsolute(filePath)) return null;
  const normalized = path.posix.normalize(filePath.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.startsWith(".env") ||
    normalized.includes("/.env") ||
    normalized.startsWith("node_modules/") ||
    normalized.startsWith("dist/") ||
    normalized.startsWith(".git/")
  ) {
    return null;
  }
  return normalized;
}

function scanForSecrets(files: CodeFile[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(file.content))) {
      hits.push(file.path);
    }
  }
  return hits;
}

async function writeArtifacts(artifactDir: string, files: CodeFile[]) {
  await mkdir(path.join(artifactDir, "files"), { recursive: true });
  const manifest = {
    createdAt: new Date().toISOString(),
    files: [] as Array<{
      path: string;
      language: string;
      bytes: number;
      sha256: string;
    }>,
  };

  for (const file of files) {
    const safePath = normalizeSafePath(file.path);
    if (!safePath) throw new Error(`Unsafe path reached artifact writer: ${file.path}`);
    const target = path.join(artifactDir, "files", safePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
    manifest.files.push({
      path: safePath,
      language: file.language,
      bytes: Buffer.byteLength(file.content, "utf8"),
      sha256: createHash("sha256").update(file.content).digest("hex"),
    });
  }

  await writeFile(path.join(artifactDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

function recordRuntimeCheck(input: {
  projectId: string;
  runId: string;
  taskId: string;
  checkType: string;
  status: CheckStatus;
  summary: string;
  artifactPath?: string;
  stdout?: string;
  stderr?: string;
}): RuntimeCheck {
  const db = getDb();
  const id = `chk-${randomUUID()}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO runtime_checks (
      id, project_id, agent_run_id, task_id, check_type, status, command,
      exit_code, stdout, stderr, summary, artifact_path, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.runId,
    input.taskId,
    input.checkType,
    input.status,
    input.checkType,
    input.status === "passed" ? 0 : 1,
    input.stdout ?? null,
    input.stderr ?? null,
    input.summary,
    input.artifactPath ?? null,
    now,
    now,
  );
  return db.prepare("SELECT * FROM runtime_checks WHERE id = ?").get(id) as RuntimeCheck;
}
