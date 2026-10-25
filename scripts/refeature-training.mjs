import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadRuntime } from "./runtime.mjs";
const { engine: e, candidate: ai, folder } = await loadRuntime();
const { handFeatures } = await import(
  pathToFileURL(join(folder, "hand-features.mjs"))
);
const path = process.env.TRAIN_DATA || "/tmp/preferans-training.jsonl";
const rows = readFileSync(path, "utf8").trim().split("\n").map(JSON.parse);
function rng(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
for (const row of rows) {
  if (!row.discarded) {
    const n = row.seed - Number(process.env.TRAIN_SEED || 1000001);
    let g = e.deal(
      { difficulty: "medium", target: 100, speed: 0 },
      undefined,
      rng(row.seed),
    );
    g.first = row.first;
    g.turn = 0;
    g = e.step(g, { type: "bid", bid: row.trump });
    g = e.step(e.step(g, { type: "pass" }), { type: "pass" });
    const cards =
      n % 4 === 0
        ? g.hands[0].slice(n % 10, (n % 10) + 2)
        : ai.botAction(g).cards;
    const left = g.hands[0].filter((c) => !cards.includes(c));
    if (JSON.stringify(left) !== JSON.stringify(row.hand))
      throw Error(`Cannot reconstruct discard for ${row.seed}`);
    row.discarded = cards;
  }
  row.features = handFeatures(row.hand, row.trump, row.first, row.discarded);
}
writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
console.log(
  JSON.stringify({ rows: rows.length, features: rows[0].features.length }),
);
