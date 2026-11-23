/*
 * Данные окна «Анимации» (ТЗ 29.10.2026-d): список, персонаж, дорожки клипов и снимки поз для плиток.
 *
 * Всё читает главный процесс (`api.js` → `animation-reads.js`): сетка не разбирает игру сама. Дорожки и позы держатся в памяти
 * окна: вернулся к клипу — он стоит сразу. Снимки поз рисует общая сцена (`animation-scene.js`) по одному на плитку и кладёт в
 * маленькие холсты — их число ограничено, давно не нужные уходят и рисуются заново из позы, а поза — из кэша на диске.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  animationsAvailable,
  detectInstallations,
  hasDesktopBridge,
  listAnimations,
  readAnimationPoses,
  readAnimationTrack,
} from "../../../api.js";
import { readCharacters } from "./animation-character.js";
import { entryRequest, isProject, numberEntries } from "./animation-library.js";
import { createAnimationScene, tileSize } from "./animation-scene.js";
import { lookDrafts } from "../wear-character/player-look.js";

/* Папка игры: первая Legacy, как у остальных редакторов мастерской. */
export async function legacyGameRoot() {
  if (!hasDesktopBridge()) return "";
  const found = await detectInstallations().catch(() => null);
  const games = Array.isArray(found) ? found : found?.games || [];
  return (
    games.find(
      (game) =>
        game?.path &&
        String(game.edition || "Legacy").toLowerCase() === "legacy",
    )?.path || ""
  );
}

/**
 * Список анимаций: `{ status, entries, sources, problems, hasGame, reload }`. `status`: `loading`, `ready`, `unavailable`
 * (окно без Astral Desktop) или `error`.
 */
export function useAnimationList() {
  const [state, setState] = useState({
    status: animationsAvailable() ? "loading" : "unavailable",
    entries: [],
    sources: [],
    problems: [],
    hasGame: false,
    error: "",
  });
  const [gameRoot, setGameRoot] = useState("");
  const generation = useRef(0);
  const load = useCallback(async (refresh = false) => {
    if (!animationsAvailable()) {
      setState((current) => ({ ...current, status: "unavailable" }));
      return;
    }
    const mine = (generation.current += 1);
    setState((current) => ({
      ...current,
      status: refresh || !current.entries.length ? "loading" : current.status,
    }));
    try {
      const root = await legacyGameRoot();
      if (mine !== generation.current) return;
      /* Папка игры известна раньше списка: персонаж и сцена собираются, пока читается список (раньше они ждали его конца — это секунды до первого кадра). */
      setGameRoot(root);
      const answer = await listAnimations({ gameRoot: root, refresh });
      if (mine !== generation.current) return;
      setState({
        status: "ready",
        entries: numberEntries(answer?.entries || []),
        sources: answer?.sources || [],
        problems: answer?.problems || [],
        hasGame: Boolean(answer?.hasGame),
        error: "",
      });
    } catch (error) {
      if (mine === generation.current)
        setState((current) => ({
          ...current,
          status: "error",
          error: String(error?.message || error),
        }));
    }
  }, []);
  useEffect(() => {
    void load(false);
    return () => {
      generation.current += 1;
    };
  }, [load]);
  return { ...state, gameRoot, reload: load };
}

/*
 * Дорожки по записи. «Слот» — всё, что окно знает про клип записи: читается ли он, готова ли дорожка, чем кончилось чтение. Окно листает
 * клипы туда-обратно, и вернуться к прочитанному не стоит ничего: готовая дорожка отдаётся в тот же кадр, без «Готовлю анимацию…».
 * Слот заводит и выбранная запись, и соседи по сетке, и плитка под курсором (`warmTrack`): к щелчку дорожка чаще всего уже лежит здесь.
 */
const slots = new Map();
const TRACK_LIMIT = 48;
/* Память дорожек окна: клип в четверть минуты весит ≈ 1 МБ, самый длинный (254 с) — ≈ 12 МБ, поэтому слоты ограничены ещё и байтами, а не только числом. */
export const TRACK_BYTES_BUDGET = 64 * 1024 * 1024;
const watchers = new Set();
let slotsVersion = 0;
let slotsRoot = null;

const slotsChanged = () => {
  slotsVersion += 1;
  for (const watcher of watchers) watcher();
};
const watchSlots = (listener) => {
  watchers.add(listener);
  return () => watchers.delete(listener);
};
const slotsSnapshot = () => slotsVersion;

const bytesOf = (slot) =>
  slot.track
    ? (slot.track.rotations?.byteLength || 0) +
      (slot.track.mover?.byteLength || 0) +
      (slot.track.travel?.byteLength || 0)
    : 0;

/** Давно не нужные слоты уходят: сначала по числу, потом по байтам; читающиеся и слот `keep` остаются. */
export function trimSlots(keep) {
  let total = 0;
  for (const slot of slots.values()) total += bytesOf(slot);
  for (const [id, old] of slots) {
    if (slots.size <= TRACK_LIMIT && total <= TRACK_BYTES_BUDGET) break;
    if (old.status !== "loading" && id !== keep) {
      total -= bytesOf(old);
      slots.delete(id);
    }
  }
}

/* Слот записи; читается один раз, пока не кончился отказом (тогда повторный заказ читает заново). Другая игра — другие дорожки. */
function slotOf(entry, gameRoot) {
  if (slotsRoot !== gameRoot) {
    slots.clear();
    slotsRoot = gameRoot;
  }
  const known = slots.get(entry.id);
  if (known && known.status !== "error") return known;
  const slot = {
    id: entry.id,
    status: "loading",
    track: null,
    error: "",
    done: null,
  };
  slot.done = readAnimationTrack({ gameRoot, entry: entryRequest(entry) }).then(
    (track) => {
      slot.status = "ready";
      slot.track = { ...track, id: entry.id };
      trimSlots(entry.id);
      slotsChanged();
    },
    (error) => {
      slot.status = "error";
      slot.error = String(error?.message || error);
      slotsChanged();
    },
  );
  slots.set(entry.id, slot);
  trimSlots(entry.id);
  return slot;
}

/** Для проверок: забыть все слоты. */
export function resetTrackSlots() {
  slots.clear();
  slotsRoot = null;
  slotsChanged();
}

/** Прочитать дорожку заранее (сосед выбранной, плитка под курсором): слот заводится, ответа ждать не нужно. Возвращает конец чтения. */
export function warmTrack(entry, gameRoot) {
  return slotOf(entry, gameRoot).done;
}

/** Дорожка клипа записи: `{ id, status: "idle" | "loading" | "ready" | "error", track, error }`. Готовая стоит в том же кадре. */
export function useTrack(entry, gameRoot) {
  useSyncExternalStore(watchSlots, slotsSnapshot);
  useEffect(() => {
    if (entry) slotOf(entry, gameRoot);
  }, [entry?.id, gameRoot]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!entry) return { id: "", status: "idle", track: null, error: "" };
  const slot = slotsRoot === gameRoot ? slots.get(entry.id) : null;
  if (!slot) return { id: entry.id, status: "loading", track: null, error: "" };
  /* Давно не бывшее на экране уходит первым: показанное снова встаёт в конец очереди. */
  slots.delete(entry.id);
  slots.set(entry.id, slot);
  return {
    id: entry.id,
    status: slot.status,
    track: slot.track,
    error: slot.error,
  };
}

/**
 * Покраска вещей и тату персонажа игрока (3.11.2026): черновики мастерской одежды ложатся на его вещи тем же `paintOutfit`, что и в мастерской. Холсты мастерской тянутся только здесь и только когда у
 * игрока есть что красить; не нашлось — вещи остаются такими, как в игре.
 */
async function paintLook(scene, look, cancelled) {
  try {
    const drafts = await lookDrafts(look);
    if (!drafts.length || cancelled()) return;
    const [{ paintOutfit }, { createPatternCache }] = await Promise.all([
      import("../../../components/desktop/workshop/gun/outfit-paint.js"),
      import("../../../components/desktop/workshop/gun/gun-patterns.js"),
    ]);
    if (cancelled()) return;
    await paintOutfit(scene, drafts, createPatternCache());
  } catch {
    /* вещи остаются как в игре */
  }
}

/**
 * Сцена с персонажем: `{ scene, status }`. `status`: `loading`, `ready`, `nogame` (игры нет — показывать нечем), `nogl` (нет
 * WebGL) или `error`. Сцена одна на окно студии, освобождается на выходе.
 */
export function useAnimationScene(gameRoot, enabled = true) {
  const [state, setState] = useState({ scene: null, status: "loading" });
  /* Рендерер окна ушёл от сцены (`scene.onLost`): сцена заводится заново, а не рисует мимо буфера окна. */
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    /* Выключенная студия не держит освобождённую сцену: окно и полка рисовали бы ею, когда рендерер окна уже у другого кадра. */
    if (!enabled) {
      setState((current) =>
        current.scene ? { scene: null, status: "loading" } : current,
      );
      return undefined;
    }
    if (!gameRoot) {
      setState({ scene: null, status: "nogame" });
      return undefined;
    }
    let cancelled = false;
    let made = null;
    setState({ scene: null, status: "loading" });
    (async () => {
      /* Персонажа начинают читать до того, как заведена сцена: чтение идёт в другом процессе, пока окно заводит WebGL (≈100–160 мс параллельно). */
      const reading = readCharacters(gameRoot);
      reading.catch(() => {});
      const scene = createAnimationScene();
      if (!scene) {
        if (!cancelled) setState({ scene: null, status: "nogl" });
        return;
      }
      made = scene;
      try {
        /* Тот же персонаж, что в мастерской одежды: стандартный или игрока в его вещах (`animation-character.js`). Сцена и манекен плиток разбираются разом. */
        const characters = await reading;
        await Promise.all([
          scene.loadRig(characters.stage),
          characters.same ? null : scene.loadMannequin(characters.mannequin),
        ]);
        if (cancelled) return;
        scene.onLost?.(() => {
          if (!cancelled) setGeneration((value) => value + 1);
        });
        setState({ scene, status: "ready" });
        /* Первая настоящая отрисовка вещей — вне кадра появления окна (`warmUp` в `animation-scene.js`). */
        setTimeout(() => !cancelled && scene.warmUp?.(), 0);
        /* Вещи и тату игрока красятся после первого кадра: персонаж виден сразу, покраска ложится на него, когда соберётся. */
        if (characters.look)
          void paintLook(scene, characters.look, () => cancelled);
      } catch (error) {
        scene.dispose();
        made = null;
        if (!cancelled)
          setState({
            scene: null,
            status: "error",
            error: String(error?.message || error),
          });
      }
    })();
    return () => {
      cancelled = true;
      made?.dispose();
    };
  }, [gameRoot, enabled, generation]);
  return state;
}

const SHELF_LIMIT = 520;

/* Следующий кадр окна; в спрятанном окне кадров нет, и очередь идёт таймером. */
const nextFrame = () =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    if (typeof requestAnimationFrame === "function")
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
  });
/* Размер снимка плитки зависит от плотности экрана (`tileSize`): 140×175 на экране в полторы-две плотности — 210×262…280×350 пикселей, чтобы плитка не растягивалась. */
export { tileSize };

/**
 * Снимки поз плиток. `want(entry)` просит снимок (поза читается пачкой, рисуется и кладётся в холст), `cancel(entry)` снимает
 * просьбу, пока она в очереди; `get(id)` — холст или `false` (клип не прочитался). `subscribe` — для перерисовки плиток.
 */
/* Плитка проекта просит позу, только если пробыла на экране дольше этого: поза — это скачанный словарь, а прокрутка сетки не должна качать каждый словарь, мимо которого проехали (ревью 14.11, п. 7). */
export const PROJECT_DWELL_MS = 400;

export function createPoseShelf(scene, gameRoot) {
  const done = new Map();
  const dwelling = new Map();
  /* Сами позы плиток: пока клип читается, окно показывает персонажа в позе плитки, а не пустоту. */
  const poseData = new Map();
  const queued = new Map();
  const inflight = new Set();
  const listeners = new Set();
  let timer = 0;
  let running = false;
  let version = 0;
  let thumbView = null;
  let disposed = false;

  const notify = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  async function run() {
    if (running || disposed) return;
    running = true;
    try {
      while (queued.size && !disposed) {
        const batch = [...queued.values()].slice(0, 24);
        for (const entry of batch) {
          queued.delete(entry.id);
          inflight.add(entry.id);
        }
        let poses;
        try {
          poses =
            (
              await readAnimationPoses({
                gameRoot,
                entries: batch.map(entryRequest),
              })
            ).poses || [];
        } catch {
          poses = batch.map((entry) => ({ id: entry.id, failed: "read" }));
        }
        if (disposed) return;
        /* Плитки рисует белый манекен — стандартный персонаж одной тканью, без причёски, вещей и тату игрока. */
        thumbView ||= scene.makeView({ mannequin: true });
        /* Одна плитка за кадр: на слабой видеокарте двадцать четыре снимка подряд — долгая задача, и окно замирало бы. */
        for (const pose of poses) {
          inflight.delete(pose.id);
          if (disposed) return;
          if (!pose.tags?.length || !thumbView) {
            done.set(pose.id, false);
            continue;
          }
          const track = {
            id: pose.id,
            frames: 1,
            fps: 1,
            tags: pose.tags,
            rotations: pose.rotations,
            mover: pose.mover,
            preview: true,
          };
          poseData.set(pose.id, track);
          while (poseData.size > SHELF_LIMIT)
            poseData.delete(poseData.keys().next().value);
          thumbView.setTrack(track);
          thumbView.pose(0);
          const canvas = document.createElement("canvas");
          const { width, height } = tileSize();
          /* Рендерер ушёл от сцены: снимка нет, полку заведут со следующей сценой. */
          if (scene.renderPose(thumbView, canvas, width, height) === false)
            return;
          done.set(pose.id, canvas);
          while (done.size > SHELF_LIMIT) done.delete(done.keys().next().value);
          notify();
          await nextFrame();
        }
      }
    } finally {
      running = false;
    }
  }

  const enqueue = (entry) => {
    if (disposed || done.has(entry.id) || inflight.has(entry.id)) return;
    queued.set(entry.id, entry);
    if (!timer)
      timer = setTimeout(() => {
        timer = 0;
        void run();
      }, 30);
  };

  return {
    want(entry) {
      if (disposed || done.has(entry.id) || inflight.has(entry.id)) return;
      if (isProject(entry)) {
        if (dwelling.has(entry.id) || queued.has(entry.id)) return;
        dwelling.set(
          entry.id,
          setTimeout(() => {
            dwelling.delete(entry.id);
            enqueue(entry);
          }, PROJECT_DWELL_MS),
        );
        return;
      }
      enqueue(entry);
    },
    cancel(entry) {
      clearTimeout(dwelling.get(entry.id));
      dwelling.delete(entry.id);
      queued.delete(entry.id);
    },
    get: (id) => done.get(id),
    /** Поза плитки как дорожка в один кадр (`preview`) или `undefined`: чем показать запись, пока читается её клип. */
    pose: (id) => poseData.get(id),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      for (const wait of dwelling.values()) clearTimeout(wait);
      dwelling.clear();
      queued.clear();
      listeners.clear();
      thumbView?.dispose();
      thumbView = null;
      done.clear();
      poseData.clear();
    },
  };
}

/** Полка снимков для сцены: пересоздаётся со сценой, освобождается на выходе. */
export function usePoseShelf(scene, gameRoot) {
  const shelf = useMemo(
    () => (scene ? createPoseShelf(scene, gameRoot) : null),
    [scene, gameRoot],
  );
  useEffect(() => () => shelf?.dispose(), [shelf]);
  return shelf;
}
