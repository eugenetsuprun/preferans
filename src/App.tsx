import { useEffect, useRef, useState } from "react";
import PwaControls from "./PwaControls";
import {
  type Game,
  type Card,
  type Seat,
  type Settings,
  type Action,
  type Difficulty,
  SUITS,
  RANKS,
  NAMES,
  CONTRACTS,
  actor,
  deal,
  step,
  sort,
  suit,
  rank,
  label,
  cardLabel,
  legalCards,
  auctionBids,
  contractBids,
  whistChoices,
  totals,
  requiredSuit,
} from "./engine";
const KEY = "preferans-sochi-v1";
const DEFAULT: Settings = { difficulty: "hard", target: 30, speed: 650 };
function saved(): Game | null {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "null");
    return data?.version === 1 &&
      Array.isArray(data.hands) &&
      data.hands.length === 3
      ? data
      : null;
  } catch {
    return null;
  }
}
const levels: Record<Difficulty, string> = {
  easy: "Лёгкая",
  medium: "Средняя",
  hard: "Высокая",
};
function SuitMark({ value }: { value: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="suit-mark"
      fill="currentColor"
    >
      {value === 0 ? (
        <path d="M12 1.5C9 5.5 2.5 9.5 2.5 14c0 5.8 7.1 6.8 9 2.1L9.7 22h4.6l-1.8-5.9c1.9 4.7 9 3.7 9-2.1 0-4.5-6.5-8.5-9.5-12.5Z" />
      ) : value === 1 ? (
        <>
          <circle cx="12" cy="6" r="4.5" />
          <circle cx="6" cy="13" r="4.5" />
          <circle cx="18" cy="13" r="4.5" />
          <path d="M10.2 11h3.6c-.1 4.6.5 8.2 2.1 11H8.1c1.6-2.8 2.2-6.4 2.1-11Z" />
        </>
      ) : value === 2 ? (
        <path d="m12 1 9 11-9 11L3 12Z" />
      ) : (
        <path d="M12 22C9 18.7 1.5 13.2 1.5 7.1c0-6.1 7.3-8 10.5-2.6 3.2-5.4 10.5-3.5 10.5 2.6C22.5 13.2 15 18.7 12 22Z" />
      )}
    </svg>
  );
}

function CardView({
  card,
  back = false,
  disabled = false,
  selected = false,
  onClick,
  small = false,
}: {
  card?: Card;
  back?: boolean;
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
}) {
  const content = back ? (
    <span className="back-emblem">♠</span>
  ) : (
    <>
      <span className="tile-rank">{RANKS[rank(card!)]}</span>
      <span className="tile-suit">
        <SuitMark value={suit(card!)} />
      </span>
    </>
  );
  const cls = `card ${!back && card !== undefined ? `suit-${suit(card)}` : ""} ${back ? "back" : ""} ${card !== undefined && suit(card) > 1 ? "red" : ""} ${small ? "small" : ""} ${selected ? "selected" : ""}`;
  return onClick ? (
    <button
      className={cls}
      disabled={disabled}
      onClick={onClick}
      aria-label={cardLabel(card!)}
      aria-pressed={selected}
    >
      {content}
    </button>
  ) : (
    <div
      className={cls}
      aria-label={back ? "Закрытая карта" : cardLabel(card!)}
    >
      {content}
    </div>
  );
}
function ScoreTable({ g }: { g: Game }) {
  const sum = totals(g.scores);
  return (
    <table className="score-table">
      <thead>
        <tr>
          <th>Запись</th>
          {NAMES.map((n) => (
            <th key={n}>{n}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th>Пуля / {g.settings.target}</th>
          {g.scores.map((s, i) => (
            <td key={i} className="gold">
              {s.pool}
            </td>
          ))}
        </tr>
        <tr>
          <th>Гора</th>
          {g.scores.map((s, i) => (
            <td key={i}>{s.hill}</td>
          ))}
        </tr>
        {NAMES.map((n, i) => (
          <tr key={n}>
            <th>
              Висты на{" "}
              {n === "Вы" ? "вас" : n === "Алексей" ? "Алексея" : "Михаила"}
            </th>
            {g.scores.map((s, j) => (
              <td key={j}>{i === j ? "—" : s.whists[i]}</td>
            ))}
          </tr>
        ))}
        <tr className="total">
          <th>Итог, висты</th>
          {sum.map((n, i) => (
            <td key={i} className={n >= 0 ? "gold" : ""}>
              {n > 0 ? "+" : ""}
              {n.toFixed(2)}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
function ScoreStrip({ g, seat }: { g: Game; seat: Seat }) {
  const net = totals(g.scores)[seat];
  return (
    <div className="score-strip" aria-label={`Очки: ${NAMES[seat]}`}>
      <span>
        <small>Пуля / {g.settings.target}</small>
        <strong className="gold">{g.scores[seat].pool}</strong>
      </span>
      <span>
        <small>Гора</small>
        <strong>{g.scores[seat].hill}</strong>
      </span>
      <span>
        <small>Итог, висты</small>
        <strong className={net >= 0 ? "gold" : "negative"}>
          {net > 0 ? "+" : ""}
          {net.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
        </strong>
      </span>
    </div>
  );
}

export default function App() {
  const [g, setG] = useState<Game | null>(saved),
    [started, setStarted] = useState(false),
    [settings, setSettings] = useState<Settings>(
      () => saved()?.settings ?? DEFAULT,
    ),
    [modal, setModal] = useState<"settings" | "score" | "restart" | null>(null),
    [selected, setSelected] = useState<Card[]>([]),
    [bid, setBid] = useState(0),
    [error, setError] = useState(""),
    [thinking, setThinking] = useState(false),
    [paused, setPaused] = useState(false);
  const sequence = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const human = !!g && actor(g) === 0,
    playable = g?.phase === "play" && human ? legalCards(g) : [];
  // Keep your own hand in place; a controlled partner is played in their panel.
  const handSeat: Seat = 0;
  const dispatch = (a: Action) => {
    setError("");
    setG((current) => {
      if (!current) return current;
      try {
        return step(current, a);
      } catch (e) {
        setError((e as Error).message);
        return current;
      }
    });
  };
  useEffect(() => {
    if (g)
      try {
        localStorage.setItem(KEY, JSON.stringify(g));
      } catch {
        setError("Не удалось сохранить игру в браузере.");
      }
  }, [g]);
  useEffect(() => {
    setSelected([]);
    if (g) {
      const choices =
        g.phase === "auction"
          ? auctionBids(g)
          : g.phase === "contract"
            ? contractBids(g)
            : [];
      setBid(choices[0] ?? 0);
    }
  }, [g?.phase, g?.turn, g?.number, g?.highest]);
  useEffect(() => {
    if (!g || !started || modal || paused) return;
    const id = ++sequence.current;
    if (g.phase === "trick") {
      const timeout = setTimeout(
        () => dispatch({ type: "collect" }),
        Math.max(900, g.settings.speed * 1.7),
      );
      return () => clearTimeout(timeout);
    }
    if (g.phase === "result" || actor(g) === 0) {
      setThinking(false);
      return;
    }
    setThinking(true);
    const worker = new Worker(new URL("./ai.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    let timer: ReturnType<typeof setTimeout> | undefined;
    worker.onmessage = ({ data }) => {
      if (sequence.current !== id) return;
      if (data.error) {
        setError("Ошибка соперника. Попробуйте продолжить игру.");
        setThinking(false);
        return;
      }
      timer = setTimeout(() => {
        setThinking(false);
        dispatch(data.action);
      }, g.settings.speed);
    };
    worker.onerror = () => {
      setThinking(false);
      setError(
        "Не удалось запустить соперника. Обновите страницу: игра сохранена.",
      );
    };
    worker.postMessage({ id, game: g, observer: actor(g) });
    return () => {
      clearTimeout(timer);
      worker.terminate();
      workerRef.current = null;
      setThinking(false);
    };
  }, [g, started, modal, paused]);
  useEffect(() => {
    const visibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  function start(fresh = false) {
    if (fresh || !g) setG(deal(settings));
    setStarted(true);
    setModal(null);
  }
  function applySettings() {
    setG((current) =>
      current
        ? {
            ...current,
            settings: { ...settings, target: current.settings.target },
          }
        : null,
    );
    setModal(null);
  }
  const phaseName = g
    ? {
        auction: "Торговля",
        discard: "Прикуп и снос",
        contract: "Заказ игры",
        whist: "Вистование",
        half: "Полвиста",
        opening: "Вистование",
        play: "Розыгрыш",
        trick: "Взятка",
        result: g.finished ? "Пуля окончена" : "Раздача окончена",
      }[g.phase]
    : "";
  function badge(s: Seat) {
    if (!g) return null;
    const active = g.turn === s && g.phase !== "result" && g.phase !== "trick";
    const exposed = g.open && g.declarer !== null;
    return (
      <section
        className={`player player-${s} ${active ? "active" : ""}`}
        aria-label={`${NAMES[s]}${active ? ", сейчас ходит" : ""}`}
        aria-current={active ? "true" : undefined}
      >
        <div className="player-top">
          <span className="avatar">{s === 1 ? "А" : "М"}</span>
          <div>
            <h2>
              {NAMES[s]}{" "}
              <span className={`bot ${active ? "turn-badge" : ""}`}>
                {active ? "Ходит" : "бот"}
              </span>
            </h2>
            <p>
              {g.calls[s] ||
                (g.first === s
                  ? "Первая рука"
                  : g.dealer === s
                    ? "Сдающий"
                    : "Вторая рука")}
            </p>
          </div>
          <span className="player-count">
            <b>{g.taken[s]}</b>
            <span>взяток</span>
          </span>
        </div>
        <ScoreStrip g={g} seat={s} />
        <div className={`opponent-hand ${exposed ? "exposed" : ""}`}>
          {g.hands[s].map((c, i) => (
            <CardView
              key={exposed ? c : i}
              card={exposed ? c : undefined}
              back={!exposed}
              small
              onClick={
                exposed && human && g.phase === "play" && g.turn === s
                  ? () => dispatch({ type: "play", card: c })
                  : undefined
              }
              disabled={!playable.includes(c)}
            />
          ))}
        </div>
      </section>
    );
  }
  if (!started)
    return (
      <main className="lobby">
        <div className="lobby-suit">♠</div>
        <h1>Преферанс</h1>
        <p className="lobby-sub">Сочинка</p>
        <div className="lobby-line" />
        <p className="lobby-description">
          Один стол. Три игрока.
          <br />
          Вы и два компьютерных соперника.
        </p>
        <div className="lobby-settings">
          <label>
            Сложность ботов
            <select
              value={settings.difficulty}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  difficulty: e.target.value as Difficulty,
                })
              }
            >
              {Object.entries(levels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Пуля до
            <select
              value={settings.target}
              onChange={(e) =>
                setSettings({ ...settings, target: +e.target.value })
              }
            >
              {[10, 20, 30, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} очков
                </option>
              ))}
            </select>
          </label>
        </div>
        {g && (
          <button className="primary wide" onClick={() => start()}>
            Продолжить · раздача {g.number}
          </button>
        )}
        <button
          className={g ? "secondary wide" : "primary wide"}
          onClick={() => (g ? setModal("restart") : start(true))}
        >
          Новая пуля
        </button>
        <PwaControls />
        <p className="lobby-note">
          Торговля, мизер, распасы.
          <br />
          Игра сохраняется автоматически.
        </p>
        {modal === "restart" && (
          <div className="overlay">
            <section className="dialog">
              <h2>Начать новую пулю?</h2>
              <p>Текущая запись будет заменена.</p>
              <div className="actions">
                <button onClick={() => setModal(null)}>Отмена</button>
                <button className="primary" onClick={() => start(true)}>
                  Новая пуля
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    );
  if (!g) return null;
  const bidding =
    g.phase === "auction"
      ? auctionBids(g)
      : g.phase === "contract"
        ? contractBids(g)
        : [];
  const status =
    g.phase === "play"
      ? human
        ? g.turn === 0
          ? "Ваш ход"
          : `Ваш ход за ${g.turn === 1 ? "Алексея" : "Михаила"}`
        : `${NAMES[g.turn]} ходит`
      : g.phase === "trick"
        ? `${NAMES[g.lastWinner!]} ${g.lastWinner === 0 ? "берёте" : "берёт"} взятку`
        : g.phase === "result"
          ? g.note
          : human
            ? g.phase === "discard"
              ? "Выберите две карты для сноса"
              : g.phase === "contract"
                ? "Закажите игру"
                : g.phase === "whist"
                  ? "Ваше решение"
                  : g.phase === "half"
                    ? "Принять полвиста или вернуть вист?"
                    : g.phase === "opening"
                      ? "Как будете вистовать?"
                      : "Ваша заявка"
            : `${NAMES[g.turn]} ${thinking ? "думает…" : "принимает решение"}`;
  return (
    <main className="game">
      <header className="header">
        <div className="brand">
          <span>♠</span> Преферанс <span className="variant">Сочинка</span>
        </div>
        <div className="header-controls">
          <PwaControls />
          <button onClick={() => setModal("score")}>
            Пуля{" "}
            <b>
              {g.scores[0].pool}/{g.settings.target}
            </b>
          </button>
          <button
            onClick={() => {
              setSettings(g.settings);
              setModal("settings");
            }}
            aria-label="Настройки"
          >
            ⚙
          </button>
        </div>
      </header>
      <div className="round-bar">
        <span>Раздача {g.number}</span>
        <span>{phaseName}</span>
        {g.phase !== "result" && (
          <span className="turn-indicator">
            {g.phase === "trick"
              ? `Взятка: ${NAMES[g.lastWinner!]}`
              : g.turn === 0
                ? "Ваш ход"
                : `Ходит: ${NAMES[g.turn]}${human ? " (вы за партнёра)" : ""}`}
          </span>
        )}
        <span>{levels[g.settings.difficulty]}</span>
      </div>
      {g.phase !== "auction" && (
        <div className="game-stakes" aria-label="Стоимость игры">
          {g.contract ? (
            <>
              <span>
                {label(g.contract)}:{" "}
                <b>
                  {g.contract.misere ? 10 : (g.contract.level - 5) * 2} очков в
                  пулю
                </b>
              </span>
              <span>
                {g.contract.misere
                  ? "Взятки на мизере"
                  : "Взятки разыгрывающего"}
                :{" "}
                <b>
                  {g.taken[g.declarer!]}/
                  {g.contract.misere ? 0 : g.contract.level}
                </b>
              </span>
            </>
          ) : (
            <>
              <span>
                Распасы: <b>1 очко в гору за взятку</b>
              </span>
              <span>
                За ноль: <b>1 очко в пулю</b>
              </span>
            </>
          )}
        </div>
      )}
      <div className="opponents">
        {badge(1)}
        {badge(2)}
      </div>
      <section className="table-area" aria-label="Игровой стол">
        <div className="table-outline" />
        {g.contract && g.phase !== "result" && (
          <div className="contract-token">
            <span>{label(g.contract)}</span>
            <small>
              {NAMES[g.declarer!]} {g.declarer === 0 ? "играете" : "играет"}
            </small>
            <small className="kitty-note">
              Прикуп: {g.kitty.map(cardLabel).join(" · ")}
            </small>
          </div>
        )}
        {!g.contract && g.phase !== "auction" && g.phase !== "result" && (
          <div className="contract-token">
            <span>Распасы</span>
            <small>
              {g.history.length < 2
                ? `Масть прикупа: ${SUITS[requiredSuit(g)!]}`
                : "Без козыря"}
            </small>
          </div>
        )}
        {g.phase === "auction" && (
          <div className="kitty-center">
            <div className="kitty-cards">
              <CardView back small />
              <CardView back small />
            </div>
            <span>Прикуп</span>
          </div>
        )}
        {g.phase === "discard" && (
          <div className="kitty-center">
            <div className="kitty-cards">
              {g.kitty.map((c) => (
                <CardView key={c} card={c} small />
              ))}
            </div>
            <span>
              {g.declarer === 0 ? "Прикуп ваш" : "Прикуп разыгрывающего"}
            </span>
          </div>
        )}
        {(g.phase === "play" || g.phase === "trick") && (
          <>
            <div className="trick-counter">
              Взятка {g.history.length + 1} / 10
            </div>
            <div className="played-cards">
              {g.table.map((p) => (
                <div
                  key={p.seat}
                  className={`played seat-${p.seat} ${g.phase === "trick" && g.lastWinner === p.seat ? "winning" : ""}`}
                >
                  <CardView card={p.card} />
                  <span>{NAMES[p.seat]}</span>
                </div>
              ))}
            </div>
            {g.table.length === 0 && <span className="table-watermark">♠</span>}
          </>
        )}
        {g.phase === "result" && (
          <div className="result-panel">
            <div className="result-symbol">{g.finished ? "♠" : "✓"}</div>
            <h2>
              {g.finished
                ? "Пуля окончена"
                : g.declarer === null
                  ? "Распасы"
                  : g.contract?.misere
                    ? "Мизер"
                    : label(g.contract)}
            </h2>
            <p>{g.note}</p>
            <div className="result-taken">
              {NAMES.map((n, i) => (
                <span key={n}>
                  {n}
                  <b>{g.taken[i]}</b>
                </span>
              ))}
            </div>
            {g.finished && (
              <p>
                {totals(g.scores)[0] >= Math.max(...totals(g.scores))
                  ? "Вы выиграли пулю."
                  : "Победитель: " +
                    NAMES[
                      totals(g.scores).indexOf(Math.max(...totals(g.scores)))
                    ]}
              </p>
            )}
            <button
              className="primary"
              onClick={() =>
                g.finished ? setModal("score") : dispatch({ type: "next" })
              }
            >
              {g.finished ? "Итоговая запись" : "Следующая раздача"}
            </button>
          </div>
        )}
      </section>
      <section className="decision-area">
        <div
          role="status"
          aria-live="polite"
          className={`status ${human ? "your-turn" : ""}`}
        >
          <span className={`status-dot ${thinking ? "thinking" : ""}`} />
          {status}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {human && (g.phase === "auction" || g.phase === "contract") && (
          <div className="bid-controls">
            <label className="sr-only" htmlFor="bid">
              Заявка
            </label>
            <select
              id="bid"
              value={bid}
              onChange={(e) => setBid(+e.target.value)}
            >
              {bidding.map((i) => (
                <option key={i} value={i}>
                  {label(CONTRACTS[i])}
                  {g.phase === "auction" && i === g.highest ? " · здесь" : ""}
                </option>
              ))}
            </select>
            <button
              className="primary"
              disabled={!bidding.length}
              onClick={() =>
                dispatch(
                  g.phase === "auction"
                    ? { type: "bid", bid }
                    : { type: "contract", bid },
                )
              }
            >
              {g.phase === "contract" ? "Заказать" : "Заявить"}
            </button>
            {g.phase === "auction" && (
              <button onClick={() => dispatch({ type: "pass" })}>Пас</button>
            )}
          </div>
        )}
        {human && g.phase === "discard" && (
          <button
            className="primary"
            disabled={selected.length !== 2}
            onClick={() => dispatch({ type: "discard", cards: selected })}
          >
            Снести {selected.length} / 2
          </button>
        )}
        {human && (g.phase === "whist" || g.phase === "half") && (
          <div className="actions">
            {whistChoices(g).map((c) => (
              <button
                key={c}
                className={c === "whist" ? "primary" : ""}
                onClick={() => dispatch({ type: "whist", choice: c })}
              >
                {c === "whist" ? "Вист" : c === "half" ? "Полвиста" : "Пас"}
              </button>
            ))}
          </div>
        )}
        {human && g.phase === "opening" && (
          <div className="actions">
            <button
              className="primary"
              onClick={() => dispatch({ type: "open", open: true })}
            >
              В светлую
            </button>
            <button onClick={() => dispatch({ type: "open", open: false })}>
              В тёмную
            </button>
          </div>
        )}
      </section>
      <footer
        className={`your-area ${g.turn === 0 && g.phase !== "result" && g.phase !== "trick" ? "active-hand" : ""}`}
      >
        <div className="your-bar">
          <span>
            <b>{handSeat === 0 ? "Вы" : `Ход за ${NAMES[handSeat]}`}</b>
            <small>{g.calls[handSeat] || "Ваша рука"}</small>
          </span>
          <span>
            <b>{g.taken[0]}</b>
            <small>взяток</small>
          </span>
        </div>
        <ScoreStrip g={g} seat={0} />
        <div className="hand-area" aria-label={`Карты: ${NAMES[handSeat]}`}>
          {[0, 1, 2, 3]
            .filter((st) => g.hands[handSeat].some((c) => suit(c) === st))
            .map((st) => (
              <div className="suit-row" key={st}>
                <span
                  className={`suit-label ${st > 1 ? "red" : ""}`}
                  aria-hidden="true"
                >
                  {SUITS[st]}
                </span>
                <div className="suit-tiles">
                  {sort(g.hands[handSeat])
                    .filter((c) => suit(c) === st)
                    .map((c) => (
                      <CardView
                        key={c}
                        card={c}
                        selected={selected.includes(c)}
                        disabled={
                          g.phase === "discard"
                            ? g.declarer !== 0
                            : !playable.includes(c) || !human
                        }
                        onClick={() => {
                          if (g.phase === "discard")
                            setSelected((s) =>
                              s.includes(c)
                                ? s.filter((x) => x !== c)
                                : s.length < 2
                                  ? [...s, c]
                                  : s,
                            );
                          else dispatch({ type: "play", card: c });
                        }}
                      />
                    ))}
                </div>
              </div>
            ))}
        </div>
        <div className="footer-line">
          <span>
            {g.dealer === 0 ? "Вы сдаёте" : `${NAMES[g.dealer]} сдаёт`}
          </span>
          <button onClick={() => setModal("score")}>Запись пули</button>
          <span>Сохранено на устройстве</span>
        </div>
      </footer>
      {modal && (
        <div className="overlay" onClick={() => setModal(null)}>
          <section
            className={`dialog ${modal === "score" ? "score-dialog" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "score"
                ? "Запись пули"
                : modal === "settings"
                  ? "Настройки"
                  : "Новая пуля"
            }
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setModal(null);
              if (e.key === "Tab") {
                const items = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    "button:not([disabled]),select,a,summary",
                  ),
                );
                const first = items[0],
                  last = items[items.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <div className="dialog-header">
              <h2>
                {modal === "score"
                  ? "Запись пули"
                  : modal === "settings"
                    ? "Настройки"
                    : "Новая пуля"}
              </h2>
              <button
                autoFocus
                aria-label="Закрыть"
                onClick={() => setModal(null)}
              >
                ×
              </button>
            </div>
            {modal === "score" ? (
              <>
                <ScoreTable g={g} />
                <details>
                  <summary>История раздач ({g.records.length})</summary>
                  <div className="history">
                    {g.records
                      .slice()
                      .reverse()
                      .map((r) => (
                        <p key={r.number}>
                          <span>
                            #{r.number} ·{" "}
                            {r.declarer === null ? "Все" : NAMES[r.declarer]} ·{" "}
                            {r.label}
                          </span>
                          <small>{r.note}</small>
                        </p>
                      ))}
                  </div>
                </details>
                {g.finished && (
                  <button
                    className="primary wide"
                    onClick={() => setModal("restart")}
                  >
                    Новая пуля
                  </button>
                )}
              </>
            ) : modal === "settings" ? (
              <>
                <label>
                  Сложность ботов
                  <select
                    value={settings.difficulty}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        difficulty: e.target.value as Difficulty,
                      })
                    }
                  >
                    {Object.entries(levels).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Темп игры
                  <select
                    value={settings.speed}
                    onChange={(e) =>
                      setSettings({ ...settings, speed: +e.target.value })
                    }
                  >
                    <option value={250}>Быстрый</option>
                    <option value={650}>Обычный</option>
                    <option value={1100}>Спокойный</option>
                  </select>
                </label>
                <button className="primary wide" onClick={applySettings}>
                  Сохранить
                </button>
                <details className="conventions">
                  <summary>Договорённости стола</summary>
                  <p>
                    Сочинка. Ответственный жлобский вист. Полвиста на шестерной
                    и семерной. Десятерная проверяется розыгрышем без вистов.
                    Распасы по 1, без прогрессии и без ужесточения выхода.
                    Прикуп задаёт масть первых двух ходов; первые три хода с
                    первой руки. Мизер без прикупа не играется. Сталинграда нет.
                    Помощь в пулю с вистами ×10.
                  </p>
                  <a
                    href="https://preferans.games/sochi/rules/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Правила сочинки
                  </a>
                </details>
                <button
                  className="text-button wide"
                  onClick={() => setModal("restart")}
                >
                  Начать новую пулю
                </button>
              </>
            ) : (
              <>
                <p>Текущая запись будет заменена.</p>
                <label>
                  Пуля до
                  <select
                    value={settings.target}
                    onChange={(e) =>
                      setSettings({ ...settings, target: +e.target.value })
                    }
                  >
                    {[10, 20, 30, 50, 100].map((n) => (
                      <option key={n} value={n}>
                        {n} очков
                      </option>
                    ))}
                  </select>
                </label>
                <div className="actions">
                  <button onClick={() => setModal(null)}>Отмена</button>
                  <button className="primary" onClick={() => start(true)}>
                    Начать
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
