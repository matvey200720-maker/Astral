import {
  Fragment,
  createElement as h,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Crosshair,
  MagnifyingGlass,
  Playlist,
  SpeakerHigh,
  Stop,
  Waveform,
  X,
} from "../../../ui/icons.jsx";
import { TRACK_TAGS, eventCandidates, eventPin, similarity } from "@modovik/sound-studio";
import Button from "../../../ui/Button.jsx";
import Checkbox from "../../../ui/Checkbox.jsx";
import Select from "../../../ui/Select.jsx";
import VirtualList from "../../../ui/VirtualList.jsx";
import StreamRow from "./StreamRow.jsx";
import { trackTitle } from "./sound-targets.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { soundCounted, soundLower, soundTitle } from "./sound-copy.js";

export const STREAM_ROW_HEIGHT = 44;

const SHORT_BELOW_SECONDS = 0.5;
const CANDIDATE_PAGE = 20;
const WALK_SECONDS = 4;
const HASH_QUERY_MIN = 4;
const NO_STREAMS = [];
const NO_EVENTS = [];
const NO_BANKS = [];

// Подписи хранятся русскими ключами и переводятся при отрисовке.
const LENGTH_CHIPS = [
  ["all", "Все"],
  ["short", "Короткие"],
  ["long", "Длинные"],
  ["assigned", "Заменённые"],
];
const ORDER_CHOICES = [
  ["number", "По порядку"],
  ["length", "Сначала длинные"],
  ["pitch", "От низких к высоким"],
  ["loudness", "Сначала громкие"],
];
const NEEDS_PROFILE = new Set(["pitch", "loudness"]);

const hasFile = (assignment) => Boolean(assignment && assignment.assetHash);
const bankKeyOf = (b) => `${b.archive}:${b.bank}`;

/* ---------- фильтр, поиск, порядок: чистые функции ---------- */

const LENGTH_TESTS = {
  all: () => true,
  short: (stream) => stream.seconds < SHORT_BELOW_SECONDS,
  long: (stream) => stream.seconds >= SHORT_BELOW_SECONDS,
};

// Возвращает проверку (stream, file, features) -> boolean.
function filterTest(id) {
  if (typeof id === "string" && id.startsWith("tag:")) {
    const wanted = id.slice(4);
    return (stream, file, features) =>
      Boolean(features && features.tags && features.tags.includes(wanted));
  }
  if (id === "assigned") return (stream, file) => hasFile(file);
  return LENGTH_TESTS[id] || LENGTH_TESTS.all;
}

// null — запрос пуст, фильтровать нечего.
function searchTest(rawQuery, techOn) {
  const needle = rawQuery.trim().toLowerCase();
  if (!needle) return null;
  const hashAllowed = techOn || needle.length >= HASH_QUERY_MIN;
  const rules = [
    (stream, index) => String(index + 1) === needle,
    (stream, index, file, label) => label.toLowerCase() === needle,
    (stream, index, file, label) => soundLower(soundTitle(label)) === needle,
    (stream) => hashAllowed && String(stream.hash).toLowerCase().includes(needle),
    (stream, index, file) =>
      Boolean(file && file.assetName) && String(file.assetName).toLowerCase().includes(needle),
  ];
  return (stream, index, file) => {
    const label = trackTitle(index);
    return rules.some((rule) => rule(stream, index, file, label));
  };
}

// Что мерим при сортировке: чтение числа и направление (1 — по возрастанию).
function sortProbe(mode, reference, lookup) {
  if (mode === "length") return { read: (item) => item.stream.seconds, dir: -1 };
  if (mode === "pitch") {
    return { read: (item) => (lookup(item.stream) || {}).centroidHz, dir: 1 };
  }
  if (mode === "loudness") {
    return { read: (item) => (lookup(item.stream) || {}).rms, dir: -1 };
  }
  if (mode === "similar" && reference) {
    return { read: (item) => similarity(reference.features, lookup(item.stream)), dir: 1 };
  }
  return null;
}

function arrange(items, mode, eventOpen, reference, lookup) {
  const copy = items.slice();
  if (eventOpen && mode === "number") return copy;
  const probe = sortProbe(mode, reference, lookup);
  return copy.sort((a, b) => {
    if (probe) {
      const left = probe.read(a);
      const right = probe.read(b);
      const leftOk = Number.isFinite(left);
      const rightOk = Number.isFinite(right);
      if (leftOk !== rightOk) return leftOk ? -1 : 1;
      if (leftOk && left !== right) return probe.dir * (left - right);
    }
    return a.index - b.index;
  });
}

function countTags(streams, tracks) {
  if (!tracks) return {};
  return streams.reduce((acc, stream) => {
    const found = tracks[stream.hash];
    const tags = (found && found.tags) || [];
    tags.forEach((id) => {
      acc[id] = (acc[id] || 0) + 1;
    });
    return acc;
  }, {});
}

/* ---------- обход «Слушать подряд» ---------- */

function useWalker(live, listApi) {
  const [active, setActive] = useState(false);
  const run = useRef(null);
  const [api] = useState(() => {
    const halt = () => {
      run.current = null;
      setActive(false);
    };
    const advance = async (mine) => {
      while (run.current === mine) {
        if (mine.at >= mine.queue.length) {
          halt();
          const { onStop } = live.current;
          onStop();
          return;
        }
        const slot = mine.at;
        mine.at += 1;
        const track = mine.queue[slot];
        const { onSelectStream, playOriginal } = live.current;
        onSelectStream(track.hash);
        listApi.current?.scrollToIndex(slot);
        const started = await playOriginal(track, {
          maxSeconds: WALK_SECONDS,
          restart: true,
          onEnded: (info) => {
            if (run.current !== mine) return;
            if (info && info.interrupted) halt();
            else advance(mine);
          },
        });
        if (run.current !== mine || started) return;
      }
    };
    const begin = (queue, at) => {
      const mine = { queue, at };
      run.current = mine;
      setActive(true);
      advance(mine);
    };
    return { halt, begin };
  });
  useEffect(
    () => () => {
      run.current = null;
    },
    [],
  );
  return { active, halt: api.halt, begin: api.begin };
}

// Один неизменный набор действий для всех строк; читает свежие свойства через live.
function makeRowActions(live, haltWalk) {
  return {
    play(hash) {
      const { bank, onSelectStream, playOriginal } = live.current;
      const found = (bank.streams || NO_STREAMS).find((s) => s.hash === hash);
      if (!found) return;
      haltWalk();
      onSelectStream(hash);
      playOriginal(found);
    },
    select(hash) {
      const { onSelectStream } = live.current;
      onSelectStream(hash);
    },
    pick(hash) {
      const { onPick } = live.current;
      onPick(hash);
    },
    reset(hash) {
      const { onReset } = live.current;
      onReset(hash);
    },
    pin(hash) {
      const { openId, onPinEvent } = live.current;
      if (openId) onPinEvent(openId, hash);
    },
  };
}

/* ---------- кусочки разметки ---------- */

function filterChip(id, label, current, choose) {
  const on = current === id;
  return h(
    "button",
    {
      key: id,
      type: "button",
      className: `snd-chip ${on ? "is-active" : ""}`,
      "aria-pressed": on,
      onClick: () => choose(id),
    },
    tr(label),
  );
}

function tagChip(tag, count, current, choose) {
  const id = `tag:${tag.id}`;
  const on = current === id;
  return h(
    "button",
    {
      key: id,
      type: "button",
      className: `snd-chip snd-chip-tag ${on ? "is-active" : ""}`,
      "aria-pressed": on,
      title: tr(tag.hint),
      onClick: () => choose(id),
    },
    tr(tag.title),
    h("em", null, count),
  );
}

function eventCard(item, open, note, toggle) {
  return h(
    "button",
    {
      key: item.id,
      type: "button",
      className: `snd-event-card${open ? " is-active" : ""}`,
      "aria-pressed": open,
      title: tr(item.hint),
      onClick: () => toggle(item),
    },
    h(Crosshair),
    h("b", null, tr(item.title)),
    h("small", null, note),
  );
}

function chipAction(label, onClick) {
  return h("button", { type: "button", className: "snd-chip", onClick }, tr(label));
}

function profileNotice(profile, retry) {
  if (profile === null) {
    return h("small", { className: "snd-profile-state" }, tr("Разбираем звуки банка…"));
  }
  if (!profile || !profile.error) return null;
  return h(
    "span",
    { className: "snd-retry" },
    h("small", { className: "snd-profile-state" }, tr("Разобрать звуки не удалось.")),
    h(Button, { variant: "link", size: "sm", onClick: retry }, tr("Повторить")),
  );
}

function referenceBadge(reference, clear) {
  if (!reference) return null;
  return h(
    "span",
    { className: "snd-ref" },
    tr("Похожие на:"),
    " ",
    h("b", null, reference.title),
    h(Button, {
      variant: "ghost",
      size: "sm",
      icon: h(X),
      "aria-label": tr("Убрать образец"),
      title: tr("Вернуть обычный порядок"),
      onClick: clear,
    }),
  );
}

/* ---------- компонент ---------- */

export default function SoundTrackBrowser({
  bank,
  bankTitle,
  banks,
  project,
  events,
  showEvents,
  assignments,
  profile,
  onRetryProfile,
  selectedStream,
  onSelectStream,
  playing,
  playOriginal,
  onStop,
  onPick,
  onReset,
  onOpenBank,
  onPinEvent,
  reference,
  onClearReference,
  sortMode,
  onSortMode,
  onPickReference,
  showTech,
  onShowTech,
  dropKey,
}) {
  useTr();
  const lang = tr("ru");
  const streams = bank.streams || NO_STREAMS;
  const eventList = events || NO_EVENTS;
  const tracks = profile && profile.tracks ? profile.tracks : null;
  const ready = Boolean(tracks);
  const bankKey = bankKeyOf(bank);

  const [query, setQuery] = useState("");
  const [filterId, setFilterId] = useState("all");
  const [eventId, setEventId] = useState(null);
  const [limit, setLimit] = useState(CANDIDATE_PAGE);
  const [seenKey, setSeenKey] = useState(bankKey);
  const needle = useDeferredValue(query);

  // Смена банка: поиск и фильтр сбрасываются, событие и страница кандидатов остаются.
  if (seenKey !== bankKey) {
    setSeenKey(bankKey);
    setQuery("");
    setFilterId("all");
  }

  const listApi = useRef(null);
  const live = useRef(null);
  const walker = useWalker(live, listApi);
  const { halt: haltWalk } = walker;
  const [rowActions] = useState(() => makeRowActions(live, haltWalk));

  useEffect(() => {
    haltWalk();
  }, [bankKey, haltWalk]);

  const featuresOf = (stream) => (tracks && tracks[stream.hash]) || null;

  /* ----- события ----- */
  const pinById = useMemo(
    () => new Map(eventList.map((item) => [item.id, eventPin(project, item.id)])),
    [eventList, project],
  );
  const openEvent = showEvents ? eventList.find((item) => item.id === eventId) || null : null;
  const openPin = openEvent ? pinById.get(openEvent.id) : null;
  const pinHash =
    openPin && openPin.archive === bank.archive && openPin.bank === bank.bank
      ? openPin.stream
      : null;

  const candidates = useMemo(
    () => (openEvent ? eventCandidates(openEvent, streams, profile) : null),
    [openEvent, streams, profile],
  );

  const slots = useMemo(() => new Map(streams.map((stream, i) => [stream, i])), [streams]);

  const base = useMemo(() => {
    let source = streams;
    if (candidates) {
      source = candidates.slice(0, limit);
      const marked = pinHash ? streams.find((s) => s.hash === pinHash) : null;
      if (marked && !source.includes(marked)) source = [marked, ...source];
    }
    return source.map((stream) => ({ stream, index: slots.get(stream) }));
  }, [candidates, limit, pinHash, streams, slots]);

  /* ----- числа для шапки ----- */
  const replaced = useMemo(
    () => streams.filter((stream) => hasFile(assignments.get(stream.hash))).length,
    [streams, assignments],
  );
  const tagCounts = useMemo(() => countTags(streams, tracks), [streams, tracks]);
  const tagChips = TRACK_TAGS.filter((tag) => tag.id !== "long" && tagCounts[tag.id] > 0);

  /* ----- видимый и упорядоченный списки ----- */
  const visible = useMemo(() => {
    const passFilter = filterTest(filterId);
    const passQuery = searchTest(needle, showTech);
    return base.filter(({ stream, index }) => {
      const file = assignments.get(stream.hash) || null;
      const found = (tracks && tracks[stream.hash]) || null;
      if (!passFilter(stream, file, found)) return false;
      return passQuery ? passQuery(stream, index, file) : true;
    });
    // lang: локальное название дорожки зависит от языка окна
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, filterId, needle, showTech, assignments, tracks, lang]);

  const ordered = useMemo(
    () =>
      arrange(visible, sortMode, Boolean(openEvent), reference, (stream) =>
        tracks ? tracks[stream.hash] || null : null,
      ),
    [visible, sortMode, openEvent, reference, tracks],
  );

  useEffect(() => {
    live.current = {
      bank,
      openId: openEvent ? openEvent.id : null,
      onSelectStream,
      playOriginal,
      onStop,
      onPick,
      onReset,
      onPinEvent,
    };
  });

  /* ----- обработчики ----- */
  const toggleWalk = () => {
    if (walker.active) {
      haltWalk();
      onStop();
      return;
    }
    const queue = ordered.map((item) => item.stream);
    const from = Math.max(
      0,
      queue.findIndex((stream) => stream.hash === selectedStream),
    );
    walker.begin(queue, from);
  };

  const toggleEvent = (item) => {
    if (item.id === eventId) {
      setEventId(null);
      setFilterId("all");
      return;
    }
    onStop();
    haltWalk();
    setEventId(item.id);
    setLimit(CANDIDATE_PAGE);
    setQuery("");
    setFilterId("all");
    onClearReference();
    const pin = pinById.get(item.id);
    const bankList = banks || NO_BANKS;
    const sameAs = (ref) => (b) => b.archive === ref.archive && b.bank === ref.bank;
    const wanted = pin ? bankList.find(sameAs(pin)) : null;
    const target =
      wanted ||
      bankList.find((b) => (item.banks || []).some((ref) => sameAs(ref)(b)));
    if (target && bankKeyOf(target) !== bankKey) onOpenBank(target);
    onSelectStream(pin ? pin.stream : null);
  };

  const closeEvent = () => {
    setEventId(null);
    setFilterId("all");
  };

  const moveSelection = (event, step) => {
    event.preventDefault();
    const at = ordered.findIndex((item) => item.stream.hash === selectedStream);
    const next = at < 0 ? 0 : Math.min(ordered.length - 1, Math.max(0, at + step));
    onSelectStream(ordered[next].stream.hash);
    listApi.current?.scrollToIndex(next);
  };

  const onListKey = (event) => {
    if (!ordered.length) return;
    const { key } = event;
    if (key === "ArrowDown") moveSelection(event, 1);
    else if (key === "ArrowUp") moveSelection(event, -1);
    else if (key === " ") {
      if (!ordered.some((item) => item.stream.hash === selectedStream)) return;
      event.preventDefault();
      rowActions.play(selectedStream);
    } else if (key === "Escape") {
      haltWalk();
      onStop();
    }
  };

  const renderRow = ({ stream, index }) =>
    h(StreamRow, {
      key: stream.hash,
      stream,
      index,
      assignment: assignments.get(stream.hash) || null,
      features: featuresOf(stream),
      playing: playing === `orig|${stream.hash}`,
      selected: selectedStream === stream.hash,
      showTech,
      eventTitle: openEvent ? openEvent.title : "",
      pinned: pinHash !== null && stream.hash === pinHash,
      dropTarget: dropKey === `stream:${stream.hash}`,
      actions: rowActions,
    });

  /* ----- сборка ----- */
  const eventNote = (item) => {
    const pin = pinById.get(item.id);
    if (!pin) return tr("дорожка не выбрана");
    const here = pin.archive === bank.archive && pin.bank === bank.bank;
    const file = here ? assignments.get(pin.stream) : null;
    return file
      ? tr("ваш звук: {name}").replace("{name}", file.assetName)
      : tr("дорожка отмечена");
  };

  const eventsBlock =
    showEvents && eventList.length > 0
      ? h(
          "div",
          { className: "snd-events", "aria-label": tr("Звуковые события") },
          h(
            "div",
            { className: "snd-events-head" },
            h("b", null, tr("Звуковые события")),
            h(
              "small",
              null,
              tr("Откройте событие, послушайте кандидатов и отметьте свою дорожку."),
            ),
          ),
          h(
            "div",
            { className: "snd-event-row" },
            eventList.map((item) =>
              eventCard(item, openEvent === item, eventNote(item), toggleEvent),
            ),
          ),
          openEvent &&
            h(
              "div",
              { className: "snd-event-open" },
              h(
                "p",
                { className: "snd-hint snd-event-hint" },
                tr(openEvent.hint),
                " ",
                tr(
                  "Первыми — дорожки, ближе всего к нему по звуку: ▶ слушает, «Это оно» отмечает.",
                ),
              ),
              h(
                "div",
                { className: "snd-event-open-actions" },
                h(
                  "small",
                  { className: "snd-hint" },
                  tr("Показано {shown} из {total}")
                    .replace("{shown}", ordered.length)
                    .replace("{total}", candidates.length),
                ),
                candidates.length > ordered.length &&
                  chipAction("Показать ещё", () => setLimit((n) => n + CANDIDATE_PAGE)),
                chipAction("Весь банк", closeEvent),
              ),
            ),
        )
      : null;

  const replacedText = replaced > 0 ? tr(" · заменено {count}").replace("{count}", replaced) : null;

  const orderOptions = ORDER_CHOICES.map(([value, label]) => ({
    value,
    label: tr(label),
    disabled: NEEDS_PROFILE.has(value) && !ready,
  }));
  if (reference) orderOptions.push({ value: "similar", label: tr("По похожести") });

  const walking = walker.active;
  const header = h(
    "header",
    { className: "snd-streams-head" },
    h(
      "div",
      { className: "snd-streams-title" },
      h("b", null, bankTitle),
      h("small", null, soundCounted(streams.length, "track"), replacedText),
    ),
    h(
      "div",
      { className: "snd-filters", role: "group", "aria-label": tr("Фильтр") },
      LENGTH_CHIPS.map(([id, label]) => filterChip(id, label, filterId, setFilterId)),
      tagChips.map((tag) => tagChip(tag, tagCounts[tag.id], filterId, setFilterId)),
      h(
        "label",
        { className: "snd-search snd-search-tracks" },
        h(MagnifyingGlass),
        h("input", {
          placeholder: tr("Номер или файл"),
          "aria-label": tr("Найти дорожку"),
          type: "search",
          value: query,
          onChange: (event) => setQuery(event.target.value),
        }),
      ),
    ),
    h(
      "div",
      { className: "snd-tools" },
      h(
        Button,
        {
          size: "sm",
          variant: walking ? "primary" : "secondary",
          icon: walking ? h(Stop) : h(Playlist),
          title: walking
            ? tr("Остановить (Esc)")
            : tr("Дорожки играют одна за другой, по {seconds} с каждая").replace(
                "{seconds}",
                WALK_SECONDS,
              ),
          disabled: ordered.length === 0,
          onClick: toggleWalk,
        },
        walking ? tr("Стоп") : tr("Слушать подряд"),
      ),
      h(
        Button,
        {
          size: "sm",
          variant: "secondary",
          icon: h(Waveform),
          title: tr("Выбрать свой звук — дорожки выстроятся по похожести на него"),
          disabled: !ready,
          onClick: onPickReference,
        },
        tr("Похожие на мой файл"),
      ),
      h(Select, {
        className: "snd-sort",
        label: tr("Порядок"),
        ariaLabel: tr("Сортировка"),
        value: sortMode,
        options: orderOptions,
        onChange: onSortMode,
      }),
      referenceBadge(reference, onClearReference),
      profileNotice(profile, onRetryProfile),
      h(Checkbox, {
        className: "snd-tech-toggle",
        label: tr("Технические детали"),
        checked: showTech,
        onChange: onShowTech,
      }),
    ),
  );

  const emptyBank = streams.length === 0;
  return h(
    Fragment,
    null,
    eventsBlock,
    header,
    emptyBank &&
      h(
        "div",
        { className: "snd-guide" },
        h(SpeakerHigh),
        h("p", null, tr("В этом банке нет дорожек для замены.")),
      ),
    !emptyBank &&
      ordered.length === 0 &&
      h("small", { className: "snd-hint snd-empty" }, tr("Под фильтр ничего не попало")),
    h(VirtualList, {
      className: "snd-stream-list",
      tabIndex: 0,
      items: ordered,
      rowHeight: STREAM_ROW_HEIGHT,
      apiRef: listApi,
      renderRow,
      "data-frost": "off",
      role: "group",
      "aria-label": tr("Дорожки банка"),
      onKeyDown: onListKey,
    }),
  );
}
