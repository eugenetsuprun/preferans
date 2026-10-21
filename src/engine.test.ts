import { describe, it, expect } from "vitest";
import {
  deal,
  step,
  legalCards,
  auctionBids,
  winner,
  suit,
  totals,
  type Game,
  CONTRACTS,
  MISERE,
  actor,
  emptyScores,
} from "./engine";
import { botAction, sampleWorld } from "./ai";
const fresh = () => deal({ difficulty: "easy", target: 10, speed: 0 });
function playToEnd(g: Game, max = 500) {
  let n = 0;
  while (g.phase !== "result" && n++ < max) {
    g = step(
      g,
      g.phase === "trick" ? { type: "collect" } : botAction(g, actor(g)),
    );
    expect(
      g.hands.flat().length +
        g.table.length +
        g.history.flat().length +
        g.discarded.length +
        (g.phase === "auction" || g.declarer === null ? 2 : 0),
    ).toBe(32);
  }
  expect(n).toBeLessThan(max);
  return g;
}
function finishFixture(
  bid: number,
  taken: number[],
  whists: Game["whists"] = ["wait", "whist", "whist"],
) {
  const g = fresh();
  g.phase = "trick";
  g.declarer = 0;
  g.contract = CONTRACTS[bid];
  g.taken = taken;
  g.lastWinner = 0;
  g.history = Array.from({ length: 9 }, () => []);
  g.whists = whists;
  return step(g, { type: "collect" });
}
describe("сочинка", () => {
  it("раздаёт 32 уникальные карты: 10/10/10 и прикуп", () => {
    const g = fresh();
    expect(g.hands.map((h) => h.length)).toEqual([10, 10, 10]);
    expect(new Set(g.hands.flat().concat(g.kitty)).size).toBe(32);
  });
  it("три паса запускают распасы без прикупа в руках", () => {
    let g = fresh();
    for (let i = 0; i < 3; i++) g = step(g, { type: "pass" });
    expect(g.phase).toBe("play");
    expect(g.declarer).toBe(null);
    expect(g.hands.flat()).toHaveLength(30);
  });
  it("два паса после заявки передают прикуп победителю", () => {
    let g = step(fresh(), { type: "bid", bid: 0 });
    g = step(step(g, { type: "pass" }), { type: "pass" });
    expect(g.phase).toBe("discard");
    expect(g.hands[0]).toHaveLength(12);
    expect(() =>
      step(g, { type: "discard", cards: [g.hands[0][0], g.hands[0][0]] }),
    ).toThrow();
    g = step(g, { type: "discard", cards: g.hands[0].slice(0, 2) });
    expect(g.hands[0]).toHaveLength(10);
    expect(g.phase).toBe("contract");
  });
  it("обязывает дать масть, затем козырь; перебивать необязательно", () => {
    const g = fresh();
    g.phase = "play";
    g.contract = { level: 6, suit: 0 };
    g.turn = 0;
    g.table = [{ seat: 2, card: 24 }];
    g.hands[0] = [0, 7, 8, 25];
    expect(legalCards(g)).toEqual([25]);
    g.hands[0] = [0, 7, 8];
    expect(legalCards(g)).toEqual([0, 7]);
    g.hands[0] = [8];
    expect(legalCards(g)).toEqual([8]);
  });
  it("прикуп задаёт масть всей взятки на первых двух распасах", () => {
    const g = fresh();
    g.phase = "play";
    g.contract = null;
    g.kitty = [8, 16];
    g.turn = 1;
    g.table = [{ seat: 0, card: 7 }];
    g.hands[1] = [9, 23];
    expect(legalCards(g)).toEqual([9]);
    expect(
      winner(
        [
          { seat: 0, card: 7 },
          { seat: 1, card: 9 },
          { seat: 2, card: 30 },
        ],
        4,
        1,
      ),
    ).toBe(1);
  });
  it("старший козырь побеждает туза другой масти", () =>
    expect(
      winner(
        [
          { seat: 0, card: 31 },
          { seat: 1, card: 0 },
          { seat: 2, card: 6 },
        ],
        0,
      ),
    ).toBe(2));
  it("мизер возможен только первой личной заявкой; девятерная его перебивает", () => {
    let g = step(fresh(), { type: "bid", bid: 0 });
    g = step(g, { type: "bid", bid: 1 });
    g = step(g, { type: "pass" });
    expect(auctionBids(g)).not.toContain(MISERE);
    g = fresh();
    expect(auctionBids(g)).toContain(MISERE);
    g = step(g, { type: "bid", bid: MISERE });
    expect(auctionBids(g)).toContain(16);
    expect(auctionBids(g)).not.toContain(14);
  });
  it("первая рука имеет право заявить «здесь»", () => {
    let g = step(fresh(), { type: "bid", bid: 0 });
    g = step(g, { type: "bid", bid: 1 });
    g = step(g, { type: "pass" });
    expect(auctionBids(g)).toContain(1);
    g = step(g, { type: "bid", bid: 1 });
    expect(auctionBids(g)).not.toContain(1);
  });
  it("нельзя заказать контракт ниже выигранной торговли", () => {
    let g = step(fresh(), { type: "bid", bid: 5 });
    g = step(step(g, { type: "pass" }), { type: "pass" });
    g = step(g, { type: "discard", cards: g.hands[0].slice(0, 2) });
    expect(() => step(g, { type: "contract", bid: 0 })).toThrow();
  });
  it("считает пулю, ответственный вист и жлобскую запись", () => {
    const g = finishFixture(0, [5, 2, 2]);
    expect(g.scores[0].pool).toBe(2);
    expect(g.scores[1].whists[0]).toBe(4);
    expect(g.scores[2].whists[0]).toBe(4);
    const remiz = finishFixture(0, [3, 3, 3], ["wait", "whist", "pass"]);
    expect(remiz.scores[0].hill).toBe(4);
    expect(remiz.scores[1].whists[0]).toBe(16);
    expect(remiz.scores[2].whists[0]).toBe(4);
  });
  it("мизер: за каждую взятку 10 в гору; за ноль 10 в пулю", () => {
    const g = finishFixture(MISERE, [1, 4, 4]);
    expect(g.scores[0].hill).toBe(20);
    const z = finishFixture(MISERE, [-1, 5, 5]);
    expect(z.scores[0].pool).toBe(10);
    expect(z.scores[1].whists[0]).toBe(0);
  });
  it("два паса на висте завершают контракт без розыгрыша", () => {
    let g = step(fresh(), { type: "bid", bid: 0 });
    g = step(step(g, { type: "pass" }), { type: "pass" });
    g = step(g, { type: "discard", cards: g.hands[0].slice(0, 2) });
    g = step(g, { type: "contract", bid: 0 });
    g = step(step(g, { type: "whist", choice: "pass" }), {
      type: "whist",
      choice: "pass",
    });
    expect(g.phase).toBe("result");
    expect(g.scores[0].pool).toBe(2);
  });
  it("полвиста может быть принято или возвращено первым защитником", () => {
    let g = step(fresh(), { type: "bid", bid: 0 });
    g = step(step(g, { type: "pass" }), { type: "pass" });
    g = step(g, { type: "discard", cards: g.hands[0].slice(0, 2) });
    g = step(g, { type: "contract", bid: 0 });
    g = step(step(g, { type: "whist", choice: "pass" }), {
      type: "whist",
      choice: "half",
    });
    expect(g.phase).toBe("half");
    const accepted = step(g, { type: "whist", choice: "pass" });
    expect(accepted.scores[2].whists[0]).toBe(4);
    expect(step(g, { type: "whist", choice: "whist" }).phase).toBe("opening");
  });
  it("открытый вист передаёт управление обеими руками одному вистующему", () => {
    const g = fresh();
    g.phase = "play";
    g.declarer = 2;
    g.open = true;
    g.controller = 0;
    g.turn = 1;
    expect(actor(g)).toBe(0);
    g.turn = 2;
    expect(actor(g)).toBe(2);
  });
  it("итоговая запись имеет нулевую сумму", () => {
    const scores = emptyScores();
    scores[0].hill = 8;
    scores[1].hill = 14;
    scores[2].hill = 3;
    scores[0].whists[1] = 18;
    scores[2].whists[0] = 12;
    expect(totals(scores).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 1);
  });
  it("семплирование не зависит от настоящих закрытых рук", () => {
    const g = fresh();
    g.phase = "play";
    g.contract = { level: 6, suit: 0 };
    g.declarer = 0;
    g.discarded = g.kitty;
    g.kitty = g.hands[0].slice(0, 2);
    const changed = structuredClone(g);
    [changed.hands[1], changed.hands[2]] = [changed.hands[2], changed.hands[1]];
    expect(sampleWorld(g, 0, () => 0.4)?.hands).toEqual(
      sampleWorld(changed, 0, () => 0.4)?.hands,
    );
  });
  it("семплирует мастевые отказы и сохраняет публичный прикуп", () => {
    let g = fresh();
    g = step(step(step(g, { type: "pass" }), { type: "pass" }), {
      type: "pass",
    });
    const world = sampleWorld(g, 0)!;
    expect(world).not.toBeNull();
    expect(new Set(world.hands.flat().concat(world.kitty)).size).toBe(32);
    g.voids[1] = [suit(g.hands[0][0])];
    const sample = sampleWorld(g, 0);
    if (sample)
      expect(sample.hands[1].every((c) => !g.voids[1].includes(suit(c)))).toBe(
        true,
      );
  });
  it("проходит 50 полных случайных раздач без зависаний и потери карт", () => {
    let g = fresh();
    for (let i = 0; i < 50; i++) {
      g = playToEnd(g);
      expect(g.records.at(-1)?.number).toBe(g.number);
      g = deal(g.settings, g);
    }
  }, 20000);
  it("распасы, мизер и десятерная завершают 10 взяток", () => {
    for (const b of [-1, MISERE, 21]) {
      let g = fresh();
      if (b < 0)
        g = step(step(step(g, { type: "pass" }), { type: "pass" }), {
          type: "pass",
        });
      else {
        g = step(g, { type: "bid", bid: b });
        g = step(step(g, { type: "pass" }), { type: "pass" });
        g = step(g, { type: "discard", cards: g.hands[0].slice(0, 2) });
        g = step(g, { type: "contract", bid: b });
      }
      g = playToEnd(g);
      expect(g.taken.reduce((a, b) => a + b, 0)).toBe(10);
    }
  }, 20000);
});
describe("высокая сложность", () => {
  it("проходит полный розыгрыш с поиском на закрытых руках", () => {
    let g = deal({ difficulty: "hard", target: 10, speed: 0 });
    g = step(g, { type: "bid", bid: 0 });
    g = step(step(g, { type: "pass" }), { type: "pass" });
    g = step(g, { type: "discard", cards: g.hands[0].slice(0, 2) });
    g = step(g, { type: "contract", bid: 0 });
    g = step(step(g, { type: "whist", choice: "whist" }), {
      type: "whist",
      choice: "whist",
    });
    g = playToEnd(g);
    expect(g.history).toHaveLength(10);
    expect(g.taken.reduce((a, b) => a + b, 0)).toBe(10);
  }, 60000);
});
