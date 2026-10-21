import {
  type Game,
  type Action,
  type Card,
  type Seat,
  type Contract,
  CONTRACTS,
  MISERE,
  auctionBids,
  contractBids,
  legalCards,
  whistChoices,
  suit,
  rank,
  shuffle,
  sort,
  next,
  winner,
  trump,
  requiredSuit,
} from "./engine";
const strength = (hand: Card[], tr: number) => {
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
    } else if (tr === 4) value += Math.max(0, len - 4) * 0.48;
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
  for (const b of legal) {
    const c = CONTRACTS[b];
    if (!c.misere && strength(hand, c.suit) + 0.95 + adjustment >= c.level)
      return { type: "bid", bid: b };
  }
  return { type: "pass" };
}
function chooseContract(g: Game): number {
  if (g.highest === MISERE) return MISERE;
  let best = contractBids(g)[0],
    score = -Infinity;
  for (const b of contractBids(g)) {
    const c = CONTRACTS[b],
      estimate = strength(g.hands[g.turn], c.suit),
      v = estimate - c.level + Math.min(0.35, (c.level - 6) * 0.1);
    if (v > score) {
      best = b;
      score = v;
    }
  }
  return best;
}
// This is the only boundary between the real deal and the search. Hidden hands and
// the hidden discard are never passed to the search; only their sizes are used.
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
      const world = structuredClone(g);
      world.hands = hands;
      if (g.declarer === null && g.history.length === 0)
        world.kitty = [g.kitty[0], pool[0]];
      world.discarded =
        observer === g.declarer
          ? g.discarded.slice()
          : pool.filter((c) => !(!g.contract && g.kitty.includes(c)));
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
function greedy(g: Game): Card {
  const moves = legalCards(g),
    p = g.turn,
    d = g.declarer,
    tr = trump(g);
  if (moves.length === 1) return moves[0];
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
  if (teamAhead) return sorted[0];
  if (wantsTake || !g.contract?.misere)
    return winning[0] ?? sorted[sorted.length - 1];
  return sorted[0];
}
function utility(g: Game, observer: Seat) {
  if (g.declarer === null) return -g.taken[observer];
  const n = g.taken[g.declarer],
    c = g.contract!,
    success = c.misere ? n === 0 : n >= c.level;
  const declarerValue = c.misere
    ? -n - (success ? 0 : 4)
    : n + (success ? 4 : 0);
  return observer === g.declarer ? declarerValue : -declarerValue;
}
function rollout(g: Game, observer: Seat): number {
  while (g.hands.some((h) => h.length)) playFast(g, greedy(g));
  return utility(g, observer);
}
function solve(
  g: Game,
  observer: Seat,
  budget: { nodes: number },
  alpha = -Infinity,
  beta = Infinity,
): number {
  if (!g.hands.some((h) => h.length)) return utility(g, observer);
  if (--budget.nodes <= 0) return rollout(structuredClone(g), observer);
  const cooperative = g.declarer !== null,
    max = cooperative
      ? (g.turn === g.declarer) === (observer === g.declarer)
      : g.turn === observer;
  let best = max ? -Infinity : Infinity;
  const moves = legalCards(g);
  for (const c of moves) {
    const w = structuredClone(g);
    playFast(w, c);
    const value = solve(w, observer, budget, alpha, beta);
    best = max ? Math.max(best, value) : Math.min(best, value);
    if (max) alpha = Math.max(alpha, best);
    else beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}
export function choosePlay(g: Game, observer: Seat): Card {
  const legal = legalCards(g);
  if (legal.length === 1) return legal[0];
  if (g.settings.difficulty === "easy")
    return legal[Math.floor(Math.random() * legal.length)];
  const hard = g.settings.difficulty === "hard",
    scores = legal.map(() => 0),
    counts = legal.map(() => 0),
    deadline = Date.now() + (hard ? 650 : 140),
    maxSamples = hard ? 72 : 16;
  for (let n = 0; n < maxSamples && Date.now() < deadline; n++) {
    const world = sampleWorld(g, observer);
    if (!world) continue;
    for (let i = 0; i < legal.length; i++) {
      const w = structuredClone(world);
      playFast(w, legal[i]);
      const remain = w.hands.reduce((n, h) => n + h.length, 0);
      scores[i] +=
        hard && remain <= 12 && g.declarer !== null
          ? solve(w, observer, { nodes: 1200 })
          : rollout(w, observer);
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
    case "half": {
      const estimate = strength(g.hands[g.turn], g.contract!.suit),
        need = g.contract!.level === 6 ? 2 : g.contract!.level === 7 ? 1 : 0.65;
      const choices = whistChoices(g);
      return {
        type: "whist",
        choice:
          estimate >= need
            ? "whist"
            : choices.includes("half")
              ? "half"
              : "pass",
      };
    }
    case "opening":
      return { type: "open", open: true };
    case "play":
      return { type: "play", card: choosePlay(g, observer) };
    default:
      throw Error("Бот не должен ходить сейчас");
  }
}
