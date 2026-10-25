import {
  type Game,
  type Action,
  type Card,
  type Seat,
  CONTRACTS,
  MISERE,
  auctionBids,
  contractBids,
  legalCards,
  whistChoices,
  suit,
  rank,
  shuffle,
  next,
  winner,
  trump,
  requiredSuit,
  outcomeScores,
  totals,
} from "./engine";
export const strength = (hand: Card[], tr: number) => {
  let value = 0;
  for (let s = 0; s < 4; s++) {
    const cards = hand
        .filter((c) => suit(c) === s)
        .map(rank)
        .sort((a, b) => b - a),
      len = cards.length;
    for (let i = 0; i < len; i++) {
      const r = cards[i];
      value +=
        r === 7
          ? 0.98
          : r === 6
            ? len > 1
              ? 0.78
              : 0.28
            : r === 5
              ? len > 2
                ? 0.56
                : 0.12
              : r === 4
                ? len > 3
                  ? 0.34
                  : 0.04
                : 0;
    }
    if (s === tr) {
      value += Math.max(0, len - 3) * 0.74;
      for (let other = 0; other < 4; other++)
        if (other !== tr) {
          const n = hand.filter((c) => suit(c) === other).length;
          value +=
            n === 0
              ? Math.min(len, 2) * 0.5
              : n === 1
                ? Math.min(len, 2) * 0.2
                : 0;
        }
    } else value += Math.max(0, len - 3) * (tr === 4 ? 0.65 : 0.4);
  }
  return Math.min(10, value);
};
const misereRisk = (hand: Card[]) => {
  let risk = 0;
  for (let s = 0; s < 4; s++) {
    const rs = hand
      .filter((c) => suit(c) === s)
      .map(rank)
      .sort((a, b) => a - b);
    rs.forEach(
      (r, i) => (risk += Math.max(0, r - i - 1) * (i === 0 ? 1.4 : 0.45)),
    );
  }
  return risk;
};
export function chooseDiscard(g: Game): Card[] {
  const hand = g.hands[g.turn];
  let best = -Infinity,
    discard = hand.slice(0, 2);
  for (let i = 0; i < hand.length; i++)
    for (let j = i + 1; j < hand.length; j++) {
      const left = hand.filter((_, k) => k !== i && k !== j);
      let value: number;
      if (g.highest === MISERE) value = -misereRisk(left);
      else
        value = Math.max(
          ...contractBids(g).map(
            (b) =>
              strength(left, CONTRACTS[b].suit) -
              0.75 * (CONTRACTS[b].level - 6),
          ),
        );
      if (value > best) {
        best = value;
        discard = [hand[i], hand[j]];
      }
    }
  return discard;
}
function chooseBid(g: Game): Action {
  const hand = g.hands[g.turn],
    legal = auctionBids(g),
    risk = misereRisk(hand),
    difficulty = g.settings.difficulty;
  const adjustment =
    difficulty === "easy"
      ? (Math.random() - 0.5) * 2
      : difficulty === "medium"
        ? -0.2
        : 0;
  if (
    g.bids[g.turn] === 0 &&
    legal.includes(MISERE) &&
    risk < (difficulty === "hard" ? 2 : 1)
  )
    return { type: "bid", bid: MISERE };
  const plausible = legal.filter(
    (b) =>
      !CONTRACTS[b].misere &&
      strength(hand, CONTRACTS[b].suit) + 1.25 >= CONTRACTS[b].level,
  );
  if (difficulty === "hard" && !plausible.length) return { type: "pass" };
  const outcomes =
    difficulty === "hard"
      ? contractOutcomes(g, true, [
          ...new Set(plausible.map((b) => CONTRACTS[b].suit)),
        ])
      : null;
  for (const b of legal) {
    const c = CONTRACTS[b];
    if (
      !c.misere &&
      (outcomes
        ? strength(hand, c.suit) + 1.25 >= c.level &&
          outcomes[c.suit].filter((n) => n >= c.level).length /
            outcomes[c.suit].length >=
            0.7
        : strength(hand, c.suit) + 0.95 + adjustment >= c.level)
    )
      return { type: "bid", bid: b };
  }
  return { type: "pass" };
}
function chooseContract(g: Game): number {
  if (g.highest === MISERE) return MISERE;
  let best = contractBids(g)[0],
    score = -Infinity;
  const outcomes =
    g.settings.difficulty === "hard" ? contractOutcomes(g, false) : null;
  for (const b of contractBids(g)) {
    const c = CONTRACTS[b],
      estimate = strength(g.hands[g.turn], c.suit),
      v =
        outcomes && estimate >= c.level - 0.2
          ? outcomes[c.suit].reduce(
              (sum, n) =>
                sum +
                (n >= c.level
                  ? (c.level - 5) * 2
                  : -(c.level - n) * (c.level - 5) * 2),
              0,
            ) /
              outcomes[c.suit].length +
            10
          : estimate - c.level + Math.min(0.35, (c.level - 6) * 0.1);
    if (v > score) {
      best = b;
      score = v;
    }
  }
  return best;
}
function chooseWhist(g: Game): Action {
  const choices = whistChoices(g),
    p = g.turn,
    d = g.declarer!;
  const estimate = strength(g.hands[p], g.contract!.suit),
    need = g.contract!.level === 6 ? 2 : g.contract!.level === 7 ? 1 : 0.65;
  if (g.settings.difficulty !== "hard")
    return {
      type: "whist",
      choice:
        estimate >= need ? "whist" : choices.includes("half") ? "half" : "pass",
    };
  const scores = choices.map(() => 0);
  for (let sample = 0; sample < 48; sample++) {
    const world = sampleWorld(g, p);
    if (!world) continue;
    const startingHands = world.hands.map((h) => h.slice());
    world.turn = world.first;
    world.taken = [0, 0, 0];
    rollout(world, p);
    for (let i = 0; i < choices.length; i++) {
      const w = { ...world, whists: g.whists.slice() },
        choice = choices[i];
      w.whists[p] = choice;
      const other = ([0, 1, 2] as Seat[]).find((s) => s !== p && s !== d)!;
      if (g.phase === "half" && choice === "whist") w.whists[other] = "pass";
      // Predict the remaining response from its sampled starting hand.
      if (w.whists[other] === "wait") {
        w.whists[other] =
          strength(startingHands[other], g.contract!.suit) >= need
            ? "whist"
            : choice === "pass" && g.contract!.level <= 7
              ? "half"
              : "pass";
      }
      const uncontested = !w.whists.includes("whist"),
        half = w.whists.includes("half");
      const result = outcomeScores(
        w,
        world.taken,
        uncontested,
        uncontested && half,
      );
      scores[i] += totals(result.map((s) => ({ ...s, hill: s.hill - s.pool })))[
        p
      ];
    }
  }
  let best = 0;
  for (let i = 1; i < choices.length; i++)
    if (scores[i] > scores[best]) best = i;
  return { type: "whist", choice: choices[best] };
}
// Auction samples include an unknown kitty and an optimized two-card discard.
// Only the bidder's hand is read; real opponents and the real kitty stay hidden.
function contractOutcomes(
  g: Game,
  auction: boolean,
  suits = [0, 1, 2, 3, 4],
): number[][] {
  const p = g.turn,
    own = g.hands[p],
    outcomes: number[][] = [[], [], [], [], []];
  const unseen = Array.from({ length: 32 }, (_, c) => c).filter(
    (c) => !own.includes(c),
  );
  for (let n = 0; n < 48; n++) {
    const pool = auction ? shuffle(unseen) : null;
    const world = auction ? searchCopy(g) : sampleWorld(g, p);
    if (!world) continue;
    if (pool) {
      world.kitty = pool.slice(0, 2);
      let offset = 2;
      for (const s of [0, 1, 2])
        if (s !== p) {
          world.hands[s] = pool.slice(offset, offset + 10);
          offset += 10;
        }
    }
    for (const tr of suits) {
      const w = searchCopy(world);
      let hand = pool ? [...own, ...w.kitty] : own.slice();
      if (auction) {
        let best = -Infinity,
          kept = hand.slice(0, 10);
        for (let i = 0; i < hand.length; i++)
          for (let j = i + 1; j < hand.length; j++) {
            const left = hand.filter((_, k) => k !== i && k !== j);
            const value = strength(left, tr);
            if (value > best) {
              best = value;
              kept = left;
            }
          }
        hand = kept;
      }
      w.hands[p] = hand;
      w.declarer = p;
      w.contract = { level: 6, suit: tr };
      w.turn = g.first;
      w.table = [];
      w.history = [];
      w.taken = [0, 0, 0];
      rollout(w, p);
      outcomes[tr].push(w.taken[p]);
    }
  }
  return outcomes;
}
// Play-search boundary: hidden hands and the hidden discard are replaced with
// samples; only their sizes and public information constrain the distribution.
export function sampleWorld(
  g: Game,
  observer: Seat,
  rng = Math.random,
): Game | null {
  const visible = new Set<number>([observer]);
  if (g.open && g.declarer !== null)
    for (let i = 0; i < 3; i++) if (i !== g.declarer) visible.add(i);
  const known = new Set<number>(
    g.history
      .flatMap((t) => t.map((p) => p.card))
      .concat(g.table.map((p) => p.card)),
  );
  for (const s of visible) for (const c of g.hands[s]) known.add(c);
  // The successful bidder's kitty is public, but its eventual discard is private.
  const publicKitty = g.declarer !== null ? g.kitty : [];
  if (observer === g.declarer) for (const c of g.discarded) known.add(c);
  if (g.declarer === null)
    for (const c of g.kitty.slice(0, Math.min(2, g.history.length + 1)))
      known.add(c);
  const unseen = Array.from({ length: 32 }, (_, i) => i).filter(
    (c) => !known.has(c),
  );
  const seats = ([0, 1, 2] as Seat[]).filter((s) => !visible.has(s));
  for (let attempt = 0; attempt < 150; attempt++) {
    const pool = shuffle(unseen, rng),
      hands = g.hands.map((h, s) =>
        visible.has(s) ? h.slice() : ([] as Card[]),
      );
    let valid = true;
    // Constrained hands first makes void-heavy late positions much easier to sample.
    const order = seats
      .slice()
      .sort((a, b) => g.voids[b].length - g.voids[a].length);
    for (const s of order) {
      const allowed = pool.filter(
        (c) =>
          !g.voids[s].includes(suit(c)) &&
          (!publicKitty.includes(c) || s === g.declarer),
      );
      if (allowed.length < g.hands[s].length) {
        valid = false;
        break;
      }
      hands[s] = allowed.slice(0, g.hands[s].length);
      for (const c of hands[s]) pool.splice(pool.indexOf(c), 1);
    }
    if (valid) {
      const world = searchCopy(g);
      world.hands = hands;
      if (g.declarer === null && g.history.length === 0)
        world.kitty = [g.kitty[0], pool[0]];
      world.discarded =
        observer === g.declarer
          ? g.discarded.slice()
          : pool.filter((c) => !(!g.contract && g.kitty.includes(c)));
      if (
        g.settings.difficulty === "hard" &&
        g.declarer !== null &&
        observer !== g.declarer &&
        g.highest >= 0 &&
        attempt < 140
      ) {
        const played = [...g.history.flat(), ...g.table]
          .filter((p) => p.seat === g.declarer)
          .map((p) => p.card);
        const original = [
          ...hands[g.declarer],
          ...played,
          ...world.discarded,
        ].filter((c) => !g.kitty.includes(c));
        // A winning bid is evidence, not certainty. Keep a nonzero probability
        // for unusual hands rather than ruling out adventurous human bidders.
        const plausibility = g.contract?.misere
          ? Math.exp(-0.2 * Math.max(0, misereRisk(original) - 2))
          : Math.exp(
              0.65 *
                Math.min(
                  0,
                  strength(original, g.contract!.suit) +
                    1.25 -
                    CONTRACTS[g.highest].level,
                ),
            );
        if (rng() > Math.max(0.15, plausibility)) continue;
      }
      return world;
    }
  }
  return null;
}
function playFast(g: Game, c: Card): void {
  const p = g.turn;
  g.hands[p] = g.hands[p].filter((x) => x !== c);
  g.table.push({ seat: p, card: c });
  if (g.table.length === 3) {
    const w = winner(g.table, trump(g), requiredSuit(g) ?? undefined);
    g.taken[w]++;
    g.history.push(g.table);
    g.table = [];
    g.turn = !g.contract && g.history.length < 3 ? g.first : w;
  } else g.turn = next(p);
}
// Search only mutates these fields. Avoid copying scores, records and settings
// at every node, while keeping the real game and sibling branches untouched.
function searchCopy(g: Game): Game {
  return {
    ...g,
    hands: g.hands.map((h) => h.slice()),
    table: g.table.slice(),
    history: g.history.slice(),
    taken: g.taken.slice(),
  };
}
function raspasyMove(g: Game, moves: Card[]): Card {
  const p = g.turn;
  const danger = (c: Card) => {
    const lowerOutside = g.hands
      .flatMap((h, s) => (s === p ? [] : h))
      .filter((x) => suit(x) === suit(c) && rank(x) < rank(c)).length;
    const length = g.hands[p].filter((x) => suit(x) === suit(c)).length;
    // High cards over many outstanding low cards are liabilities. Shorten
    // dangerous suits so that later leads provide opportunities to discard.
    return lowerOutside * 3 + rank(c) + 2 / length;
  };
  if (g.table.length) {
    const losing = moves.filter(
      (c) =>
        winner(
          [...g.table, { seat: p, card: c }],
          4,
          requiredSuit(g) ?? undefined,
        ) !== p,
    );
    // Duck with the largest safe card; a void is a chance to shed a liability.
    if (losing.length) return losing.sort((a, b) => danger(b) - danger(a))[0];
    // Last to play and forced to win: cash the highest card for the same trick.
    if (g.table.length === 2)
      return moves.slice().sort((a, b) => danger(b) - danger(a))[0];
    // In second position give the remaining player a chance to overtake.
    return moves.slice().sort((a, b) => rank(a) - rank(b))[0];
  }
  const leadCost = (c: Card) => {
    const opponents = g.hands.filter((_, s) => s !== p);
    const followers = opponents.map((h) =>
      h.filter((x) => suit(x) === suit(c)),
    );
    const canDuck = followers.some((h) => h.some((x) => rank(x) < rank(c)));
    const canOvertake = followers.some((h) => h.some((x) => rank(x) > rank(c)));
    const length = g.hands[p].filter((x) => suit(x) === suit(c)).length;
    // Avoid walking back into a suit both opponents have exhausted. Low cards
    // under their remaining cards are exits; preserve them when discarding.
    return (
      (!canOvertake ? 40 : 0) + (canDuck ? 12 : 0) + rank(c) + length * 0.4
    );
  };
  return moves.slice().sort((a, b) => leadCost(a) - leadCost(b))[0];
}
function greedy(g: Game): Card {
  const moves = legalCards(g),
    p = g.turn,
    d = g.declarer,
    tr = trump(g);
  if (moves.length === 1) return moves[0];
  if (d === null) return raspasyMove(g, moves);
  if (g.contract?.misere) return misereMove(g, moves);
  const cheap = (c: Card) => rank(c) + (suit(c) === tr ? 9 : 0);
  const sorted = moves.slice().sort((a, b) => cheap(a) - cheap(b));
  const avoid = d === null || (g.contract?.misere && p === d);
  const wantsTake = d !== null && (g.contract?.misere ? p !== d : p === d);
  if (!g.table.length) {
    if (avoid) return sorted[0];
    if (g.contract?.misere) {
      return sorted[0];
    }
    // Cash established winners, draw trumps with length, then establish long suits.
    const remaining = g.hands.flatMap((h, s) => (s === p ? [] : h));
    if (p !== d) {
      const partner = ([0, 1, 2] as Seat[]).find((s) => s !== p && s !== d)!;
      const leadValue = (c: Card) => {
        const s = suit(c),
          theirs = g.hands[d].filter((x) => suit(x) === s),
          ours = g.hands[partner].filter((x) => suit(x) === s);
        const master = !theirs.some((x) => rank(x) > rank(c));
        const canRuff =
          !theirs.length && g.hands[d].some((x) => suit(x) === tr);
        return (
          (master && !canRuff ? 15 : 0) +
          (ours.some((x) => theirs.every((y) => rank(x) > rank(y))) && !canRuff
            ? 8
            : 0) +
          (s === tr ? -8 : 0) +
          ours.length -
          rank(c) * 0.15
        );
      };
      return moves.slice().sort((a, b) => leadValue(b) - leadValue(a))[0];
    }
    const masters = moves.filter(
      (c) => !remaining.some((x) => suit(x) === suit(c) && rank(x) > rank(c)),
    );
    const trumps = masters.filter((c) => suit(c) === tr);
    if (trumps.length && remaining.some((c) => suit(c) === tr))
      return trumps[0];
    if (masters.length) return masters.sort((a, b) => cheap(a) - cheap(b))[0];
    return moves.slice().sort((a, b) => {
      const len = (c: Card) =>
        g.hands[p].filter((x) => suit(x) === suit(c)).length;
      return len(b) - len(a) || rank(b) - rank(a);
    })[0];
  }
  const current = winner(g.table, tr, requiredSuit(g) ?? undefined),
    teamAhead =
      d !== null &&
      (g.contract?.misere
        ? current === d
        : (current !== d && p !== d) || (current === d && p === d));
  const winning = sorted.filter(
    (c) =>
      winner(
        [...g.table, { seat: p, card: c }],
        tr,
        requiredSuit(g) ?? undefined,
      ) === p,
  );
  if (avoid) {
    const losing = sorted.filter((c) => !winning.includes(c));
    return losing.length ? losing[losing.length - 1] : sorted[0];
  }
  if (teamAhead) {
    // In second hand a partner's winning card may still be covered by the
    // declarer in third hand. Overtake only when that actually saves the trick.
    if (g.table.length === 1 && next(p) === d) {
      const replies = legalCards({
        ...g,
        turn: d,
        table: [...g.table, { seat: p, card: sorted[0] }],
      });
      const holds = (c: Card) =>
        replies.every(
          (card) =>
            winner(
              [...g.table, { seat: p, card: c }, { seat: d, card }],
              tr,
            ) !== d,
        );
      if (!holds(sorted[0])) return sorted.find(holds) ?? sorted[0];
    }
    return sorted[0];
  }
  if (wantsTake || !g.contract?.misere)
    return winning[0] ?? sorted[sorted.length - 1];
  return sorted[0];
}
function misereMove(g: Game, moves: Card[]): Card {
  const d = g.declarer!,
    p = g.turn;
  if (p === d) return raspasyMove(g, moves);
  // Attack suits in which declarer cannot duck a low lead. Never volunteer
  // a safe discard by leading a suit declarer has already exhausted.
  if (!g.table.length) {
    const pressure = (c: Card) => {
      const theirs = g.hands[d].filter((x) => suit(x) === suit(c));
      if (!theirs.length) return -100;
      const low = Math.min(...theirs.map(rank));
      return (
        (rank(c) < low ? 30 : 0) + low * 2 + theirs.length - rank(c) * 0.25
      );
    };
    return moves.slice().sort((a, b) => pressure(b) - pressure(a))[0];
  }
  const forcedCatch = (c: Card) => {
    const table = [...g.table, { seat: p, card: c }];
    if (table.length === 3) return winner(table, 4) === d ? 1 : 0;
    const q = next(p),
      replies = legalCards({ ...g, table, turn: q });
    const outcomes = replies.map((card) =>
      winner([...table, { seat: q, card }], 4) === d ? 1 : 0,
    );
    return q === d ? Math.min(...outcomes) : Math.max(...outcomes);
  };
  return moves
    .slice()
    .sort((a, b) => forcedCatch(b) - forcedCatch(a) || rank(a) - rank(b))[0];
}
type OutcomeTable = number[][];
function outcomeTable(g: Game): OutcomeTable {
  const table: OutcomeTable = [];
  const values = (scores: Game["scores"]) =>
    totals(scores.map((s) => ({ ...s, hill: s.hill - s.pool })));
  const base = values(g.scores);
  const scale =
    g.declarer === null
      ? 70
      : g.contract?.misere
        ? 700
        : 40 * (g.contract!.level - 5);
  for (let a = 0; a <= 10; a++)
    for (let b = 0; b <= 10 - a; b++)
      table[a * 11 + b] = values(outcomeScores(g, [a, b, 10 - a - b])).map(
        (v, seat) => (v - base[seat]) / scale,
      );
  return table;
}
function utility(g: Game, observer: Seat, values?: OutcomeTable) {
  if (values) return values[g.taken[0] * 11 + g.taken[1]][observer];
  if (g.declarer === null) return -g.taken[observer];
  const n = g.taken[g.declarer],
    c = g.contract!,
    success = c.misere ? n === 0 : n >= c.level;
  const declarerValue = c.misere
    ? -n - (success ? 0 : 4)
    : n + (success ? 4 : 0);
  return observer === g.declarer ? declarerValue : -declarerValue;
}
function rollout(
  g: Game,
  observer: Seat,
  endgame = false,
  values?: OutcomeTable,
): number {
  while (g.hands.some((h) => h.length)) {
    if (endgame && g.declarer === null && g.hands.flat().length <= 9) {
      const taken = solveRaspasy(g, { nodes: 1800 }, values);
      return values
        ? values[taken[0] * 11 + taken[1]][observer]
        : -taken[observer];
    }
    if (endgame && g.declarer !== null && g.hands.flat().length <= 9)
      return solve(g, observer, { nodes: 2500 }, -Infinity, Infinity, values);
    playFast(g, greedy(g));
  }
  return utility(g, observer, values);
}
// Max-n, rather than a coalition against the observer: every player chooses
// the continuation with the fewest tricks for their own seat. Values are the
// complete three-player outcome, including tricks already collected.
export function solveRaspasy(
  g: Game,
  budget: { nodes: number },
  values?: OutcomeTable,
): number[] {
  if (!g.hands.some((h) => h.length)) return g.taken.slice();
  if (--budget.nodes <= 0) {
    const w = searchCopy(g);
    rollout(w, g.turn);
    return w.taken;
  }
  const p = g.turn,
    preferred = greedy(g),
    moves = searchMoves(g);
  moves.sort((a, b) => Number(b === preferred) - Number(a === preferred));
  let best: number[] | undefined;
  for (const c of moves) {
    const w = searchCopy(g);
    playFast(w, c);
    const value = solveRaspasy(w, budget, values);
    const worth = (taken: number[]) =>
      values ? values[taken[0] * 11 + taken[1]][p] : -taken[p];
    if (!best || worth(value) > worth(best)) best = value;
    // No continuation can improve on taking no additional tricks.
    if (!values && best[p] === g.taken[p]) break;
  }
  return best!;
}
function searchMoves(g: Game): Card[] {
  const moves = legalCards(g).sort((a, b) => a - b);
  const outside = [
    ...g.hands.flatMap((h, seat) => (seat === g.turn ? [] : h)),
    ...g.table.map((p) => p.card),
  ];
  // In a fixed sampled world, adjacent cards with no opposing rank between
  // them are equivalent. This saves branches without pruning root decisions.
  return moves.filter(
    (c, i) =>
      i === 0 ||
      suit(c) !== suit(moves[i - 1]) ||
      outside.some(
        (x) =>
          suit(x) === suit(c) &&
          rank(x) > rank(moves[i - 1]) &&
          rank(x) < rank(c),
      ),
  );
}
function solve(
  g: Game,
  observer: Seat,
  budget: { nodes: number },
  alpha = -Infinity,
  beta = Infinity,
  values?: OutcomeTable,
): number {
  if (!g.hands.some((h) => h.length)) return utility(g, observer, values);
  if (--budget.nodes <= 0)
    return rollout(searchCopy(g), observer, false, values);
  const cooperative = g.declarer !== null,
    max = cooperative
      ? (g.turn === g.declarer) === (observer === g.declarer)
      : g.turn === observer;
  let best = max ? -Infinity : Infinity;
  const moves = searchMoves(g),
    preferred = greedy(g);
  moves.sort((a, b) => Number(b === preferred) - Number(a === preferred));
  for (const c of moves) {
    const w = searchCopy(g);
    playFast(w, c);
    const value = solve(w, observer, budget, alpha, beta, values);
    best = max ? Math.max(best, value) : Math.min(best, value);
    if (max) alpha = Math.max(alpha, best);
    else beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}
type SearchNode = {
  visits: number;
  available: number;
  rewards: number[];
  children: Map<Card, SearchNode>;
};
const newNode = (): SearchNode => ({
  visits: 0,
  available: 0,
  rewards: [0, 0, 0],
  children: new Map(),
});
// Single-observer information-set MCTS (Cowling, Powley & Whitehouse, 2012).
// All sampled worlds share a tree of public card plays. An edge is available
// only in worlds where the player can legally play that card.
function informationSearch(g: Game, observer: Seat, rng: () => number): Card {
  const root = newNode(),
    values = outcomeTable(g),
    deadline = Date.now() + 900;
  for (
    let iteration = 0;
    iteration < 1800 && Date.now() < deadline;
    iteration++
  ) {
    const world = sampleWorld(g, observer, rng);
    if (!world) continue;
    let node = root;
    const path = [root];
    while (world.hands.some((h) => h.length)) {
      const moves = legalCards(world),
        p = world.turn,
        decisionSeat =
          world.open && world.declarer !== null && p !== world.declarer
            ? (world.controller ?? p)
            : p;
      for (const c of moves) {
        if (!node.children.has(c)) node.children.set(c, newNode());
        node.children.get(c)!.available++;
      }
      const unvisited = moves.filter((c) => node.children.get(c)!.visits === 0);
      let card: Card;
      if (unvisited.length)
        card = unvisited[Math.floor(rng() * unvisited.length)];
      else {
        const ucb = (c: Card) => {
          const child = node.children.get(c)!;
          return (
            child.rewards[decisionSeat] / child.visits +
            0.7 * Math.sqrt(Math.log(child.available) / child.visits)
          );
        };
        card = moves.reduce((best, c) => (ucb(c) > ucb(best) ? c : best));
      }
      playFast(world, card);
      node = node.children.get(card)!;
      path.push(node);
      if (unvisited.length) break;
    }
    // A sampled world is used only inside this simulation, never as the live deal.
    while (world.hands.some((h) => h.length)) playFast(world, greedy(world));
    const rewards = values[world.taken[0] * 11 + world.taken[1]];
    for (const visited of path) {
      visited.visits++;
      for (let seat = 0; seat < 3; seat++)
        visited.rewards[seat] += rewards[seat];
    }
  }
  const legal = legalCards(g);
  return legal.reduce((best, c) =>
    (root.children.get(c)?.visits ?? 0) > (root.children.get(best)?.visits ?? 0)
      ? c
      : best,
  );
}
export function choosePlay(g: Game, observer: Seat, rng = Math.random): Card {
  const legal = legalCards(g);
  if (legal.length === 1) return legal[0];
  if (g.settings.difficulty === "easy")
    return legal[Math.floor(rng() * legal.length)];
  if (g.settings.difficulty === "hard" && g.hands.flat().length > 15)
    return informationSearch(g, observer, rng);
  const hard = g.settings.difficulty === "hard",
    scores = legal.map(() => 0),
    counts = legal.map(() => 0),
    deadline = Date.now() + (hard ? 900 : 140),
    maxSamples = hard ? 128 : 16,
    values = hard ? outcomeTable(g) : undefined;
  for (let n = 0; n < maxSamples && Date.now() < deadline; n++) {
    const world = sampleWorld(g, observer, rng);
    if (!world) continue;
    for (let i = 0; i < legal.length; i++) {
      const w = searchCopy(world);
      playFast(w, legal[i]);
      const remain = w.hands.reduce((n, h) => n + h.length, 0);
      scores[i] +=
        hard && remain <= 15
          ? g.declarer === null
            ? (() => {
                const taken = solveRaspasy(w, { nodes: 6000 }, values);
                return values![taken[0] * 11 + taken[1]][observer];
              })()
            : solve(w, observer, { nodes: 6000 }, -Infinity, Infinity, values)
          : rollout(w, observer, hard, values);
      counts[i]++;
    }
  }
  let best = 0;
  for (let i = 1; i < legal.length; i++)
    if (
      scores[i] / (counts[i] || 1) >
      scores[best] / (counts[best] || 1) + 0.0001
    )
      best = i;
  return legal[best];
}
export function botAction(g: Game, observer = g.turn): Action {
  switch (g.phase) {
    case "auction":
      return chooseBid(g);
    case "discard":
      return { type: "discard", cards: chooseDiscard(g) };
    case "contract":
      return { type: "contract", bid: chooseContract(g) };
    case "whist":
    case "half":
      return chooseWhist(g);
    case "opening":
      return { type: "open", open: true };
    case "play":
      return { type: "play", card: choosePlay(g, observer) };
    default:
      throw Error("Бот не должен ходить сейчас");
  }
}
