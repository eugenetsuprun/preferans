import { loadRuntime } from "./runtime.mjs";
const hands = Number(process.env.SIM_HANDS || 12);
const biddingHands = Number(process.env.BID_HANDS || 120);
const {
  baselineRef,
  engine,
  baseline: before,
  candidate: after,
} = await loadRuntime();
function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function action(ai, g, seed) {
  const original = Math.random;
  Math.random = seeded(seed);
  try {
    return ai.botAction(g, engine.actor(g));
  } finally {
    Math.random = original;
  }
}
const settings = { difficulty: "hard", target: 100, speed: 0 };
function finish(initial, ais, seed) {
  let g = structuredClone(initial),
    ply = 0;
  while (g.phase !== "result") {
    if (++ply > 100) throw Error("Play did not finish");
    g = engine.step(
      g,
      g.phase === "trick"
        ? { type: "collect" }
        : action(ais[g.turn], g, seed * 1000 + ply),
    );
  }
  if (g.taken.reduce((a, b) => a + b, 0) !== 10) throw Error("Lost a trick");
  return g;
}
console.log(
  `Baseline ${baselineRef}; ${hands} raspasy deals, all 3 candidate seats; ${biddingHands} bidding hands.`,
);
const raspasy = {
  baselineTricks: 0,
  candidateTricks: 0,
  comparisons: 0,
  better: 0,
  tied: 0,
  worse: 0,
};
for (let seed = 1; seed <= hands; seed++) {
  let g = engine.deal(settings, undefined, seeded(seed));
  for (let p = 0; p < 3; p++) g = engine.step(g, { type: "pass" });
  const control = finish(g, [before, before, before], seed);
  for (let seat = 0; seat < 3; seat++) {
    const ais = [before, before, before];
    ais[seat] = after;
    const result = finish(g, ais, seed);
    raspasy.baselineTricks += control.taken[seat];
    raspasy.candidateTricks += result.taken[seat];
    raspasy.comparisons++;
    raspasy[
      result.taken[seat] < control.taken[seat]
        ? "better"
        : result.taken[seat] === control.taken[seat]
          ? "tied"
          : "worse"
    ]++;
  }
  console.log("raspasy", seed, JSON.stringify(raspasy));
}
const bidding = [before, after].map(() => ({
  bids: 0,
  passes: 0,
  miseres: 0,
  levels: 0,
  made: 0,
  undertricks: 0,
}));
for (let seed = 1; seed <= biddingHands; seed++) {
  const g = engine.deal(settings, undefined, seeded(seed + 10000));
  for (const [i, ai] of [before, after].entries()) {
    const bid = action(ai, g, seed);
    if (bid.type === "pass") {
      bidding[i].passes++;
      continue;
    }
    if (bid.bid === engine.MISERE) {
      bidding[i].miseres++;
      continue;
    }
    bidding[i].bids++;
    let w = engine.step(g, bid);
    w = engine.step(engine.step(w, { type: "pass" }), { type: "pass" });
    w = engine.step(w, action(ai, w, seed + 20000));
    w = engine.step(w, action(ai, w, seed + 30000));
    bidding[i].levels += w.contract.level;
    // Identical independent play evaluator for both bidding policies.
    w.phase = "play";
    w.turn = w.first;
    w.whists = ["wait", "whist", "whist"];
    w.settings = { ...w.settings, difficulty: "medium" };
    const result = finish(w, [before, before, before], seed + 40000);
    bidding[i].made += Number(result.taken[0] >= w.contract.level);
    bidding[i].undertricks += Math.max(0, w.contract.level - result.taken[0]);
  }
  if (seed % 20 === 0) console.log("bidding", seed, JSON.stringify(bidding));
}
console.log(
  JSON.stringify(
    {
      baselineRef,
      hands,
      biddingHands,
      raspasy,
      bidding: { before: bidding[0], after: bidding[1] },
    },
    null,
    2,
  ),
);
