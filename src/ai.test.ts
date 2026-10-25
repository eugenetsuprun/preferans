import { afterEach, describe, expect, it, vi } from "vitest";
import { botAction, choosePlay, solveRaspasy } from "./ai";
import {
  CONTRACTS,
  deal,
  legalCards,
  outcomeScores,
  step,
  whistChoices,
  type Game,
} from "./engine";

function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
const fresh = () =>
  deal({ difficulty: "hard", target: 30, speed: 0 }, undefined, seeded(42));
afterEach(() => vi.restoreAllMocks());

describe("hard bidding", () => {
  it("chooses a higher contract with ten guaranteed tricks", () => {
    const g = fresh();
    g.phase = "contract";
    g.declarer = g.turn = 0;
    g.highest = 0;
    g.hands = [
      Array.from({ length: 8 }, (_, c) => c).concat([15, 23]),
      [8, 9, 10, 11, 12, 13, 14, 16, 17, 18],
      [19, 20, 21, 22, 24, 25, 26, 27, 28, 29],
    ];
    g.discarded = [30, 31];
    g.kitty = [15, 23];
    vi.spyOn(Math, "random").mockImplementation(seeded(12));
    expect(botAction(g)).toEqual({ type: "contract", bid: 21 });
  });

  it("does not read the real opponents or hidden kitty in the auction", () => {
    const g = fresh(),
      changed = structuredClone(g);
    const hidden = [...g.hands[1], ...g.hands[2], ...g.kitty].reverse();
    changed.hands[1] = hidden.slice(0, 10);
    changed.hands[2] = hidden.slice(10, 20);
    changed.kitty = hidden.slice(20);
    const random = vi.spyOn(Math, "random").mockImplementation(seeded(123));
    const before = structuredClone(g),
      a = botAction(g);
    random.mockImplementation(seeded(123));
    expect(botAction(changed)).toEqual(a);
    expect(g).toEqual(before);
  });

  it("evaluates whist without reading hidden hands or discard", () => {
    let g = fresh();
    g = step(g, { type: "bid", bid: 0 });
    g = step(step(g, { type: "pass" }), { type: "pass" });
    g = step(g, { type: "discard", cards: g.hands[0].slice(0, 2) });
    g = step(g, { type: "contract", bid: 0 });
    const changed = structuredClone(g),
      original = structuredClone(g);
    const hidden = [changed.hands[0], changed.hands[2], changed.discarded];
    const pool = hidden
      .flat()
      .filter((c) => !g.kitty.includes(c))
      .reverse();
    for (const hand of hidden)
      for (let i = 0; i < hand.length; i++)
        if (!g.kitty.includes(hand[i])) hand[i] = pool.pop()!;
    const random = vi.spyOn(Math, "random").mockImplementation(seeded(22));
    const chosen = botAction(g);
    random.mockImplementation(seeded(22));
    expect(botAction(changed)).toEqual(chosen);
    expect(
      chosen.type === "whist" && whistChoices(g).includes(chosen.choice),
    ).toBe(true);
    expect(g).toEqual(original);
  });
});

describe("search payoff", () => {
  it.each([0, 9, 15])("matches actual scoring for contract %i", (bid) => {
    const g = fresh();
    g.phase = "trick";
    g.declarer = 0;
    g.contract = CONTRACTS[bid];
    g.whists = ["wait", "whist", "whist"];
    g.history = Array.from({ length: 9 }, () => []);
    g.lastWinner = 0;
    g.taken = [5, 2, 2];
    g.scores[0].pool = g.settings.target;
    const before = structuredClone(g);
    expect(outcomeScores(g, [6, 2, 2])).toEqual(
      step(g, { type: "collect" }).scores,
    );
    expect(g).toEqual(before);
  });
});

describe("raspasy search", () => {
  function endgame(): Game {
    const g = fresh();
    g.phase = "play";
    g.hands = [
      [0, 7],
      [1, 8],
      [2, 9],
    ];
    g.kitty = [30, 31];
    const played = Array.from({ length: 32 }, (_, c) => c).filter(
      (c) => !g.hands.flat().includes(c) && !g.kitty.includes(c),
    );
    g.history = Array.from({ length: 8 }, (_, i) =>
      played
        .slice(i * 3, i * 3 + 3)
        .map((card, seat) => ({ card, seat: seat as 0 | 1 | 2 })),
    );
    g.taken = [3, 3, 2];
    return g;
  }

  it("looks ahead to avoid being forced to take both remaining tricks", () => {
    const g = endgame(),
      original = structuredClone(g);
    expect(solveRaspasy(g, { nodes: 10000 })).toEqual([3, 3, 4]);
    expect(g).toEqual(original);
    // The same exit remains safe across the possible hidden allocations.
    g.voids = [[], [2, 3], [2, 3]];
    expect(choosePlay(g, 0, seeded(7))).toBe(0);
  });

  it("matches rule-engine enumeration in a forced endgame", () => {
    const g = endgame();
    function enumerate(w: Game): number[][] {
      if (w.phase === "result") return [w.taken];
      if (w.phase === "trick") return enumerate(step(w, { type: "collect" }));
      const outcomes = legalCards(w).flatMap((card) =>
        enumerate(step(w, { type: "play", card })),
      );
      const best = Math.min(...outcomes.map((v) => v[w.turn]));
      return outcomes.filter((v) => v[w.turn] === best);
    }
    expect(enumerate(g)).toContainEqual(solveRaspasy(g, { nodes: 10000 }));
  });

  it("preserves the lead needed to make a contract", () => {
    const g = endgame();
    g.declarer = 0;
    g.contract = CONTRACTS[0];
    g.highest = 0;
    g.open = true;
    g.discarded = g.kitty.slice();
    g.whists = ["wait", "whist", "whist"];
    g.taken = [4, 3, 1];
    // Cash the ace, then the small trump. Leading the small trump first
    // gives away a trick and leaves the six-trick contract one short.
    expect(choosePlay(g, 0, seeded(8))).toBe(7);
  });

  it("leads under the declarer on misere rather than giving a free discard", () => {
    const g = endgame();
    g.hands = [
      [2, 7],
      [0, 8],
      [1, 9],
    ];
    g.declarer = 0;
    g.contract = CONTRACTS[15];
    g.highest = 15;
    g.turn = g.first = 1;
    g.open = true;
    g.controller = 1;
    g.discarded = g.kitty.slice();
    g.taken = [0, 4, 4];
    expect(choosePlay(g, 1, seeded(9))).toBe(0);
  });

  it("does not use the unrevealed second kitty card", () => {
    let g = fresh();
    for (let i = 0; i < 3; i++) g = step(g, { type: "pass" });
    const changed = structuredClone(g);
    [changed.kitty[1], changed.hands[1][0]] = [
      changed.hands[1][0],
      changed.kitty[1],
    ];
    expect(choosePlay(g, 0, seeded(91))).toBe(
      choosePlay(changed, 0, seeded(91)),
    );
  });
});
