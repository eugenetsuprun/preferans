export type Seat = 0 | 1 | 2;
export type Card = number;
export type Difficulty = "easy" | "medium" | "hard";
export type Phase =
  | "auction"
  | "discard"
  | "contract"
  | "whist"
  | "half"
  | "opening"
  | "play"
  | "trick"
  | "result";
export type Contract = { level: number; suit: number; misere?: boolean };
export type Play = { seat: Seat; card: Card };
export type Score = { pool: number; hill: number; whists: number[] };
export type Settings = {
  difficulty: Difficulty;
  target: number;
  speed: number;
};
export type RecordRow = {
  number: number;
  label: string;
  declarer: Seat | null;
  taken: number[];
  scores: Score[];
  note: string;
};
export type Game = {
  version: 1;
  settings: Settings;
  number: number;
  dealer: Seat;
  first: Seat;
  turn: Seat;
  phase: Phase;
  hands: Card[][];
  kitty: Card[];
  discarded: Card[];
  highest: number;
  bidder: Seat | null;
  passed: boolean[];
  bids: number[];
  calls: string[];
  contract: Contract | null;
  declarer: Seat | null;
  whists: ("wait" | "pass" | "whist" | "half")[];
  open: boolean;
  controller: Seat | null;
  table: Play[];
  history: Play[][];
  taken: number[];
  voids: number[][];
  scores: Score[];
  records: RecordRow[];
  note: string;
  finished: boolean;
  lastWinner: Seat | null;
};
export type Action =
  | { type: "bid"; bid: number }
  | { type: "pass" }
  | { type: "discard"; cards: Card[] }
  | { type: "contract"; bid: number }
  | { type: "whist"; choice: "pass" | "whist" | "half" }
  | { type: "open"; open: boolean }
  | { type: "play"; card: Card }
  | { type: "collect" }
  | { type: "next" };
export const SUITS = ["♠", "♣", "♦", "♥", "БК"];
export const RANKS = ["7", "8", "9", "10", "В", "Д", "К", "Т"];
export const NAMES = ["Вы", "Алексей", "Михаил"];
export const CONTRACTS: Contract[] = [];
for (let level = 6; level <= 10; level++) {
  if (level === 9) CONTRACTS.push({ level: 0, suit: 4, misere: true });
  for (let suit = 0; suit < 5; suit++) CONTRACTS.push({ level, suit });
}
export const MISERE = 15;
export const suit = (c: Card) => Math.floor(c / 8);
export const rank = (c: Card) => c % 8;
export const next = (s: number) => ((s + 1) % 3) as Seat;
export const label = (c: Contract | null) =>
  !c ? "Распасы" : c.misere ? "Мизер" : `${c.level} ${SUITS[c.suit]}`;
export const cardLabel = (c: Card) => RANKS[rank(c)] + SUITS[suit(c)];
export const sort = (cards: Card[]) => cards.slice().sort((a, b) => a - b);
export function shuffle<T>(a: T[], rng = Math.random): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
export const emptyScores = (): Score[] =>
  Array.from({ length: 3 }, () => ({ pool: 0, hill: 0, whists: [0, 0, 0] }));
export function deal(
  settings: Settings = { difficulty: "hard", target: 30, speed: 650 },
  previous?: Game,
  rng = Math.random,
): Game {
  const deck = shuffle(
      Array.from({ length: 32 }, (_, i) => i),
      rng,
    ),
    dealer = previous ? next(previous.dealer) : 2,
    first = next(dealer);
  return {
    version: 1,
    settings,
    number: (previous?.number ?? 0) + 1,
    dealer,
    first,
    turn: first,
    phase: "auction",
    hands: [
      sort(deck.slice(0, 10)),
      sort(deck.slice(10, 20)),
      sort(deck.slice(20, 30)),
    ],
    kitty: deck.slice(30),
    discarded: [],
    highest: -1,
    bidder: null,
    passed: [false, false, false],
    bids: [0, 0, 0],
    calls: ["", "", ""],
    contract: null,
    declarer: null,
    whists: ["wait", "wait", "wait"],
    open: false,
    controller: null,
    table: [],
    history: [],
    taken: [0, 0, 0],
    voids: [[], [], []],
    scores: previous ? structuredClone(previous.scores) : emptyScores(),
    records: previous?.records ?? [],
    note: "",
    finished: false,
    lastWinner: null,
  };
}
export function auctionBids(g: Game): number[] {
  const priority = (s: number) => (s - g.first + 3) % 3;
  return CONTRACTS.flatMap((c, i) => {
    if (c.misere && g.bids[g.turn] > 0) return [];
    if (g.highest >= MISERE && g.highest < 16 && i !== MISERE && i < 16)
      return [];
    return i > g.highest ||
      (i === g.highest &&
        g.bidder !== null &&
        priority(g.turn) < priority(g.bidder))
      ? [i]
      : [];
  });
}
export function contractBids(g: Game): number[] {
  if (g.highest === MISERE) return [MISERE];
  return CONTRACTS.flatMap((c, i) => (!c.misere && i >= g.highest ? [i] : []));
}
export function trump(g: Game) {
  return g.contract && !g.contract.misere ? g.contract.suit : 4;
}
export function requiredSuit(g: Game) {
  return !g.contract && g.history.length < 2
    ? suit(g.kitty[g.history.length])
    : g.table.length
      ? suit(g.table[0].card)
      : null;
}
export function legalCards(g: Game, seat = g.turn): Card[] {
  const hand = g.hands[seat],
    led = requiredSuit(g);
  if (led === null) return hand.slice();
  const follow = hand.filter((c) => suit(c) === led);
  if (follow.length) return follow;
  const trumps = hand.filter((c) => suit(c) === trump(g));
  return trumps.length ? trumps : hand.slice();
}
export function winner(
  table: Play[],
  tr: number,
  led = suit(table[0].card),
): Seat {
  const lead = table.some((p) => suit(p.card) === led)
    ? led
    : suit(table[0].card);
  const weight = (c: Card) =>
    (suit(c) === tr ? 200 : suit(c) === lead ? 100 : 0) + rank(c);
  let best = table[0];
  for (const p of table.slice(1)) {
    if (weight(p.card) > weight(best.card)) best = p;
  }
  return best.seat;
}
export function actor(g: Game): Seat {
  if (g.phase !== "play") return g.turn;
  if (
    g.open &&
    g.declarer !== null &&
    g.turn !== g.declarer &&
    g.controller !== null
  )
    return g.controller;
  return g.turn;
}
function beginPlay(g: Game) {
  g.phase = "play";
  g.turn = g.first;
  g.calls = g.calls.map((_, i) =>
    i === g.declarer
      ? label(g.contract)
      : g.whists[i] === "whist"
        ? "Вист"
        : "Пас",
  );
  if (g.contract?.misere) {
    g.open = false;
    g.controller = null;
  }
}
export function whistChoices(g: Game): ("pass" | "whist" | "half")[] {
  const options: ("pass" | "whist" | "half")[] = ["whist", "pass"];
  if (g.phase === "half") return ["whist", "pass"];
  if (
    g.contract &&
    g.contract.level <= 7 &&
    g.turn === next(next(g.declarer!)) &&
    g.whists[next(g.declarer!)] === "pass"
  )
    options.push("half");
  return options;
}
function addPool(g: Game, seat: Seat, amount: number, help = true) {
  const room = Math.max(0, g.settings.target - g.scores[seat].pool),
    own = Math.min(room, amount);
  g.scores[seat].pool += own;
  amount -= own;
  while (amount > 0 && help) {
    const recipients = ([0, 1, 2] as Seat[])
      .filter((i) => i !== seat && g.scores[i].pool < g.settings.target)
      .sort(
        (a, b) =>
          g.scores[b].pool - g.scores[a].pool ||
          ((a - seat + 3) % 3) - ((b - seat + 3) % 3),
      );
    if (!recipients.length) break;
    const p = recipients[0],
      n = Math.min(amount, g.settings.target - g.scores[p].pool);
    g.scores[p].pool += n;
    g.scores[seat].whists[p] += n * 10;
    amount -= n;
  }
  if (amount > 0) g.scores[seat].hill -= amount;
}
function finish(g: Game, uncontested = false, half = false) {
  const d = g.declarer,
    c = g.contract;
  if (d === null || !c) {
    for (const s of [0, 1, 2] as Seat[]) {
      if (!g.taken[s]) addPool(g, s, 1, false);
      else g.scores[s].hill += g.taken[s];
    }
    g.note = "Распасы: по 1 в гору за взятку; за ноль — 1 в пулю.";
  } else if (c.misere) {
    const n = g.taken[d];
    if (n) g.scores[d].hill += n * 10;
    else addPool(g, d, 10);
    g.note = n
      ? `Мизер: ${n} взяток, ${n * 10} в гору.`
      : "Мизер сыгран: 10 в пулю.";
  } else {
    const price = (c.level - 5) * 2,
      defenders = ([0, 1, 2] as Seat[]).filter((s) => s !== d),
      short = Math.max(0, c.level - g.taken[d]);
    if (uncontested) {
      g.taken[d] = c.level;
      addPool(g, d, price);
      if (half) {
        const s = defenders.find((s) => g.whists[s] === "half")!;
        g.scores[s].whists[d] += price * (c.level === 6 ? 2 : 1);
      }
      g.note = half
        ? "Полвиста. Контракт записан без розыгрыша."
        : "Два паса. Контракт записан без розыгрыша.";
    } else {
      if (short) g.scores[d].hill += short * price;
      else addPool(g, d, price);
      const w = defenders.filter((s) => g.whists[s] === "whist");
      if (c.level < 10) {
        for (const s of defenders) g.scores[s].whists[d] += short * price;
        if (w.length === 1) {
          g.scores[w[0]].whists[d] += (10 - g.taken[d]) * price;
          const min = c.level === 6 ? 4 : c.level === 7 ? 2 : 1;
          g.scores[w[0]].hill += Math.max(0, min - (10 - g.taken[d])) * price;
        } else if (w.length === 2) {
          for (const s of w) g.scores[s].whists[d] += g.taken[s] * price;
          if (c.level <= 7) {
            const min = c.level === 6 ? 2 : 1;
            for (const s of w)
              g.scores[s].hill += Math.max(0, min - g.taken[s]) * price;
          } else {
            const responsible = next(next(d));
            g.scores[responsible].hill +=
              Math.max(0, 1 - (10 - g.taken[d])) * price;
          }
        }
      }
      g.note = short
        ? `${label(c)}: без ${short}, ${short * price} в гору.`
        : `${label(c)} сыграно: ${price} в пулю.`;
    }
  }
  g.phase = "result";
  g.finished = g.scores.every((s) => s.pool >= g.settings.target);
  g.records = [
    ...g.records,
    {
      number: g.number,
      label: label(c),
      declarer: d,
      taken: [...g.taken],
      scores: structuredClone(g.scores),
      note: g.note,
    },
  ];
}
export function totals(scores: Score[]): number[] {
  return scores.map((s, i) => {
    let n = 0;
    for (let j = 0; j < 3; j++)
      if (j !== i)
        n +=
          ((scores[j].hill - s.hill) * 10) / 3 +
          s.whists[j] -
          scores[j].whists[i];
    return Math.round(n * 100) / 100;
  });
}
export function step(original: Game, a: Action): Game {
  if (a.type === "next") {
    if (original.phase !== "result" || original.finished)
      throw Error("Раздача ещё не закончена");
    return deal(original.settings, original);
  }
  const g = structuredClone(original),
    p = g.turn;
  if (g.phase === "auction" && (a.type === "bid" || a.type === "pass")) {
    if (a.type === "bid") {
      if (!auctionBids(g).includes(a.bid)) throw Error("Недопустимая заявка");
      g.highest = a.bid;
      g.bidder = p;
      g.bids[p]++;
      g.calls[p] = label(CONTRACTS[a.bid]);
    } else {
      g.passed[p] = true;
      g.calls[p] = "Пас";
    }
    const active = ([0, 1, 2] as Seat[]).filter((i) => !g.passed[i]);
    if (!active.length) {
      g.contract = null;
      g.declarer = null;
      beginPlay(g);
      return g;
    }
    if (active.length === 1 && g.bidder !== null) {
      g.declarer = g.bidder;
      g.turn = g.bidder;
      g.phase = "discard";
      g.hands[g.bidder] = sort([...g.hands[g.bidder], ...g.kitty]);
      g.contract = CONTRACTS[g.highest];
      return g;
    }
    let n = next(p);
    while (g.passed[n]) n = next(n);
    g.turn = n;
    return g;
  }
  if (g.phase === "discard" && a.type === "discard") {
    if (
      a.cards.length !== 2 ||
      new Set(a.cards).size !== 2 ||
      !a.cards.every((c) => g.hands[p].includes(c))
    )
      throw Error("Выберите две карты для сноса");
    g.discarded = a.cards;
    g.hands[p] = g.hands[p].filter((c) => !a.cards.includes(c));
    g.phase = "contract";
    return g;
  }
  if (g.phase === "contract" && a.type === "contract") {
    if (!contractBids(g).includes(a.bid)) throw Error("Контракт ниже заявки");
    g.contract = CONTRACTS[a.bid];
    if (g.contract.misere || g.contract.level === 10) {
      beginPlay(g);
      return g;
    }
    g.phase = "whist";
    g.turn = next(g.declarer!);
    return g;
  }
  if ((g.phase === "whist" || g.phase === "half") && a.type === "whist") {
    if (!whistChoices(g).includes(a.choice))
      throw Error("Недопустимая заявка на висте");
    if (g.phase === "half") {
      if (a.choice === "pass") {
        finish(g, true, true);
        return g;
      }
      g.whists[p] = "whist";
      g.whists[next(p)] = "pass";
      g.phase = "opening";
      g.turn = p;
      g.controller = p;
      return g;
    }
    g.whists[p] = a.choice;
    g.calls[p] =
      a.choice === "whist" ? "Вист" : a.choice === "half" ? "Полвиста" : "Пас";
    if (p === next(g.declarer!)) {
      g.turn = next(p);
      return g;
    }
    if (a.choice === "half") {
      g.phase = "half";
      g.turn = next(g.declarer!);
      return g;
    }
    const w = ([0, 1, 2] as Seat[]).filter((s) => g.whists[s] === "whist");
    if (!w.length) {
      finish(g, true);
      return g;
    }
    if (w.length === 1) {
      g.phase = "opening";
      g.turn = w[0];
      g.controller = w[0];
      return g;
    }
    beginPlay(g);
    return g;
  }
  if (g.phase === "opening" && a.type === "open") {
    g.open = a.open;
    if (!a.open) g.controller = null;
    beginPlay(g);
    return g;
  }
  if (g.phase === "play" && a.type === "play") {
    if (!legalCards(g).includes(a.card))
      throw Error("Нужно дать масть, а без масти — козыря");
    const led = requiredSuit(g);
    if (led !== null && suit(a.card) !== led) {
      if (!g.voids[p].includes(led)) g.voids[p].push(led);
      if (
        trump(g) < 4 &&
        suit(a.card) !== trump(g) &&
        !g.voids[p].includes(trump(g))
      )
        g.voids[p].push(trump(g));
    }
    g.hands[p] = g.hands[p].filter((c) => c !== a.card);
    g.table.push({ seat: p, card: a.card });
    if (g.contract?.misere && g.history.length === 0 && g.table.length === 1) {
      g.open = true;
      const defenders = ([0, 1, 2] as Seat[]).filter((s) => s !== g.declarer);
      g.controller = defenders.includes(0) ? 0 : defenders[0];
    }
    if (g.table.length === 3) {
      g.phase = "trick";
      g.lastWinner = winner(g.table, trump(g), requiredSuit(g) ?? undefined);
    } else g.turn = next(p);
    return g;
  }
  if (g.phase === "trick" && a.type === "collect") {
    const w = g.lastWinner!;
    g.taken[w]++;
    g.history.push(g.table);
    g.table = [];
    g.turn = !g.contract && g.history.length < 3 ? g.first : w;
    if (g.history.length === 10) finish(g);
    else g.phase = "play";
    return g;
  }
  throw Error("Действие недоступно");
}
