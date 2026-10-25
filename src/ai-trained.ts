import { botAction as searchAction, chooseDiscard, strength } from "./ai";
import {
  type Game,
  type Action,
  type Card,
  CONTRACTS,
  MISERE,
  contractBids,
} from "./engine";
import { trickDistribution } from "./hand-value";

function estimate(
  hand: Card[],
  tr: number,
  g: Game,
  discarded = g.discarded,
): number[] {
  return trickDistribution(hand, tr, (g.first - g.turn + 3) % 3, discarded);
}
function contractValue(distribution: number[], level: number): number {
  const price = (level - 5) * 2;
  // Conservative declarer value: both opponents whist; no assumed bonus from
  // a defender's own responsibility penalty. Units are normalized whists.
  return distribution.reduce((sum, probability, tricks) => {
    const short = Math.max(0, level - tricks);
    return (
      sum +
      probability *
        price *
        ((short ? (-short * 20) / 3 : 20 / 3) - 2 * short - (10 - tricks))
    );
  }, 0);
}
function bestContract(
  g: Game,
  hand: Card[],
  discarded = g.discarded,
): { bid: number; value: number } {
  const bySuit = new Map<number, number[]>();
  let best = { bid: contractBids(g)[0], value: -Infinity };
  for (const bid of contractBids(g)) {
    const c = CONTRACTS[bid];
    if (!bySuit.has(c.suit))
      bySuit.set(c.suit, estimate(hand, c.suit, g, discarded));
    const value = contractValue(bySuit.get(c.suit)!, c.level);
    if (value > best.value) best = { bid, value };
  }
  return best;
}
export function botAction(g: Game, observer = g.turn): Action {
  if (g.settings.difficulty !== "hard" || g.highest === MISERE)
    return searchAction(g, observer);
  if (g.phase === "contract") {
    // Preserve the exact high-card treatment of very strong, rare hands until
    // the pilot dataset covers enough of the ten-trick tail.
    if (
      Math.max(...[0, 1, 2, 3, 4].map((tr) => strength(g.hands[g.turn], tr))) >=
      8.5
    )
      return searchAction(g, observer);
    return { type: "contract", bid: bestContract(g, g.hands[g.turn]).bid };
  }
  if (g.phase === "discard") {
    const hand = g.hands[g.turn];
    if (Math.max(...[0, 1, 2, 3, 4].map((tr) => strength(hand, tr))) >= 9.5)
      return { type: "discard", cards: chooseDiscard(g) };
    const baseline = chooseDiscard(g);
    const candidates: { left: Card[]; discarded: Card[]; structure: number }[] =
      [];
    for (let i = 0; i < hand.length; i++)
      for (let j = i + 1; j < hand.length; j++) {
        const left = hand.filter((_, k) => k !== i && k !== j);
        const structure = Math.max(
          ...contractBids(g).map(
            (b) =>
              strength(left, CONTRACTS[b].suit) -
              0.75 * (CONTRACTS[b].level - 6),
          ),
        );
        candidates.push({ left, discarded: [hand[i], hand[j]], structure });
      }
    candidates.sort((a, b) => b.structure - a.structure);
    let best = bestContract(
        g,
        hand.filter((c) => !baseline.includes(c)),
        baseline,
      ).value,
      discard = baseline;
    const minimum = best + 3;
    for (const candidate of candidates.slice(0, 8)) {
      const value = bestContract(g, candidate.left, candidate.discarded).value;
      if (value > best && value >= minimum) {
        best = value;
        discard = candidate.discarded;
      }
    }
    return { type: "discard", cards: discard };
  }
  return searchAction(g, observer);
}
export function botActionDiscard(g: Game, observer = g.turn): Action {
  return g.phase === "discard"
    ? botAction(g, observer)
    : searchAction(g, observer);
}
