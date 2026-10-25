import { appendFileSync, writeFileSync } from "node:fs";
import { loadRuntime } from "./runtime.mjs";

const deals = Number(process.env.EVAL_DEALS || 48);
const startSeed = Number(process.env.EVAL_SEED || 20001);
const suiteDeals = Number(process.env.SUITE_DEALS || 12);
const {
  baselineRef,
  candidateHash,
  engine: e,
  baseline,
  candidate,
} = await loadRuntime();
function rng(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function action(ai, g, seed) {
  const original = Math.random;
  Math.random = rng(seed);
  try {
    return ai.botAction(g, e.actor(g));
  } finally {
    Math.random = original;
  }
}
function finish(initial, ais, seed) {
  let g = structuredClone(initial),
    actions = 0;
  const trajectory = [];
  const gameId = `${seed}:${initial.phase}:${initial.contract ? e.label(initial.contract) : "none"}:${ais.map((ai) => (ai === candidate ? "C" : "B")).join("")}`;
  while (g.phase !== "result") {
    if (++actions > 200) throw Error("Unfinished deal");
    const observer = e.actor(g);
    const chosen =
      g.phase === "trick"
        ? { type: "collect" }
        : action(ais[observer], g, seed * 1000 + actions);
    if (process.env.TRAJECTORIES && g.phase !== "trick") {
      const visible = new Set([observer]);
      if (g.open && g.declarer !== null)
        for (let seat = 0; seat < 3; seat++)
          if (seat !== g.declarer) visible.add(seat);
      trajectory.push({
        gameId,
        seed,
        step: actions,
        policy: ais[observer] === candidate ? "candidate" : "baseline",
        policyVersion:
          ais[observer] === candidate
            ? candidateHash
            : process.env.BASELINE_FILE || baselineRef,
        observation: {
          observer,
          phase: g.phase,
          turn: g.turn,
          first: g.first,
          // Masked hands, private discard and unrevealed kitty are excluded.
          hands: g.hands.map((h, seat) =>
            visible.has(seat) ? h.slice() : null,
          ),
          handSizes: g.hands.map((h) => h.length),
          kitty:
            g.declarer === null
              ? g.kitty.slice(
                  0,
                  g.phase === "auction" ? 0 : Math.min(2, g.history.length + 1),
                )
              : g.kitty,
          discarded: observer === g.declarer ? g.discarded : null,
          table: g.table,
          history: g.history,
          taken: g.taken,
          voids: g.voids,
          highest: g.highest,
          bids: g.bids,
          passed: g.passed,
          calls: g.calls,
          contract: g.contract,
          declarer: g.declarer,
          whists: g.whists,
          open: g.open,
          controller: g.controller,
          scores: g.scores,
        },
        action: chosen,
      });
    }
    g = e.step(g, chosen);
  }
  if (trajectory.length) {
    const rewards = value(g);
    appendFileSync(
      process.env.TRAJECTORIES,
      trajectory
        .map((row) =>
          JSON.stringify({
            ...row,
            reward: rewards[row.observation.observer],
            finalTaken: g.taken,
          }),
        )
        .join("\n") + "\n",
    );
  }
  return g;
}
// A pool point removes one point of future obligation. Subtracting pool from
// hill values unfinished pools on the same scale as completed match scores.
const value = (g) =>
  e.totals(g.scores.map((s) => ({ ...s, hill: s.hill - s.pool })));
const fresh = (seed) => {
  const g = e.deal(
    { difficulty: "hard", speed: 0, target: 100 },
    undefined,
    rng(seed),
  );
  g.first = g.turn = seed % 3;
  g.dealer = (g.first + 2) % 3;
  return g;
};
const empty = () => ({
  comparisons: 0,
  scoreDelta: 0,
  better: 0,
  tied: 0,
  worse: 0,
  baselineValue: 0,
  candidateValue: 0,
});
const competitive = empty(),
  roles = { declarer: empty(), defender: empty(), raspasy: empty() };
function record(stats, oldValue, newValue) {
  const delta = Math.round((newValue - oldValue) * 100) / 100;
  stats.comparisons++;
  stats.scoreDelta += delta;
  stats.baselineValue += oldValue;
  stats.candidateValue += newValue;
  stats[delta > 0.01 ? "better" : delta < -0.01 ? "worse" : "tied"]++;
}
console.log(
  `Overall evaluation: ${deals} competitive deals, ${suiteDeals} deals per forced contract.`,
);
for (let n = 0; n < deals; n++) {
  const seed = startSeed + n,
    g = fresh(seed);
  const control = finish(g, [baseline, baseline, baseline], seed);
  const oldValues = value(control);
  for (let seat = 0; seat < 3; seat++) {
    const ais = [baseline, baseline, baseline];
    ais[seat] = candidate;
    const result = finish(g, ais, seed),
      newValue = value(result)[seat];
    record(competitive, oldValues[seat], newValue);
    const role =
      result.declarer === null
        ? "raspasy"
        : result.declarer === seat
          ? "declarer"
          : "defender";
    record(roles[role], oldValues[seat], newValue);
  }
  if ((n + 1) % 8 === 0)
    console.log("competitive", n + 1, JSON.stringify(competitive));
}
const contracts = {};
for (const [name, bid] of [
  ["sixTrump", 0],
  ["sevenNoTrump", 9],
  ["misere", e.MISERE],
  ["raspasy", -1],
]) {
  const stats = (contracts[name] = empty());
  for (let n = 0; n < suiteDeals; n++) {
    const seed = startSeed + 1000 + n,
      g = fresh(seed);
    // Identical initial hands and contract for all four versions of this deal.
    g.turn = 0;
    let initial;
    if (bid < 0) {
      initial = e.step(e.step(e.step(g, { type: "pass" }), { type: "pass" }), {
        type: "pass",
      });
    } else {
      initial = e.step(g, { type: "bid", bid });
      initial = e.step(e.step(initial, { type: "pass" }), { type: "pass" });
      initial = e.step(initial, action(baseline, initial, seed));
      initial = e.step(initial, { type: "contract", bid });
      if (!initial.contract.misere) {
        initial = e.step(e.step(initial, { type: "whist", choice: "whist" }), {
          type: "whist",
          choice: "whist",
        });
      }
    }
    const control = finish(initial, [baseline, baseline, baseline], seed);
    const oldValues = value(control);
    for (let seat = 0; seat < 3; seat++) {
      const ais = [baseline, baseline, baseline];
      ais[seat] = candidate;
      const result = finish(initial, ais, seed);
      record(stats, oldValues[seat], value(result)[seat]);
    }
  }
  console.log(name, JSON.stringify(stats));
}
const result = {
  baseline: process.env.BASELINE_FILE || baselineRef,
  candidateHash,
  startSeed,
  deals,
  suiteDeals,
  competitive,
  roles,
  contracts,
  method:
    "Matched seeded independent deals with each candidate seat rotated against two baseline bots; competitive auctions and normal whist/open-hand control. Unfinished pool valued as hill minus pool. Forced contract suite isolates card play. Wall-clock search budgets may affect reproducibility.",
};
if (process.env.EVAL_OUTPUT)
  writeFileSync(
    process.env.EVAL_OUTPUT,
    JSON.stringify(result, null, 2) + "\n",
  );
console.log(JSON.stringify(result, null, 2));
