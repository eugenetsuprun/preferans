import { describe, expect, it } from "vitest";
import { handFeatures } from "./hand-features";
import { handModel } from "./hand-model";
import { trickDistribution } from "./hand-value";
import { botAction } from "./ai-trained";
import { deal, step } from "./engine";

describe("trained hand evaluator", () => {
  it("matches the exported PyTorch reference probabilities", () => {
    const check = handModel.parityCheck;
    const probabilities = trickDistribution(
      check.hand,
      check.trump,
      check.first,
      check.discarded,
    );
    expect(probabilities).toHaveLength(11);
    expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    probabilities.forEach((p, i) => {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeCloseTo(check.probabilities[i], 4);
    });
  });

  it("shares rank patterns across equivalent suits", () => {
    const hand = [0, 2, 5, 7, 8, 10, 15, 20, 22, 31],
      discarded = [16, 25];
    const permutation = [2, 0, 3, 1],
      move = (c: number) => permutation[Math.floor(c / 8)] * 8 + (c % 8);
    expect(handFeatures(hand, 2, 1, discarded)).toEqual(
      handFeatures(hand.map(move), permutation[2], 1, discarded.map(move)),
    );
    expect(handFeatures(hand, 2, 1, discarded)).toHaveLength(
      handModel.features,
    );
  });

  it("uses the player's known discard in its observation", () => {
    const hand = [0, 2, 5, 7, 8, 10, 15, 20, 22, 31];
    expect(handFeatures(hand, 2, 1, [16, 25])).not.toEqual(
      handFeatures(hand, 2, 1, [17, 26]),
    );
  });

  it("chooses a legal discard independently of the real hidden hands", () => {
    let g = deal(
      { difficulty: "hard", speed: 0, target: 30 },
      undefined,
      () => 0.41,
    );
    g = step(g, { type: "bid", bid: 0 });
    g = step(step(g, { type: "pass" }), { type: "pass" });
    const changed = structuredClone(g),
      original = structuredClone(g);
    [changed.hands[1], changed.hands[2]] = [changed.hands[2], changed.hands[1]];
    const action = botAction(g);
    expect(botAction(changed)).toEqual(action);
    expect(action.type).toBe("discard");
    if (action.type === "discard") {
      expect(new Set(action.cards).size).toBe(2);
      expect(action.cards.every((card) => g.hands[0].includes(card))).toBe(
        true,
      );
    }
    expect(g).toEqual(original);
  });
});
