import { useCallback, useEffect, useRef, useState } from "react";
import { Play } from "./icons.jsx";
import { tr, useTr } from "../../locales/ui.js";
import ClipControls from "./ClipControls.jsx";
import { CONTROLS_IDLE_MS } from "./clip-time.js";
import "./clip-player.css";

/*
 * Проигрыватель ролика на странице мода (ТЗ владельца 28.10.2026: «ползунок с цифрами выглядит колхозно… аккуратненький посередине проигрыватель,
 * где он нажимает, и у него включается видео»).
 *
 * Штатных органов браузера нет совсем — ни полосы перемотки, ни «0:00 / 0:01», ни звука, ни «во весь экран», ни «⋮» (`controls` не ставится никогда).
 * Вместо них — кадр-постер и наша кнопка ▶ по центру: нажали — играет, нажали на кадр — пауза и снова кнопка, дошёл до конца (без петли) — кнопка
 * «ещё раз». Ролики мини-карт и суток таймцикла без звука; ролик со звуком (пак звуков) звучит, когда человек нажал — отдельного движка громкости нет, как у
 * любого окна, звук идёт в системный микшер.
 *
 * Ролик не грузится, пока не нажали: `preload="none"` и пока нет адреса — в `src` пусто. Небольшой ролик (мини-карта, сутки таймцикла) берётся один раз
 * в память страницы и отдаётся плееру адресом `blob:` — в дереве страницы нет ссылки на файл, а повторное «играть» не ходит в сеть. Большой (пак звуков до
 * 256 МиБ) в память не кладётся и идёт потоком по своему адресу: целиком закрыть его нельзя.
 *
 * Скачать «просто так» нельзя: `controlsList="nodownload noremoteplayback noplaybackrate nofullscreen"`, без картинки в картинке и трансляции, контекстного меню
 * и перетаскивания на ролике нет. Но клиент сам разворачивает и показывает файл, так что целиком запретить сохранение у клиента нельзя — это обычные
 * пути, а не защита (`CLAUDE.md`: не обещать невозможного).
 *
 * «Как в YouTube» (ТЗ владельца 29.10.2026, п. 2): когда ролик пошёл, под кадром появляются НАШИ органы (`ClipControls.jsx`) — тонкая полоса прогресса, ▶/❚❚ и время,
 * звук (у ролика со звуком), «во весь экран» (`requestFullscreen` у самого проигрывателя, не штатная кнопка). Пока ролик играет и мышь стоит, они прячутся через
 * `CONTROLS_IDLE_MS` (~2 с), полоса остаётся тонкой чертой; движение мыши и любая клавиша возвращают. Пауза, конец и сбой держат их на месте. Клавиши с фокусом в
 * проигрывателе: пробел и K — пауза, F — во весь экран, M — звук. Громкость помнится между роликами окна.
 */

/* Громкость окна: выбрал на одном ролике — на следующем та же. Только в памяти окна, на диск не пишется. */
const memory = { volume: 1, muted: false };

/** Память громкости окна — для тестов: сбросить перед каждым. */
export const clipMemory = memory;

/* Больше этого ролик идёт потоком, а не лежит в памяти страницы. */
export const CLIP_BLOB_LIMIT = 32 * 1024 * 1024;

/** Брать ли ролик в память страницы целиком: размер известен и невелик, а неизвестный — только у петли и суток (у них файлы по несколько МБ). */
export function clipFitsMemory({ bytes, loop = false, silent = false } = {}) {
  const size = Number(bytes);
  if (Number.isFinite(size) && size > 0) return size <= CLIP_BLOB_LIMIT;
  return Boolean(loop || silent);
}

const noMenu = (event) => event.preventDefault();

/* `play()` отклоняется (нет жеста, ролик не готов) или его нет вовсе (тестовое окружение): кнопка остаётся, ошибки наружу не идут. */
const tryPlay = (element) => {
  try {
    Promise.resolve(element?.play?.()).catch(() => {});
  } catch {
    /* нет воспроизведения — кнопка остаётся */
  }
};

export default function ClipPlayer({
  src,
  poster = "",
  label = "",
  className = "",
  loop = false,
  silent = true,
  bytes = 0,
  /* Просмотрщик на весь экран: человек уже нажал на кадр, чтобы его открыть, — ролик стартует сам, как только готов. */
  autoStart = false,
  onError = null,
}) {
  useTr();
  const root = useRef(null);
  const video = useRef(null);
  /* Человек просил играть: адрес, что придёт позже (blob), запускается сам. */
  const wantPlay = useRef(false);
  /* Адрес держим и в ссылке: замыкания старта не должны видеть адрес прошлой попытки. */
  const urlRef = useRef("");
  const retried = useRef(false);
  const [url, setUrlState] = useState("");
  /* `idle` — ещё не просили; `loading` — просили, кадров ещё нет; `ready` — идёт или на паузе; `failed` — файл не пришёл. */
  const [phase, setPhase] = useState("idle");
  const [playing, setPlaying] = useState(false);
  /* «Повторить» пересоздаёт `<video>`: сбой браузер запоминает на элементе. */
  const [attempt, setAttempt] = useState(0);
  /* Органы (ТЗ 29.10.2026): время и длина ролика, громкость, во весь экран, «разбужены ли» органы мышью или клавишей. */
  const [clock, setClock] = useState({ time: 0, duration: NaN });
  const [volume, setVolumeState] = useState(memory.volume);
  const [muted, setMutedState] = useState(memory.muted);
  const [fullscreen, setFullscreen] = useState(false);
  const [awake, setAwake] = useState(true);
  const idle = useRef(0);
  /* Мышь над органами или тянут полосу: пока так, органы не прячутся. */
  const held = useRef(false);
  const setUrl = useCallback((value) => {
    urlRef.current = value;
    setUrlState(value);
  }, []);

  /* Органы уходят, когда ролик играет, а мышь стоит `CONTROLS_IDLE_MS`. */
  const settle = useCallback((delay = CONTROLS_IDLE_MS) => {
    clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      if (!held.current) setAwake(false);
    }, delay);
  }, []);
  const wake = useCallback(() => {
    setAwake(true);
    settle();
  }, [settle]);
  const hold = useCallback(
    (value) => {
      held.current = value;
      if (value) {
        clearTimeout(idle.current);
        setAwake(true);
      } else settle();
    },
    [settle],
  );
  useEffect(() => () => clearTimeout(idle.current), []);

  /* Адрес, который мы сами положили в `src` (`blob:`), снимается вместе с роликом: память не копится при листании кадров. */
  useEffect(() => {
    if (!url.startsWith("blob:")) return undefined;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  /* Звук: у беззвучного ролика всегда выключен; у ролика со звуком — как выбрал человек. */
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.muted = silent || muted;
    element.volume = volume;
  }, [silent, muted, volume, attempt]);

  /* «Во весь экран» — полноэкранным становится сам проигрыватель; выход (в том числе Esc) возвращает значок. */
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === root.current && Boolean(root.current));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  /* Пошёл — органы показаны и скоро уйдут; встал — остаются. */
  useEffect(() => {
    if (playing) wake();
    else {
      clearTimeout(idle.current);
      setAwake(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `wake` стабилен
  }, [playing]);

  /* Адрес появился, а играть просили — играем. */
  useEffect(() => {
    if (url && wantPlay.current) tryPlay(video.current);
  }, [url, attempt]);

  const start = useCallback(async () => {
    wantPlay.current = true;
    if (urlRef.current) {
      tryPlay(video.current);
      return;
    }
    setPhase("loading");
    if (!clipFitsMemory({ bytes, loop, silent })) {
      setUrl(src);
      return;
    }
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`clip ${response.status}`);
      const blob = await response.blob();
      if (wantPlay.current) setUrl(URL.createObjectURL(blob));
    } catch {
      /* Не сошлось с памятью (сеть, нет места) — пробуем потоком: сбой покажет сам `<video>`. */
      if (wantPlay.current) setUrl(src);
    }
  }, [src, bytes, loop, silent, setUrl]);

  /* Другой ролик в том же месте или новая попытка — всё с начала; просмотрщик и «Повторить» запускают ролик сразу. */
  useEffect(() => {
    wantPlay.current = false;
    urlRef.current = "";
    setUrlState("");
    setPhase("idle");
    setPlaying(false);
    setClock({ time: 0, duration: NaN });
    if (autoStart || retried.current) {
      retried.current = false;
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `start` зависит от тех же полей, что и ролик
  }, [src, attempt, autoStart]);

  const toggle = () => {
    if (phase === "failed") return;
    if (playing) {
      wantPlay.current = false;
      video.current?.pause?.();
    } else start();
  };

  const retry = () => {
    retried.current = true;
    setAttempt((value) => value + 1);
  };

  const seek = (seconds) => {
    const element = video.current;
    if (!element) return;
    element.currentTime = seconds;
    setClock((current) => ({ ...current, time: seconds }));
  };
  const setVolume = (value) => {
    memory.volume = value;
    memory.muted = value === 0;
    setVolumeState(value);
    setMutedState(value === 0);
  };
  const toggleMute = () => {
    if (muted || volume === 0) {
      const back = volume === 0 ? 0.6 : volume;
      memory.volume = back;
      memory.muted = false;
      setVolumeState(back);
      setMutedState(false);
    } else {
      memory.muted = true;
      setMutedState(true);
    }
  };
  const toggleFullscreen = () => {
    const element = root.current;
    if (!element) return;
    const done = document.fullscreenElement ? document.exitFullscreen?.() : element.requestFullscreen?.();
    Promise.resolve(done).catch(() => {});
  };
  /* Клавиши, пока фокус в проигрывателе: пробел (кнопка кадра нажимается сама) и K — пауза, F — во весь экран, M — звук. На ползунках букв не слушаем. */
  const onKeyDown = (event) => {
    wake();
    if (event.ctrlKey || event.altKey || event.metaKey || event.target.closest?.("input")) return;
    const key = event.key.toLowerCase();
    if (key === "f") toggleFullscreen();
    else if (key === "m" && !silent) toggleMute();
    else if (key === "k" && phase !== "failed") toggle();
    else return;
    event.preventDefault();
  };
  const readClock = (event) => setClock({ time: event.currentTarget.currentTime, duration: event.currentTarget.duration });

  /* Органы — после первого кадра; ролик на паузе или закончился — они на месте, играет — по мыши. */
  const live = phase === "ready";
  const shown = live && (!playing || awake);
  const caption = label || tr("Ролик");
  return (
    <div
      ref={root}
      className={className ? `ui-clip-player ${className}` : "ui-clip-player"}
      data-clip-phase={phase}
      data-clip-playing={playing ? "" : undefined}
      data-clip-quiet={live && playing && !awake ? "" : undefined}
      onContextMenu={noMenu}
      tabIndex={-1}
      onPointerMove={wake}
      onPointerDown={(event) => {
        wake();
        /* Нажали на кадр — фокус в проигрывателе, и клавиши (пробел, K, F, M) работают, как у YouTube. */
        if (!event.target.closest?.("button, input, [role=slider]")) root.current?.focus({ preventScroll: true });
      }}
      onPointerLeave={() => !held.current && settle(400)}
      onKeyDown={onKeyDown}
    >
      <video
        key={attempt}
        ref={video}
        className="ui-clip-player-video"
        src={url || undefined}
        poster={poster || undefined}
        loop={loop || undefined}
        playsInline
        preload="none"
        controlsList="nodownload noremoteplayback noplaybackrate nofullscreen"
        disablePictureInPicture
        disableRemotePlayback
        draggable={false}
        tabIndex={-1}
        aria-label={caption}
        onContextMenu={noMenu}
        onPlay={() => {
          setPlaying(true);
          setPhase((value) => (value === "ready" ? value : "loading"));
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          wantPlay.current = false;
        }}
        onTimeUpdate={readClock}
        onLoadedMetadata={readClock}
        onDurationChange={readClock}
        onWaiting={() => setPhase("loading")}
        onCanPlay={() => setPhase("ready")}
        onPlaying={() => setPhase("ready")}
        onError={() => {
          setPhase("failed");
          setPlaying(false);
          onError?.();
        }}
      />
      {phase !== "failed" && (
        /* Когда есть свои органы, кадр-кнопка остаётся для мыши (щелчок — пауза), а читалке и Tab отдана строка органов: два «Пауза» подряд не нужны. */
        <button
          type="button"
          className="ui-clip-player-surface"
          aria-label={live ? undefined : playing ? tr("Пауза") : `${tr("Смотреть")}: ${caption}`}
          aria-hidden={live ? "true" : undefined}
          tabIndex={live ? -1 : undefined}
          onMouseDown={live ? (event) => event.preventDefault() : undefined}
          onClick={toggle}
        >
          {!playing && phase !== "loading" && (
            <span className="ui-clip-player-play" aria-hidden="true">
              <Play weight="fill" />
            </span>
          )}
        </button>
      )}
      {live && (
        <ClipControls
          shown={shown}
          playing={playing}
          time={clock.time}
          duration={clock.duration}
          silent={silent}
          volume={volume}
          muted={muted}
          fullscreen={fullscreen}
          onToggle={toggle}
          onSeek={seek}
          onVolume={setVolume}
          onMute={toggleMute}
          onFullscreen={toggleFullscreen}
          onHold={hold}
        />
      )}
      {phase === "loading" && (
        <span className="ui-clip-player-state" role="status">
          {tr("Загружается…")}
        </span>
      )}
      {phase === "failed" && (
        <span className="ui-clip-player-state is-failed" role="alert">
          <span>{tr("Ролик не загрузился")}</span>
          <button type="button" className="ui-clip-player-retry" onClick={retry}>
            <Play weight="fill" aria-hidden="true" />
            {tr("Повторить")}
          </button>
        </span>
      )}
    </div>
  );
}
