import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";
import { loadRuntime } from "./runtime.mjs";

function rng(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
if (isMainThread) {
  const games = Number(process.env.TRAIN_GAMES || 12000),
    workers = Number(process.env.TRAIN_WORKERS || 4);
  const runtime = await loadRuntime(),
    output = process.env.TRAIN_DATA || "/tmp/preferans-training.jsonl";
  let complete = 0;
  const batches = await Promise.all(
    Array.from(
      { length: workers },
      (_, index) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(new URL(import.meta.url), {
            workerData: {
              folder: runtime.folder,
              index,
              workers,
              games,
              start: Number(process.env.TRAIN_SEED || 1000001),
            },
          });
          worker.on("message", (message) => {
            if (message.progress) {
              complete += message.progress;
              console.log(`training labels ${complete}/${games}`);
            }
            if (message.output) resolve(message.output);
          });
          worker.on("error", reject);
          worker.on("exit", (code) => {
            if (code) reject(Error(`Worker exited ${code}`));
          });
        }),
    ),
  );
  writeFileSync(
    output,
    batches.map((path) => readFileSync(path, "utf8")).join(""),
  );
  console.log(
    JSON.stringify({
      games,
      workers,
      output,
      teacher:
        "Current medium bot, 16 samples; all players use only their observations",
      candidateHash: runtime.candidateHash,
    }),
  );
} else {
  const e = await import(pathToFileURL(join(workerData.folder, "engine.mjs")));
  const ai = await import(pathToFileURL(join(workerData.folder, "ai.mjs")));
  const { handFeatures } = await import(
    pathToFileURL(join(workerData.folder, "hand-features.mjs"))
  );
  const rows = [];
  for (
    let n = workerData.index;
    n < workerData.games;
    n += workerData.workers
  ) {
    const seed = workerData.start + n;
    Math.random = rng(seed * 97);
    let g = e.deal(
      { difficulty: "medium", target: 100, speed: 0 },
      undefined,
      rng(seed),
    );
    g.first = seed % 3;
    g.dealer = (g.first + 2) % 3;
    g.turn = 0;
    const scores = [0, 1, 2, 3].map((s) =>
      g.hands[0]
        .filter((c) => e.suit(c) === s)
        .reduce((sum, c) => sum + 1 + e.rank(c) * 0.12, 0),
    );
    const tr =
      n % 5 === 0
        ? 4
        : n % 5 === 1
          ? n % 4
          : scores.indexOf(Math.max(...scores));
    g = e.step(g, { type: "bid", bid: tr });
    g = e.step(e.step(g, { type: "pass" }), { type: "pass" });
    const cards =
      n % 4 === 0
        ? g.hands[0].slice(n % 10, (n % 10) + 2)
        : ai.chooseDiscard(g);
    g = e.step(g, { type: "discard", cards });
    g = e.step(g, { type: "contract", bid: tr });
    g = e.step(e.step(g, { type: "whist", choice: "whist" }), {
      type: "whist",
      choice: "whist",
    });
    const hand = g.hands[0].slice(),
      features = handFeatures(hand, tr, g.first, g.discarded);
    let actions = 0;
    while (g.phase !== "result") {
      if (++actions > 100) throw Error("Unfinished training game");
      g = e.step(
        g,
        g.phase === "trick" ? { type: "collect" } : ai.botAction(g, e.actor(g)),
      );
    }
    rows.push(
      JSON.stringify({
        seed,
        hand,
        trump: tr,
        first: seed % 3,
        features,
        discarded: cards,
        tricks: g.taken[0],
      }),
    );
    if (rows.length % 100 === 0) parentPort.postMessage({ progress: 100 });
  }
  const output = join(workerData.folder, `labels-${workerData.index}.jsonl`);
  writeFileSync(output, rows.join("\n") + "\n");
  parentPort.postMessage({ output });
}
