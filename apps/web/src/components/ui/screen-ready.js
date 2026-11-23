/*
 * «Экран готов» — сетка плиток и комната редактора встают целиком, а не по одной (ТЗ 24.10.2026, решение владельца:
 * «когда человек заходит в вкладку в мастерской, скелетный прогруз идёт полностью: когда всё прогрузится в скелете,
 * тогда показывается вкладка, а не так, что всё поодиночке»).
 *
 * СЕТКА. Контейнер плиток — с меткой `data-assembly-grid` (полки мастерской, оружие и одежда, «Мои работы», библиотека,
 * каталог, сборки, установленное) или `data-screen-group` (галереи, постеры, лента новинок) — это группа. Пока в ней
 * не готово всё, что видно на первом экране, у сетки стоит `data-screen="wait"`: карточки стоят серыми местами фото
 * (плиты скелета, `PhotoSkeleton`, `Skeleton.jsx`), содержимое карточек скрыто, и ни одна плита не растворяется
 * (`assembly-motion.css`, `ui.css`). Когда последняя плита первого экрана отпущена — или вышел потолок
 * `SCREEN_CEILING_MS`, чтобы не ждать вечно, — сетка получает `data-screen="ready"`, и все плиты растворяются разом:
 * фото встают одним растворением. Плита, что за потолок не доехала (печь обложек ещё не сняла картинку), остаётся
 * скелетом и уходит сама, как раньше.
 *
 * КОМНАТА (второй заход, ТЗ 24.10.2026 вечер). Оболочка редактора (`EditorShell`, она одна на все редакторы и студии) —
 * тоже группа: `data-screen-room`. Поверх комнаты, пока она ждёт, стоит занавес — те же серые плашки, что у каркаса
 * загрузки (`EditorSkeleton`: шапка, колонка, кадр, панель), и он растворяется разом, когда готовы два дела: плиты
 * первого экрана комнаты (снимки в панели) и кадр сцены (`useFrameHold` — его зовёт заставка загрузки кадра, как только
 * сцена грузится). Не готово за потолок — занавес уходит, и кадр показывает свою карточку «Сцена грузится».
 *
 * КТО ГОВОРИТ «КАДР ГОТОВ». Кадр сам, двумя путями. 1) Хуком под оболочкой: `ModelStage` — по первой отрисовке сцены,
 * заставки загрузки — пока грузится, общая сцена неба `SkyBlockStage` (таймциклы, фонари, вода) — пока квартал едет из игры
 * (`useFrameHold`, `useStageLoad`). 2) Студия, что стоит выше оболочки (ствол и одежда сами рисуют `EditorShell`): порт
 * `createHoldPort` + `<FrameHoldPort>` внутри оболочки, студия отпускает его по своим событиям — первая удачная загрузка,
 * отказ, «вещи нет» дольше `NO_MODEL_GRACE_MS`. Общего сигнала «на холст что-то нарисовали» нет и не будет: он требует
 * обёрток на прототипах контекстов, а после их снятия рисование на холсте остаётся медленнее (замер 24.10: 5–25 раз на
 * первых проходах, потом +50 % насовсем). Кадру без своего сигнала комната не ждёт.
 *
 * КТО ВЕДЁТ СЕТКУ. Сама плита: встала `PhotoSkeleton` в контейнер плиток — `plateChanged` берёт его в группу (всё
 * содержимое контейнера уже в DOM, а группа собирается в микрозадаче после слоя эффектов: соседи успели проверить
 * кэш, и до первого кадра метка «ждёт» уже стоит). Ни общего наблюдателя, ни обхода окна: цена — один `closest()` на
 * плиту и один обход на сетку. Комнату берёт сама оболочка в своём слое эффектов (дети — кадр и плиты — уже
 * отчитались): готова сразу — занавес не появляется вовсе.
 *
 * БЕЗ СОСТОЯНИЯ REACT, как и у самой плиты (docs/3D.md, правило 22): метки пишутся в DOM, коммитов страница не получает.
 * Таймер потолка — один на группу и живёт только до готовности. Здесь, а не в `Skeleton.jsx`, потому что тот сторожит
 * тест «ни состояния, ни таймера».
 *
 * ПЕРВЫЙ ЭКРАН. Считаются плиты, что видны сейчас или рядом с окном (`IntersectionObserver`, запас `NEAR`): сетка на
 * сорок плиток не ждёт сорок картинок, когда на экране шесть. Без наблюдателя (тесты) группа не ждёт вовсе.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Повторного ожидания, когда в уже готовую группу приходят новые карточки или кадр грузит следующую
 * сцену (смена инструмента, района): ожидание — только при входе. Сетка, чей владелец ставит `data-screen-key` (смена
 * раздела на том же узле), берёт группу заново при смене ключа.
 */

export const SCREEN_ATTRIBUTE = "data-screen";
export const SCREEN_SEEN_ATTRIBUTE = "data-screen-seen";
export const SCREEN_KEY_ATTRIBUTE = "data-screen-key";
/* Сетка с фото-плитами: у неё нет поштучной очереди, а появление — общее (`assembly-motion.css`). */
export const SCREEN_PLATES_ATTRIBUTE = "data-screen-plates";
/* Все плиты были готовы до первого кадра (кэш): ждать нечего, сетка встаёт общим проявлением. */
export const SCREEN_WARM_ATTRIBUTE = "data-screen-warm";
export const SCREEN_ROOM_ATTRIBUTE = "data-screen-room";
export const SCREEN_CEILING_MS = 2500;

const GRID_SELECTOR = "[data-assembly-grid], [data-screen-group]";
const GROUP_SELECTOR = `${GRID_SELECTOR}, [${SCREEN_ROOM_ATTRIBUTE}]`;
const PLATE_SELECTOR = ".ui-skeleton[data-photo-plate]";
/* Плиты не дальше этого от окна считаются первым экраном. */
const NEAR = "120px";

/* группа → { pending, timer, observer, armed, holds }. */
const groups = new WeakMap();
/* плита → группы, которые её ждут (сетка и комната, в которой она стоит). */
const homes = new WeakMap();
/* Сетки, которые уже взялись брать (микрозадача стоит в очереди). */
const queued = new WeakSet();

/** Плита ещё держит экран: фото не доехало или родитель не готов его показать. */
const holding = (plate) => !plate.hasAttribute("data-loaded") || plate.classList.contains("is-held");

function addHome(plate, grid) {
  let set = homes.get(plate);
  if (!set) {
    set = new Set();
    homes.set(plate, set);
  }
  set.add(grid);
}

const quiet = (group) => group.armed && group.pending.size === 0 && !(group.holds && group.holds.size > 0);

function finish(grid) {
  const group = groups.get(grid);
  if (group) {
    clearTimeout(group.timer);
    group.observer?.disconnect();
    for (const plate of group.pending) homes.get(plate)?.delete(grid);
    groups.delete(grid);
  }
  grid.setAttribute(SCREEN_ATTRIBUTE, "ready");
}

function check(grid) {
  const group = groups.get(grid);
  if (group && quiet(group)) finish(grid);
}

/* Первый экран определён: что за краем окна, группу не держит. */
function measured(grid, entries) {
  const group = groups.get(grid);
  if (!group) return;
  for (const entry of entries) {
    if (entry.isIntersecting) continue;
    group.pending.delete(entry.target);
    homes.get(entry.target)?.delete(grid);
  }
  group.observer.disconnect();
  group.armed = true;
  check(grid);
}

function watch(grid, group) {
  group.observer = new IntersectionObserver((entries) => measured(grid, entries), { rootMargin: NEAR });
}

/* Плита перестала держать группу (фото доехало, карточку убрали). */
function leave(plate, grid) {
  homes.get(plate)?.delete(grid);
  groups.get(grid)?.pending.delete(plate);
  check(grid);
}

/** Контейнер, у которого есть что показывать: пустой (данные едут) и с заготовками плиток не берём. */
function adoptable(grid) {
  return grid.firstElementChild && !grid.querySelector(":scope > .is-skeleton");
}

/** Берёт один контейнер плиток в группу. Повторно ту же (тем же ключом) не трогает. */
export function adoptGrid(grid) {
  const key = grid.getAttribute(SCREEN_KEY_ATTRIBUTE) ?? "";
  if (grid.hasAttribute(SCREEN_ATTRIBUTE) && grid.getAttribute(SCREEN_SEEN_ATTRIBUTE) === key) return false;
  if (typeof IntersectionObserver === "undefined" || !adoptable(grid)) return false;

  if (groups.has(grid)) finish(grid);

  grid.setAttribute(SCREEN_SEEN_ATTRIBUTE, key);
  grid.removeAttribute(SCREEN_PLATES_ATTRIBUTE);
  grid.removeAttribute(SCREEN_WARM_ATTRIBUTE);
  const all = grid.querySelectorAll(PLATE_SELECTOR);
  if (all.length > 0) grid.setAttribute(SCREEN_PLATES_ATTRIBUTE, "");
  const plates = [...all].filter(holding);
  if (plates.length === 0) {
    if (all.length > 0) grid.setAttribute(SCREEN_WARM_ATTRIBUTE, "");
    grid.setAttribute(SCREEN_ATTRIBUTE, "ready");
    return true;
  }
  const group = { pending: new Set(plates), timer: 0, observer: null, armed: false, holds: null };
  groups.set(grid, group);
  for (const plate of plates) addHome(plate, grid);
  grid.setAttribute(SCREEN_ATTRIBUTE, "wait");
  group.timer = setTimeout(() => finish(grid), SCREEN_CEILING_MS);
  watch(grid, group);
  for (const plate of group.pending) group.observer.observe(plate);
  return true;
}

/**
 * Удержания комнаты: кадр и всё, что говорит «я ещё не готово». Создаёт оболочка редактора при первой отрисовке;
 * `hold(id, on)` — из слоя эффектов детей (кадр сцены), раньше, чем оболочка берёт комнату.
 */
export function createRoomHolds() {
  const room = {
    ids: new Set(),
    shell: null,
    hold(id, on) {
      if (on === room.ids.has(id)) return;
      if (on) room.ids.add(id);
      else room.ids.delete(id);
      /* Готовность проверяется после слоя эффектов того же коммита, а не сразу: кадр меняется на другой в одной отрисовке
         (прежний отпускает в очистке эффекта, новый встаёт в следующем), и проверка между ними увидела бы «пусто» и
         открыла комнату, не дождавшись нового кадра. */
      if (room.shell && !room.checking) {
        room.checking = true;
        queueMicrotask(() => {
          room.checking = false;
          if (room.shell) check(room.shell);
        });
      }
    },
    checking: false,
  };
  return room;
}

/**
 * Комната берёт себя в группу: готова сразу (нет ни плит первого экрана, ни кадра, что грузится) — `ready` до первого
 * кадра, занавеса не будет; иначе `wait`, пока плиты и кадр не отчитаются или не выйдет потолок. Зовёт оболочка в своём
 * слое эффектов, после детей.
 */
export function adoptRoom(shell, room) {
  room.shell = shell;
  if (typeof IntersectionObserver === "undefined") return false;
  const plates = [...shell.querySelectorAll(PLATE_SELECTOR)].filter(holding);
  if (plates.length === 0 && room.ids.size === 0) {
    shell.setAttribute(SCREEN_ATTRIBUTE, "ready");
    return true;
  }
  const group = { pending: new Set(plates), timer: 0, observer: null, armed: plates.length === 0, holds: room.ids };
  groups.set(shell, group);
  for (const plate of plates) addHome(plate, shell);
  shell.setAttribute(SCREEN_ATTRIBUTE, "wait");
  group.timer = setTimeout(() => finish(shell), SCREEN_CEILING_MS);
  if (plates.length > 0) {
    watch(shell, group);
    for (const plate of plates) group.observer.observe(plate);
  }
  return true;
}

/** Комната ушла с экрана: таймер потолка и наблюдатель не живут дольше неё. */
export function releaseRoom(shell) {
  const group = groups.get(shell);
  if (!group) return;
  clearTimeout(group.timer);
  group.observer?.disconnect();
  for (const plate of group.pending) homes.get(plate)?.delete(shell);
  groups.delete(shell);
}

/* Плита приехала в ждущую группу позже остальных (или вернулась в ожидание): тоже первый экран, пока группа ждёт. */
function join(plate, grid) {
  const group = groups.get(grid);
  if (!group || homes.get(plate)?.has(grid)) return;
  addHome(plate, grid);
  group.pending.add(plate);
  if (group.armed || !group.observer) {
    group.armed = false;
    watch(grid, group);
  }
  group.observer.observe(plate);
}

/**
 * Плита встала или изменилась: фото доехало, `held` снят, адрес сменился. Зовёт `PhotoSkeleton` (после монтирования и
 * при смене `held` / `url`) и общий слушатель `load` / `error` (`Skeleton.jsx`).
 *
 *  • каждая ждущая группа над плитой (сетка, комната) принимает плиту в ожидание или, если отпущена, отпускает;
 *  • плита стоит в контейнере плиток, который ещё не брали, — берём его в группу;
 *  • контейнер уже готов — это поздняя карточка, она встаёт сама, как раньше.
 */
export function plateChanged(plate) {
  const nearest = plate.closest(GROUP_SELECTOR);
  if (!nearest) return;
  const free = !holding(plate);
  for (let grid = nearest; grid; grid = grid.parentElement?.closest(GROUP_SELECTOR)) {
    if (grid.getAttribute(SCREEN_ATTRIBUTE) !== "wait") continue;
    if (free) leave(plate, grid);
    else join(plate, grid);
  }
  /* Комнату берёт оболочка, а не плита. */
  if (!nearest.matches(GRID_SELECTOR)) return;
  const state = nearest.getAttribute(SCREEN_ATTRIBUTE);
  if (state === "wait") return;
  if (state === "ready" && nearest.getAttribute(SCREEN_SEEN_ATTRIBUTE) === (nearest.getAttribute(SCREEN_KEY_ATTRIBUTE) ?? "")) return;
  /* Контейнер берут не здесь, а в микрозадаче: первая плита встаёт раньше соседей, и те ещё не проверили кэш — группа,
     собранная сейчас, ждала бы фото, что уже на месте. Микрозадача идёт после слоя эффектов того же коммита и до
     первого кадра: метка «ждёт» успевает встать раньше, чем человек что-либо увидит. */
  if (queued.has(nearest)) return;
  queued.add(nearest);
  queueMicrotask(() => {
    queued.delete(nearest);
    if (nearest.isConnected) adoptGrid(nearest);
  });
}

/** Плита отпущена: фото доехало (или не доехало). Готовность проверяется, не последняя ли это. */
export function plateSettled(plate) {
  const set = homes.get(plate);
  if (!set) return;
  for (const grid of [...set]) leave(plate, grid);
}

/** Плита ушла с экрана (карточку убрали) — ждать её нечего. */
export function plateGone(plate) {
  plateSettled(plate);
}
