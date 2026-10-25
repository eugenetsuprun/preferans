import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Each experiment gets an immutable module snapshot. Relative imports remain
// ordinary files, so model weights do not get embedded in nested data URLs.
export async function loadRuntime() {
  const folder = mkdtempSync(join(tmpdir(), "preferans-runtime-"));
  const src = new URL("../src/", import.meta.url);
  const compile = (source) =>
    ts
      .transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      })
      .outputText.replace(
        /(from\s+["'])(\.\/[^"']+)(["'])/g,
        (_, prefix, specifier, suffix) => `${prefix}${specifier}.mjs${suffix}`,
      );
  for (const name of readdirSync(src))
    if (
      name.endsWith(".ts") &&
      !name.endsWith(".d.ts") &&
      !name.includes(".test.") &&
      !name.includes(".worker.")
    )
      writeFileSync(
        join(folder, name.replace(/\.ts$/, ".mjs")),
        compile(readFileSync(new URL(name, src), "utf8")),
      );
  const baselineRef = process.env.BASELINE_REF || "b542e19";
  const baselineSource = process.env.BASELINE_FILE
    ? readFileSync(process.env.BASELINE_FILE, "utf8")
    : execFileSync("git", ["show", `${baselineRef}:src/ai.ts`], {
        encoding: "utf8",
      });
  writeFileSync(join(folder, "baseline.mjs"), compile(baselineSource));
  const candidateName = process.env.CANDIDATE_MODULE || "bot";
  const candidateSource =
    readdirSync(src)
      .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
      .map((name) => name + readFileSync(new URL(name, src), "utf8"))
      .join("\n") +
    candidateName +
    (process.env.CANDIDATE_EXPORT || "botAction");
  const candidateModule = await import(
    pathToFileURL(join(folder, `${candidateName}.mjs`))
  );
  return {
    folder,
    baselineRef,
    candidateHash: createHash("sha256").update(candidateSource).digest("hex"),
    engine: await import(pathToFileURL(join(folder, "engine.mjs"))),
    baseline: await import(pathToFileURL(join(folder, "baseline.mjs"))),
    candidate: {
      botAction: candidateModule[process.env.CANDIDATE_EXPORT || "botAction"],
    },
  };
}
