import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { plateChanged, plateGone, plateSettled } from "./screen-ready.js";

/*
 * Скелет — серое место того, что сейчас приедет (ТЗ 23.10.2026, п. A).
 *
 * Раньше у каждого экрана была своя заготовка: плитка каталога «дышала»
 * прозрачностью, плашки редактора — другим темпом, полка мастерской не имела
 * ничего: на месте обложек стояла чёрная плита, и фото возникали по одному,
 * рывками, как только доезжали. Теперь одна плита на всех: серое место точно
 * там и такого размера, где появится плитка, значок или строка, а по нему
 * слева направо проходит светлая полоса (`.ui-skeleton`, `ui.css`). Не
 * кружок и не «Загрузка…»: человек видит, что будет на месте, и что экран жив.
 *
 * ТРИ ВИДА
 *   `<Skeleton />`       — плита: размер и форму задаёт тот, кто её ставит
 *                          (классом места или `style`; `as` — другой тег, если
 *                          раскладка места ищет его по тегу);
 *   `<Skeleton line />`  — строка подписи;
 *   `<PhotoSkeleton />`  — плита во весь кадр под фото. Ставится ПЕРЕД
 *                          `<img data-photo>` (его предыдущий сосед) или с
 *                          `url` фона-картинки. Растворяется, когда фото
 *                          доехало.
 *
 * БЕЗ СОСТОЯНИЯ. Плита под фото не держит ни `useState`, ни постоянного таймера (повтор и предел ожидания фона — одноразовые таймеры эффекта `url`, пока картинка не доехала): замер 23.10
 * (закрытая сборка, ×4) показал, что по одной смене состояния на каждую из
 * сорока плиток полки — это двадцать семь лишних коммитов React и
 * +70 % «Вход занят». Поэтому «доехало» пишется прямо в DOM: общий слушатель
 * `load` / `error` (ниже) ставит плите соседнего `<img data-photo>` атрибут
 * `data-loaded`, а растворение — чистый CSS (`ui.css`, `.ui-skeleton[data-loaded]`).
 * Картинку, что была готова ещё до первого кадра (кэш), плита видит сама, до
 * отрисовки. `held` — «картинка доехала, но показывать её рано» (рендер ещё
 * меряется, `useRenderFill`): плита остаётся, пока `held`; это свойство
 * приходит от родителя, у которого перерисовка и так есть, — лишнего коммита нет.
 *
 * Идёт на композиторе и конечное число проходов — правило 21 `docs/3D.md`.
 * Плиты в сетке идут волной: `delay={skeletonDelay(index)}`.
 *
 * ЭКРАН ЦЕЛИКОМ (ТЗ 24.10.2026). Плита под фото помечена `data-photo-plate` и сообщает сетке, в которой стоит, что она
 * ещё держит экран, а когда фото доехало — что отпущена (`screen-ready.js`). Пока в сетке плиты первого экрана не
 * отпущены все (или не вышел потолок), ни одна не растворяется: сетка встаёт целиком, а не по одной. Счёт и таймер потолка
 * — в `screen-ready.js`; здесь по-прежнему ни состояния, ни таймера.
 */

/** Задержка плиты в сетке: волной слева направо, а не одним миганием. */
export function skeletonDelay(index, step = 90, cycle = 8) {
  return (Math.max(0, index) % cycle) * step;
}

const classes = (...values) => values.filter(Boolean).join(" ");

export const Skeleton = memo(function Skeleton({
  as: Tag = "span",
  line = false,
  fill = false,
  delay = 0,
  className = "",
  style,
  plateRef,
  ...rest
}) {
  const wave = delay > 0 ? { "--ui-skeleton-delay": `${delay}ms` } : null;
  return (
    <Tag
      ref={plateRef}
      className={classes("ui-skeleton", line && "is-line", fill && "is-fill", className)}
      style={wave || style ? { ...wave, ...style } : undefined}
      aria-hidden="true"
      {...rest}
    />
  );
});

/* Адреса фонов, что уже доезжали за этот запуск: карточка, вернувшаяся в сетку прокруткой, плиты не показывает. */
const arrived = new Set();

const markLoaded = (plate) => {
  if (!plate) return;
  plate.dataset.loaded = "";
  plateChanged(plate);
};

/*
 * Фото, что не доехало (16.11.2026, слово владельца: «карточки не прогружаются»): раньше плита на ошибке просто растворялась и на её месте оставалась пустота, а адрес, что не доехал, запоминался
 * как «доехавший» — повтора не было до конца запуска. Теперь: один повтор с паузой (CDN и локальная служба отдают ошибку и тут же могут отдать картинку; своих повторов у службы уже два, зависание — один), на повторе, что удался,
 * фон ставится заново; после него — плита остаётся тихой заглушкой со значком картинки (`data-failed`, `ui.css`), а не вечным бликом и не пустотой. Один раз не доехавший адрес в этом запуске заглушкой и остаётся (`failedUrls`):
 * круги запросов по кругу не идут (слово общей ведущей 16.11.2026: «один повтор при ошибке, с паузой; без бесконечных повторов на прокрутке»).
 */
const RETRY_PAUSES_MS = [2500];
/* Один заход за картинкой не дольше этого: зависший ответ — тоже ошибка. */
const ATTEMPT_MS = 25000;
const failedUrls = new Set();

/*
 * Очередь картинок плиток в окне (16.11.2026, «шесть зависших обложек не блокируют знаки»). У окна к своей службе шесть соединений на один адрес, и их делят картинки, скрипты, стили и знаки проектов: служба держит
 * зависший запрос до предела (8 с до первых байт), и шесть таких разом остановили бы всё остальное. Поэтому плиты с фоном-картинкой из службы (`/api/media/…`, кадр помечен `data-photo-bg`) ходят за картинкой
 * не больше `LOAD_SLOTS` одновременно, остальные ждут в окне, а не в соединении; одно соединение из шести всегда остаётся остальному (скриптам, API, знакам). Фон кадра не задан, пока плита не получила место и картинка не доехала (`showPicture`),
 * поэтому сам браузер за ним не ходит. Место освобождается на загрузке, ошибке, пределе ожидания и когда плита ушла с экрана (из очереди уходят тоже).
 */
const LOAD_SLOTS = 5;
let loading = 0;
const lineUp = [];

function admit() {
  while (loading < LOAD_SLOTS && lineUp.length) {
    const next = lineUp.shift();
    loading += 1;
    next.held = true;
    next.start();
  }
}

/** Просит место для похода за картинкой; `start` вызовется, когда место есть. Возвращает запись для `giveBack`. */
function takePlace(start) {
  const entry = { start, held: false };
  lineUp.push(entry);
  admit();
  return entry;
}

function giveBack(entry) {
  if (!entry) return;
  if (entry.held) {
    entry.held = false;
    loading -= 1;
  } else {
    const at = lineUp.indexOf(entry);
    if (at >= 0) lineUp.splice(at, 1);
  }
  admit();
}

/** Только для тестов: пустая очередь. */
export function resetPhotoLine() {
  loading = 0;
  lineUp.length = 0;
}

/* Картинка кадра, что отложена до своего места: JSON `{ свойство: значение }` в `data-photo-bg` кадра (`MediaCard`). */
function withheldPicture(plate) {
  const raw = plate?.parentElement?.dataset?.photoBg;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setPicture(plate, on) {
  const frame = plate?.parentElement;
  const picture = withheldPicture(plate);
  if (!frame || !picture) return;
  for (const [name, value] of Object.entries(picture)) {
    if (name.startsWith("--")) {
      if (on) frame.style.setProperty(name, value);
      else frame.style.removeProperty(name);
    } else frame.style[name] = on ? value : "";
  }
}

const failPlate = (plate) => {
  if (!plate) return;
  plate.dataset.failed = "";
  markLoaded(plate);
};

/* Картинка кадра заново: фон, что однажды не загрузился, сам не перечитывается — его значение снимается и возвращается. */
function reapplyFrame(plate) {
  const frame = plate?.parentElement;
  if (!frame?.style?.backgroundImage) return;
  const current = frame.style.backgroundImage;
  frame.style.backgroundImage = "none";
  void frame.offsetWidth;
  frame.style.backgroundImage = current;
}

/* Повтор не доехавшей `<img data-photo>`; `true` — ошибка обработана (повтор назначен или плита ушла в заглушку). */
function retryPhoto(photo, plate) {
  const source = photo.getAttribute("src");
  if (!source) return false;
  const tries = Number(photo.dataset.photoTries || 0);
  if (tries >= RETRY_PAUSES_MS.length) {
    failPlate(plate);
    return true;
  }
  photo.dataset.photoTries = String(tries + 1);
  /* Первый экран повтора не ждёт: плита остаётся скелетом до ответа повтора, а сетка встаёт без неё (`screen-ready.test.jsx`, «битая картинка плиту отпускает»). */
  plateSettled(plate);
  window.setTimeout(() => {
    if (photo.isConnected && photo.getAttribute("src") === source) photo.src = source;
  }, RETRY_PAUSES_MS[tries]);
  return true;
}

/* Фото, что доехало, отпускает плиту перед ним; не доехало — повтор, потом заглушка. */
function releasePlate(event) {
  const photo = event.target;
  if (photo?.tagName !== "IMG" || !photo.hasAttribute("data-photo")) return;
  const plate = photo.previousElementSibling;
  if (!plate?.classList.contains("ui-skeleton")) return;
  if (event.type === "error" && retryPhoto(photo, plate)) return;
  markLoaded(plate);
}

/* События `load` и `error` у картинок не всплывают — слушатель стоит на перехвате и один на всё окно. Один и тот же слушатель не копится: модуль, вычисленный заново (горячая замена в разработке, второй экземпляр модуля в тестах
   одного процесса), снимает прежний и ставит свой. Иначе одна ошибка картинки считалась бы по разу на каждый экземпляр, и повтор кончался бы заглушкой сразу. */
const LISTENER_KEY = Symbol.for("astral.photoPlateListener");
if (typeof document !== "undefined") {
  const previous = document[LISTENER_KEY];
  if (previous) {
    document.removeEventListener("load", previous, true);
    document.removeEventListener("error", previous, true);
  }
  document[LISTENER_KEY] = releasePlate;
  document.addEventListener("load", releasePlate, true);
  document.addEventListener("error", releasePlate, true);
}

/**
 * Плита под фото. Без состояния (см. шапку): сама проверяет соседнюю картинку до первого кадра, дальше её отпускает
 * общий слушатель. `url` — фон-картинка без `<img>` (карточки с `background-image`): плита сама просит её и
 * растворяется по `load`. `held` — не отпускать, пока родитель не готов показать фото.
 */
export const PhotoSkeleton = memo(function PhotoSkeleton({ delay = 0, held = false, url = "", className = "" }) {
  const plate = useRef(null);
  useLayoutEffect(() => {
    const node = plate.current;
    if (!node) return;
    const photo = node.nextElementSibling;
    if (photo?.tagName === "IMG" && photo.hasAttribute("data-photo") && photo.complete && photo.naturalWidth > 0) markLoaded(node);
    else if (url && arrived.has(url)) {
      setPicture(node, true);
      markLoaded(node);
    } else {
      /* Адрес сменился или картинка ещё не доехала: фон от прежнего адреса снимается, новый встанет, когда доедет. */
      setPicture(node, false);
      delete node.dataset.loaded;
    }
  }, [url]);
  /* Сетка ждёт плиты первого экрана: эта встаёт в ожидание, отпускается (`held` снят) или уходит вместе с карточкой.
     Идёт после проверки кэша выше — картинка, что была готова ещё до первого кадра, плиту не держит. */
  useLayoutEffect(() => {
    if (plate.current) plateChanged(plate.current);
  }, [held, url]);
  useLayoutEffect(() => {
    const node = plate.current;
    return () => {
      if (node) plateGone(node);
    };
  }, []);
  useEffect(() => {
    const node = plate.current;
    if (!url || !node || arrived.has(url)) return undefined;
    if (failedUrls.has(url)) {
      failPlate(node);
      return undefined;
    }
    let attempt = 0;
    let timer = 0;
    let image = null;
    let alive = true;
    let place = null;
    const forget = () => {
      if (!image) return;
      image.onload = null;
      image.onerror = null;
    };
    const release = () => {
      giveBack(place);
      place = null;
    };
    const arrive = () => {
      clearTimeout(timer);
      forget();
      release();
      arrived.add(url);
      if (!node.isConnected) return;
      /* Фон кадра, отложенный до места (`data-photo-bg`), встаёт теперь: картинка уже в кэше окна, второго похода нет. */
      setPicture(node, true);
      markLoaded(node);
      /* Картинка доехала не с первого раза: фон кадра, что до этого упал, перечитывается из кэша. */
      if (attempt > 0 && !withheldPicture(node)) reapplyFrame(node);
    };
    const lose = () => {
      clearTimeout(timer);
      forget();
      release();
      if (!alive) return;
      if (attempt < RETRY_PAUSES_MS.length) {
        /* Как у `<img data-photo>`: сетка не ждёт повтора, плита ждёт его скелетом. */
        if (node.isConnected) plateSettled(node);
        timer = setTimeout(() => {
          attempt += 1;
          reach();
        }, RETRY_PAUSES_MS[attempt]);
        return;
      }
      failedUrls.add(url);
      if (node.isConnected) failPlate(node);
    };
    /* Только плиты, чей кадр отложил фон до места (`data-photo-bg`: картинки из службы), встают в очередь окна; прочие ходят сразу, как раньше. */
    const queued = Boolean(withheldPicture(node));
    function begin() {
      image = new Image();
      timer = setTimeout(lose, ATTEMPT_MS);
      image.onload = arrive;
      image.onerror = lose;
      image.src = url;
    }
    function reach() {
      if (!alive) return;
      if (queued) place = takePlace(begin);
      else begin();
    }
    reach();
    return () => {
      alive = false;
      clearTimeout(timer);
      forget();
      release();
    };
  }, [url]);
  return <Skeleton fill plateRef={plate} delay={delay} data-photo-plate="" className={classes(held && "is-held", className)} />;
});

export default Skeleton;
