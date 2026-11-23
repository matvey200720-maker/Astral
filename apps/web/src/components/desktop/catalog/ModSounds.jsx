import { createElement as h, Fragment, useEffect, useRef, useState } from "react";
import { Pause, Play } from "../../ui/icons.jsx";
import { formatTimecode } from "@modovik/publishing";
import Button from "../../ui/Button.jsx";
import { useSoundPlayer } from "../../../hooks/useSoundPlayer.js";
import { soundBurst } from "../../../features/catalog/sound-burst.js";
import { BARS, soundWave } from "./sound-wave.js";


// Теги разметки как функции «(свойства, ...дети) → элемент».
const [section, div, ol, ul, li, h2, span, small, svg, rect] = ["section", "div", "ol", "ul", "li", "h2", "span", "small", "svg", "rect"].map(
  (name) =>
    (props, ...kids) =>
      h(name, props, ...kids),
);

// Слова дорожек: строка таблицы — по порядку полей; последнее слово встаёт перед числом в «Все звуки · N».
const wordsOf = ([region, sound, play, stop, failed, seconds, every]) => ({
  region,
  sound,
  play,
  stop,
  failed,
  seconds,
  all: (count) => `${every} · ${count}`,
});

const WORDS = {
  ru: wordsOf(["Звуки мода", "Звук", "Послушать", "Остановить", "Звук не проигрался.", "с", "Все звуки"]),
  uk: wordsOf(["Звуки моду", "Звук", "Послухати", "Зупинити", "Звук не відтворився.", "с", "Усі звуки"]),
  en: wordsOf(["Mod sounds", "Sound", "Play", "Stop", "The sound did not play.", "s", "All sounds"]),
  de: wordsOf(["Mod-Sounds", "Sound", "Anhören", "Stoppen", "Der Sound konnte nicht abgespielt werden.", "s", "Alle Sounds"]),
  pl: wordsOf(["Dźwięki modu", "Dźwięk", "Posłuchaj", "Zatrzymaj", "Dźwięku nie udało się odtworzyć.", "s", "Wszystkie dźwięki"]),
  fr: wordsOf(["Sons du mod", "Son", "Écouter", "Arrêter", "Le son n'a pas pu être lu.", "s", "Tous les sons"]),
};

// Поиск по имени языка обычным обращением к объекту: незнакомое имя даёт английские слова.
export const soundCopy = (language) => WORDS[language] ?? WORDS.en;

// Десятичная запятая только у русского, остальные языки пишут точку.
const ONE_DIGIT = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
const COMMA = new Intl.NumberFormat("ru-RU", ONE_DIGIT);
const DOT = new Intl.NumberFormat("en-US", ONE_DIGIT);

export const soundLength = (seconds, language, copy) =>
  seconds >= 10 ? formatTimecode(seconds) : `${(language === "ru" ? COMMA : DOT).format(Math.max(1, Math.round(seconds * 10)) / 10)} ${copy.seconds}`;

const PROGRESS = "--mod-sound-progress";

// Доля проигранного, если у звука известна длина.
const played = (element) => (element && element.duration > 0 ? Math.min(1, element.currentTime / element.duration) : null);

// Ставит ноль на корень и, пока звук играет, двигает полосу каждый кадр; отдаёт остановку.
const followProgress = (root, playing, audio) => {
  if (!root) return undefined;
  const paint = (value) => root.style.setProperty(PROGRESS, String(value));
  paint(0);
  if (!playing) return undefined;
  const cursor = { frame: 0 };
  const next = () => {
    cursor.frame = requestAnimationFrame(() => {
      const share = played(audio());
      if (share !== null) paint(share);
      next();
    });
  };
  next();
  return () => cancelAnimationFrame(cursor.frame);
};

// Прогресс пишется прямо в стиль корня: React для кадров анимации не перерисовывается.
export const useProgress = (rootRef, playing, audio) => {
  useEffect(() => followProgress(rootRef.current, playing, audio), [rootRef, playing, audio]);
};

// Пока таблетки не влезают по ширине, у списка стоит data-overflow; наблюдатель отдаёт отключение.
const watchOverflow = (node) => {
  if (!(node && typeof ResizeObserver === "function")) return undefined;
  const mark = () => {
    node.toggleAttribute("data-overflow", node.scrollWidth > node.clientWidth);
  };
  const eye = new ResizeObserver(mark);
  eye.observe(node);
  mark();
  return eye.disconnect.bind(eye);
};

// Затухание у края ряда: работает только когда ряд включён и в окружении есть ResizeObserver.
const useRowFade = (listRef, active) => {
  useEffect(() => (active ? watchOverflow(listRef.current) : undefined), [listRef, active]);
};

// Разделитель в подписи: пробелы, тире трёх видов, пробелы.
const DASH = /\s+[—–-]\s+/;

// Волна: высота столбика — корень из пика (хлопок громче хвоста в десятки раз), но не ниже двух.
const bars = (peaks) =>
  Array.from({ length: BARS }, (_, at) => {
    const height = Math.max(2, Math.round(Math.sqrt(peaks?.[at] ?? 0) * 22));
    return rect({ key: at, x: at * 4, y: (24 - height) / 2, width: "2", height, rx: "1" });
  });

const FRAME = { viewBox: "0 0 254 24", preserveAspectRatio: "none" };

const Wave = ({ wave }) => {
  const column = bars(wave?.peaks);
  return span(
    { className: "mod-sound-wave", "data-empty": wave ? undefined : "", "aria-hidden": "true" },
    svg(FRAME, column),
    svg({ className: "mod-sound-wave-played", ...FRAME }, column),
  );
};

// Запрос волны; ответ после ухода игнорируется, отдаётся отмена.
const loadWave = (url, accept) => {
  const gate = new AbortController();
  soundWave(url).then((found) => gate.signal.aborted || accept(found));
  return () => gate.abort();
};

export const SoundTrack = (props) => {
  const { item, on, compact, language, copy, onToggle } = props;
  const [wave, setWave] = useState(null);
  useEffect(() => (compact ? undefined : loadWave(item.url, setWave)), [item.url, compact]);
  const label = item.title || item.name || copy.sound;
  const [gun, ...rest] = label.split(DASH);
  const seconds = Number(item.duration) || wave?.duration || 0;
  return h(
    Button,
    {
      variant: "ghost",
      size: compact ? "sm" : "md",
      className: compact ? "mod-sound is-compact" : "mod-sound",
      icon: h(on ? Pause : Play, { weight: "fill" }),
      caption: rest.join(" — ") || null,
      trailing: h(
        Fragment,
        null,
        compact ? null : h(Wave, { wave }),
        span({ className: "mod-sound-length" }, seconds ? soundLength(seconds, language, copy) : ""),
      ),
      ariaLabel: label,
      "aria-pressed": on,
      title: compact ? `${on ? copy.stop : copy.play}: ${label}` : undefined,
      onClick: onToggle,
    },
    gun,
  );
};

// Годные звуки мода: только записи с непустым адресом.
const soundsOf = (mod) => (Array.isArray(mod?.audio) ? mod.audio.filter((one) => typeof one?.url === "string" && one.url !== "") : []);

// Прокрутка к разделу-списку и фокус на него; нет узла — тихо ничего.
const SCROLL_TO = { behavior: "smooth", block: "start" };
const FOCUS_ON = { preventScroll: true };
const revealList = (listId) => {
  const target = document.getElementById(listId);
  target?.scrollIntoView(SCROLL_TO);
  target?.focus(FOCUS_ON);
};

const ModSounds = (props) => {
  const { mod, language = "ru", limit = Infinity, listId = "", id } = props;
  const { playing, play, audio } = useSoundPlayer(`mod-sounds:${mod?.id || mod?.name || ""}`);
  const [rootRef, rowRef] = [useRef(null), useRef(null)];
  useProgress(rootRef, playing, audio);
  const [failed, setFailed] = useState(false);
  const framed = Number.isFinite(limit);
  useRowFade(rowRef, framed && !id);

  const sounds = soundsOf(mod);
  if (sounds.length === 0) return null;

  const copy = soundCopy(language);
  const shown = framed ? sounds.slice(0, limit) : sounds;
  /* Звук с названным стволом («Карабинная винтовка — выстрел») играет очередью в темпе ствола (владелец, 16.11.2026); иначе — один выстрел. */
  const press = (one) => () => {
    setFailed(false);
    const burst = soundBurst({ title: one.title || one.name, weaponIds: mod?.domain?.sound?.weapons });
    play(one.url, one.url, { burst }).catch(() => setFailed(true));
  };
  const rows = shown.map((one) =>
    li({ key: one.url }, h(SoundTrack, { item: one, on: playing === one.url, compact: framed, language, copy, onToggle: press(one) })),
  );
  const origins = [...new Set(sounds.map((one) => one.caption).filter(Boolean))].join(" · ");
  const notes = h(Fragment, null, origins ? small({ title: origins }, origins) : null, failed ? small({ role: "alert" }, copy.failed) : null);

  if (id) {
    const head = h2({ id: `${id}-title` }, `${copy.region} · ${sounds.length}`);
    return section({ className: "mod-detail-sounds", id, tabIndex: -1, "aria-labelledby": `${id}-title` }, head, ol({ className: "mod-sounds", ref: rootRef }, rows), notes);
  }
  const all =
    shown.length < sounds.length && listId
      ? h(Button, { variant: "link", size: "sm", className: "redux-product-sounds-all", onClick: () => revealList(listId) }, copy.all(sounds.length))
      : null;
  const band = div({ className: "redux-product-sounds-row", ref: rootRef }, ul({ className: "mod-sounds is-compact", ref: rowRef }, rows), all);
  return section({ className: "redux-product-sounds", "aria-label": copy.region }, band, notes);
};

export default ModSounds;
