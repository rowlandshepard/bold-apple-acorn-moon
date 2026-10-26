import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Check, RotateCcw, Shuffle, X } from "lucide-react";
import { CARDS, LECTURES, type Card, type Lecture } from "@/data/cards";

type Tag = "known" | "needs-work";
type Mode = "due" | "work" | "all";
type View = "lobby" | "study" | "done";

type Save = {
  tags: Record<string, Tag>;
  lectures: Lecture[];
  mode: Mode;
};

const STORAGE_KEY = "lumen-cards-v1";

const DEFAULT_SAVE: Save = {
  tags: {},
  lectures: [7, 8, 9, 10],
  mode: "due",
};

const MODES: { id: Mode; label: string; hint: string }[] = [
  {
    id: "due",
    label: "Hide known",
    hint: "New cards and cards that need work",
  },
  {
    id: "work",
    label: "Needs work",
    hint: "Only cards you flagged",
  },
  {
    id: "all",
    label: "Whole deck",
    hint: "Includes cards you already know",
  },
];

function isLecture(value: unknown): value is Lecture {
  return value === 7 || value === 8 || value === 9 || value === 10;
}

function isTag(value: unknown): value is Tag {
  return value === "known" || value === "needs-work";
}

function isMode(value: unknown): value is Mode {
  return value === "due" || value === "work" || value === "all";
}

function sanitize(raw: unknown): Save {
  if (!raw || typeof raw !== "object") return DEFAULT_SAVE;
  const record = raw as Partial<Save>;
  const lectures = Array.isArray(record.lectures)
    ? record.lectures.filter(isLecture)
    : [];
  const tags: Record<string, Tag> = {};
  if (record.tags && typeof record.tags === "object") {
    for (const [id, tag] of Object.entries(record.tags)) {
      if (isTag(tag) && CARDS.some((card) => card.id === id)) tags[id] = tag;
    }
  }
  return {
    tags,
    lectures: lectures.length ? lectures : DEFAULT_SAVE.lectures,
    mode: isMode(record.mode) ? record.mode : "due",
  };
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = current;
  }
  return copy;
}

function inPool(card: Card, save: Save, mode: Mode): boolean {
  if (!save.lectures.includes(card.lecture)) return false;
  const tag = save.tags[card.id];
  if (mode === "all") return true;
  if (mode === "work") return tag === "needs-work";
  return tag !== "known";
}

const cardById = new Map(CARDS.map((card) => [card.id, card]));

export function DeckApp() {
  const [save, setSave] = useState<Save>(DEFAULT_SAVE);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("lobby");
  const [queue, setQueue] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionAnswered, setSessionAnswered] = useState(0);
  const [query, setQuery] = useState("");
  const [indexFilter, setIndexFilter] = useState<"all" | Tag | "new">("all");
  const [armed, setArmed] = useState<null | "known" | "all">(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const verdictRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSave(sanitize(JSON.parse(raw)));
    } catch {
      /* keep defaults */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  }, [save, ready]);

  const counts = useMemo(() => {
    let known = 0;
    let work = 0;
    let fresh = 0;
    for (const card of CARDS) {
      if (!save.lectures.includes(card.lecture)) continue;
      const tag = save.tags[card.id];
      if (tag === "known") known += 1;
      else if (tag === "needs-work") work += 1;
      else fresh += 1;
    }
    return { known, work, fresh, due: fresh + work, total: known + work + fresh };
  }, [save]);

  const poolSize = useMemo(() => {
    return CARDS.filter((card) => inPool(card, save, save.mode)).length;
  }, [save]);

  const card = view === "study" ? cardById.get(queue[cursor] ?? "") : undefined;
  const graded = picked !== null && card !== undefined;
  const correctPick = graded && picked === card.answer;

  useEffect(() => {
    if (view === "study") headingRef.current?.focus();
  }, [view, cursor]);

  useEffect(() => {
    if (picked !== null) {
      verdictRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [picked, cursor]);

  function setTag(id: string, tag: Tag | null) {
    setSave((current) => {
      const tags = { ...current.tags };
      if (tag === null) delete tags[id];
      else tags[id] = tag;
      return { ...current, tags };
    });
  }

  function toggleLecture(id: Lecture) {
    setSave((current) => {
      const has = current.lectures.includes(id);
      const lectures = has
        ? current.lectures.filter((lecture) => lecture !== id)
        : [...current.lectures, id].sort((a, b) => a - b);
      if (!lectures.length) return current;
      return { ...current, lectures };
    });
  }

  function start(mode = save.mode) {
    const next = shuffle(
      CARDS.filter((item) => inPool(item, save, mode)).map((item) => item.id),
    );
    if (!next.length) return;
    lock.current = false;
    setQueue(next);
    setCursor(0);
    setPicked(null);
    setSessionCorrect(0);
    setSessionAnswered(0);
    setView("study");
  }

  function choose(index: number) {
    if (!card || lock.current) return;
    lock.current = true;
    setPicked(index);
    setSessionAnswered((count) => count + 1);
    if (index === card.answer) setSessionCorrect((count) => count + 1);
  }

  function advance() {
    lock.current = false;
    if (cursor + 1 >= queue.length) setView("done");
    else {
      setCursor((value) => value + 1);
      setPicked(null);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (view !== "study" || !card) return;
      if (picked === null && ["1", "2", "3", "4"].includes(event.key)) {
        choose(Number(event.key) - 1);
      }
      if (picked !== null && (event.key === "n" || event.key === "N" || event.key === "Enter")) {
        event.preventDefault();
        advance();
      }
      if (picked !== null && (event.key === "k" || event.key === "K")) {
        setTag(card.id, save.tags[card.id] === "known" ? null : "known");
      }
      if (picked !== null && (event.key === "w" || event.key === "W")) {
        setTag(card.id, save.tags[card.id] === "needs-work" ? null : "needs-work");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const indexCards = CARDS.filter((item) => {
    if (!save.lectures.includes(item.lecture)) return false;
    const tag = save.tags[item.id];
    if (indexFilter === "known" || indexFilter === "needs-work") return tag === indexFilter;
    if (indexFilter === "new") return !tag;
    return true;
  }).filter((item) => {
    const haystack = `${item.prompt} ${item.topic} ${item.why}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      {view === "lobby" ? (
        <Lobby
          save={save}
          counts={counts}
          poolSize={poolSize}
          query={query}
          indexFilter={indexFilter}
          indexCards={indexCards}
          onQuery={setQuery}
          onIndexFilter={setIndexFilter}
          onMode={(mode) => setSave((current) => ({ ...current, mode }))}
          onToggleLecture={toggleLecture}
          onStart={() => start()}
          onTag={setTag}
          onClearKnown={() => {
            if (armed !== "known") {
              setArmed("known");
              return;
            }
            setArmed(null);
            setSave((current) => {
              const tags = { ...current.tags };
              for (const id of Object.keys(tags)) {
                if (tags[id] === "known") delete tags[id];
              }
              return { ...current, tags };
            });
          }}
          onClearAll={() => {
            if (armed !== "all") {
              setArmed("all");
              return;
            }
            setArmed(null);
            setSave((current) => ({ ...current, tags: {} }));
          }}
          armed={armed}
        />
      ) : null}

      {view === "study" && card ? (
        <Study
          card={card}
          cursor={cursor}
          total={queue.length}
          picked={picked}
          graded={graded}
          correctPick={correctPick}
          sessionCorrect={sessionCorrect}
          sessionAnswered={sessionAnswered}
          tag={save.tags[card.id]}
          headingRef={headingRef}
          verdictRef={verdictRef}
          onChoose={choose}
          onTag={(tag) => setTag(card.id, save.tags[card.id] === tag ? null : tag)}
          onAdvance={advance}
          onExit={() => setView("lobby")}
          onReshuffle={() => start()}
        />
      ) : null}

      {view === "done" ? (
        <Done
          sessionCorrect={sessionCorrect}
          sessionAnswered={sessionAnswered}
          known={counts.known}
          remaining={CARDS.filter((item) => inPool(item, save, "due")).length}
          onAgain={() => start("due")}
          onAll={() => {
            setSave((current) => ({ ...current, mode: "all" }));
            start("all");
          }}
          onLobby={() => setView("lobby")}
        />
      ) : null}
    </main>
  );
}

function Lobby({
  save,
  counts,
  poolSize,
  query,
  indexFilter,
  indexCards,
  onQuery,
  onIndexFilter,
  onMode,
  onToggleLecture,
  onStart,
  onTag,
  onClearKnown,
  onClearAll,
  armed,
}: {
  save: Save;
  counts: { known: number; work: number; fresh: number; due: number; total: number };
  poolSize: number;
  query: string;
  indexFilter: "all" | Tag | "new";
  indexCards: Card[];
  onQuery: (value: string) => void;
  onIndexFilter: (value: "all" | Tag | "new") => void;
  onMode: (mode: Mode) => void;
  onToggleLecture: (id: Lecture) => void;
  onStart: () => void;
  onTag: (id: string, tag: Tag | null) => void;
  onClearKnown: () => void;
  onClearAll: () => void;
  armed: null | "known" | "all";
}) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-4">
        <span className="mt-2 flex w-8 shrink-0 flex-col gap-1" aria-hidden="true">
          <span className="h-1.5 rounded-full bg-chlorophyll" />
          <span className="h-1.5 rounded-full bg-brass" />
          <span className="h-1.5 rounded-full bg-ink" />
        </span>
        <div>
          <p className="text-xs font-medium tracking-widest text-brass uppercase">BIOL 1414</p>
          <h1 className="mt-1 text-4xl text-ink sm:text-5xl">Lumen Cards</h1>
          <p className="mt-2 max-w-xl text-pretty text-muted">
            Lectures 7–10. Answer the card, see whether you were right, then mark it.
            The next shuffle leaves known cards out.
          </p>
        </div>
      </header>

      <section className="grid grid-cols-3 gap-2" aria-label="Deck counts">
        <Stat value={counts.due} label="Still in play" />
        <Stat value={counts.known} label="Known" />
        <Stat value={counts.work} label="Needs work" />
      </section>

      <button
        type="button"
        onClick={onStart}
        disabled={poolSize === 0}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-chlorophyll px-4 font-medium text-paper disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Shuffle className="size-5" aria-hidden="true" />
        {poolSize === 0 ? "Nothing to shuffle" : `Shuffle ${poolSize} cards`}
      </button>
      {poolSize === 0 ? (
        <p className="text-sm text-muted">
          {save.mode === "work"
            ? "No cards are marked needs work in this lecture filter."
            : "Every card in this filter is marked known. Clear those marks, or shuffle the whole deck."}
        </p>
      ) : (
        <p className="text-sm text-muted">
          {save.mode === "due"
            ? `${counts.known} known ${counts.known === 1 ? "card stays" : "cards stay"} out of this shuffle.`
            : null}
          {save.mode === "all" ? "Known cards are included this time." : null}
          {save.mode === "work" ? "Only needs-work cards are in this shuffle." : null}
        </p>
      )}

      <section className="sheet rounded-2xl p-4 sm:p-5">
        <h2 className="text-lg text-ink">Lectures</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {LECTURES.map((lecture) => {
            const on = save.lectures.includes(lecture.id);
            const lectureCards = CARDS.filter((card) => card.lecture === lecture.id);
            const known = lectureCards.filter((card) => save.tags[card.id] === "known").length;
            return (
              <button
                key={lecture.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggleLecture(lecture.id)}
                className={
                  "min-h-12 rounded-xl border px-3 py-2 text-left " +
                  (on ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink")
                }
              >
                <span className="block text-sm font-medium">
                  {lecture.id} · {lecture.title}
                </span>
                <span className={"block text-xs " + (on ? "text-paper" : "text-muted")}>
                  {lecture.blurb} · {known}/{lectureCards.length} known
                </span>
              </button>
            );
          })}
        </div>

        <h2 className="mt-5 text-lg text-ink">What the shuffle includes</h2>
        <div className="mt-3 grid gap-2" role="radiogroup" aria-label="Shuffle mode">
          {MODES.map((mode) => {
            const on = save.mode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onMode(mode.id)}
                className={
                  "min-h-12 rounded-xl border px-3 py-2 text-left " +
                  (on ? "border-chlorophyll bg-chlorophyll-soft" : "border-line bg-paper")
                }
              >
                <span className="block text-sm font-medium text-ink">{mode.label}</span>
                <span className="block text-xs text-muted">{mode.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="sheet rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg text-ink">Card index</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClearKnown}
              className="min-h-11 rounded-lg border border-line bg-paper px-3 text-sm text-ink"
            >
              {armed === "known" ? "Confirm release" : "Release known"}
            </button>
            <button
              type="button"
              onClick={onClearAll}
              className="min-h-11 rounded-lg border border-line bg-paper px-3 text-sm text-ink"
            >
              {armed === "all" ? "Confirm reset" : "Reset all marks"}
            </button>
          </div>
        </div>
        <label className="mt-3 block text-sm text-muted" htmlFor="card-search">
          Search the {counts.total} cards in this filter
        </label>
        <input
          id="card-search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Try NADH, stomata, tonicity…"
          className="mt-1 w-full min-h-12 rounded-xl border border-line bg-paper px-3 text-ink outline-none focus:border-chlorophyll"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["all", "All"],
              ["new", "New"],
              ["needs-work", "Needs work"],
              ["known", "Known"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={indexFilter === id}
              onClick={() => onIndexFilter(id)}
              className={
                "min-h-11 rounded-full border px-3 text-sm " +
                (indexFilter === id
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper text-ink")
              }
            >
              {label}
            </button>
          ))}
        </div>
        <ul className="mt-3 flex max-h-96 flex-col gap-2 overflow-auto">
          {indexCards.map((item) => {
            const tag = save.tags[item.id];
            return (
              <li
                key={item.id}
                className="flex items-start gap-3 rounded-xl border border-line bg-paper p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium tracking-wide text-brass uppercase">
                    Lec {item.lecture} · {item.topic}
                  </p>
                  <p className="text-sm text-ink">{item.prompt}</p>
                </div>
                <label className="sr-only" htmlFor={`tag-${item.id}`}>
                  Mark for {item.prompt}
                </label>
                <select
                  id={`tag-${item.id}`}
                  value={tag ?? "new"}
                  onChange={(event) => {
                    const value = event.target.value;
                    onTag(item.id, value === "new" ? null : (value as Tag));
                  }}
                  className="min-h-11 shrink-0 rounded-lg border border-line bg-card px-2 text-sm text-ink"
                >
                  <option value="new">New</option>
                  <option value="needs-work">Needs work</option>
                  <option value="known">Known</option>
                </select>
              </li>
            );
          })}
          {indexCards.length === 0 ? (
            <li className="text-sm text-muted">No cards match that search.</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="sheet rounded-xl px-3 py-3">
      <p className="font-display text-3xl text-ink tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function Study({
  card,
  cursor,
  total,
  picked,
  graded,
  correctPick,
  sessionCorrect,
  sessionAnswered,
  tag,
  headingRef,
  verdictRef,
  onChoose,
  onTag,
  onAdvance,
  onExit,
  onReshuffle,
}: {
  card: Card;
  cursor: number;
  total: number;
  picked: number | null;
  graded: boolean;
  correctPick: boolean;
  sessionCorrect: number;
  sessionAnswered: number;
  tag: Tag | undefined;
  headingRef: RefObject<HTMLHeadingElement | null>;
  verdictRef: RefObject<HTMLDivElement | null>;
  onChoose: (index: number) => void;
  onTag: (tag: Tag) => void;
  onAdvance: () => void;
  onExit: () => void;
  onReshuffle: () => void;
}) {
  const progress = Math.round(((cursor + (graded ? 1 : 0)) / total) * 100);
  const letters = ["A", "B", "C", "D"];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onExit}
          className="min-h-11 rounded-lg border border-line bg-card px-3 text-sm text-ink"
        >
          Deck
        </button>
        <p className="text-sm text-muted tabular-nums">
          Card {cursor + 1} of {total}
          {sessionAnswered > 0 ? ` · ${sessionCorrect}/${sessionAnswered} correct` : ""}
        </p>
        <button
          type="button"
          onClick={onReshuffle}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-line bg-card px-3 text-sm text-ink"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          New shuffle
        </button>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className="h-full bg-chlorophyll transition-all" style={{ width: `${progress}%` }} />
      </div>

      <article className="relative">
        <div className="absolute inset-x-3 -top-2 bottom-2 rounded-2xl border border-line bg-brass-soft" aria-hidden="true" />
        <div className="sheet relative rounded-2xl p-5 sm:p-7">
          <p className="text-xs font-medium tracking-widest text-brass uppercase">
            Lecture {card.lecture} · {card.topic}
          </p>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="mt-3 text-2xl text-ink outline-none sm:text-3xl"
          >
            {card.prompt}
          </h2>
          <div className="mt-5 grid gap-2">
            {card.choices.map((choice, index) => {
              const isAnswer = graded && index === card.answer;
              const isWrongPick = graded && index === picked && index !== card.answer;
              const quiet = graded && !isAnswer && !isWrongPick;
              return (
                <button
                  key={choice}
                  type="button"
                  onClick={() => onChoose(index)}
                  disabled={graded}
                  className={
                    "flex min-h-12 w-full items-start gap-3 rounded-xl border px-3 py-3 text-left disabled:opacity-100 " +
                    (!graded ? "border-line bg-paper hover:border-chlorophyll " : "") +
                    (isAnswer ? "border-chlorophyll bg-chlorophyll-soft " : "") +
                    (isWrongPick ? "border-rust bg-rust-soft " : "") +
                    (quiet ? "border-line bg-card opacity-60 " : "")
                  }
                >
                  <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-brass-soft text-sm font-medium text-ink">
                    {letters[index]}
                  </span>
                  <span className="flex-1 text-sm text-ink sm:text-base">{choice}</span>
                  {isAnswer ? <Check className="mt-0.5 size-5 shrink-0 text-chlorophyll" aria-hidden="true" /> : null}
                  {isWrongPick ? <X className="mt-0.5 size-5 shrink-0 text-rust" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>

          {graded ? (
            <div className="mt-5">
              <div
                ref={verdictRef}
                role="status"
                className={
                  "rounded-xl px-4 py-3 " +
                  (correctPick ? "bg-chlorophyll text-paper" : "bg-rust text-paper")
                }
              >
                <p className="font-display text-2xl">{correctPick ? "Correct" : "Incorrect"}</p>
                {!correctPick ? (
                  <p className="mt-1 text-sm">The answer is {card.choices[card.answer]}.</p>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-pretty text-ink">{card.why}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={tag === "known"}
                  onClick={() => onTag("known")}
                  className={
                    "min-h-12 rounded-xl border px-3 text-sm font-medium " +
                    (tag === "known"
                      ? "border-chlorophyll bg-chlorophyll text-paper"
                      : "border-line bg-paper text-ink")
                  }
                >
                  Known
                </button>
                <button
                  type="button"
                  aria-pressed={tag === "needs-work"}
                  onClick={() => onTag("needs-work")}
                  className={
                    "min-h-12 rounded-xl border px-3 text-sm font-medium " +
                    (tag === "needs-work"
                      ? "border-rust bg-rust text-paper"
                      : "border-line bg-paper text-ink")
                  }
                >
                  Needs work
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                Known cards stay out of the next shuffle. Needs-work cards stay in. Press again to clear a mark.
              </p>
              <button
                type="button"
                onClick={onAdvance}
                className="mt-3 min-h-12 w-full rounded-xl bg-ink px-4 font-medium text-paper"
              >
                {cursor + 1 >= total ? "Finish shuffle" : "Next card"}
              </button>
              <p className="mt-2 text-xs text-muted">Keys 1–4 answer · K known · W needs work · N next</p>
            </div>
          ) : (
            <p className="mt-4 text-xs text-muted">Pick one answer. Keys 1–4 work too.</p>
          )}
        </div>
      </article>
    </div>
  );
}

function Done({
  sessionCorrect,
  sessionAnswered,
  known,
  remaining,
  onAgain,
  onAll,
  onLobby,
}: {
  sessionCorrect: number;
  sessionAnswered: number;
  known: number;
  remaining: number;
  onAgain: () => void;
  onAll: () => void;
  onLobby: () => void;
}) {
  return (
    <div className="sheet mx-auto max-w-xl rounded-2xl p-6 sm:p-8">
      <p className="text-xs font-medium tracking-widest text-brass uppercase">Shuffle finished</p>
      <h1 className="mt-2 text-4xl text-ink">
        {sessionCorrect} of {sessionAnswered} correct
      </h1>
      <p className="mt-3 text-pretty text-muted">
        {known} {known === 1 ? "card is" : "cards are"} marked known and will be left out of the next shuffle.
        {remaining > 0
          ? ` ${remaining} still in play.`
          : " Nothing unmarked is left in this lecture filter."}
      </p>
      <div className="mt-6 grid gap-2">
        {remaining > 0 ? (
          <button
            type="button"
            onClick={onAgain}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-chlorophyll px-4 font-medium text-paper"
          >
            <Shuffle className="size-5" aria-hidden="true" />
            Shuffle what’s left
          </button>
        ) : (
          <button
            type="button"
            onClick={onAll}
            className="min-h-12 rounded-xl bg-chlorophyll px-4 font-medium text-paper"
          >
            Shuffle again, including known
          </button>
        )}
        <button
          type="button"
          onClick={onLobby}
          className="min-h-12 rounded-xl border border-line bg-paper px-4 font-medium text-ink"
        >
          Back to the deck
        </button>
      </div>
    </div>
  );
}
