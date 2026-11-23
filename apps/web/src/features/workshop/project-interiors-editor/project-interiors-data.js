/*
 * «Интерьеры проектов» (ТЗ 17.10.2026, вечер, задача 10): что окно берёт у
 * Astral Desktop — источники игрока, каталог интерьеров проекта, сцена кадра и
 * её листы.
 *
 * Всё это читается из папок и игры самого игрока в главном процессе
 * (`apps/desktop/src/project-interiors/`); окно получает краткие записи и
 * готовые файлы сцены и отдаёт сцену общему кадру ссылкой `blob:`. В браузере
 * без Astral Desktop источников нет, и редактор так и пишет.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  addProjectInteriorsSource,
  cancelProjectInteriorsPack,
  fetchProjectInteriorsPack,
  getCloudDownloadGrant,
  hasDesktopBridge,
  readProjectInteriorsCatalog,
  readProjectInteriorsCdnState,
  readProjectInteriorsScene,
  readProjectInteriorsSheets,
  readProjectInteriorsState,
  removeProjectInteriorsPack,
  removeProjectInteriorsSource,
  sanitizeDesktopErrorMessage,
} from "../../../api.js";
import { detectLegacyGame } from "../install-queue/game-root.js";
import { projectPackSnapshot, subscribeProjectPacks } from "./project-pack-store.js";
import { packErrorText } from "./project-interiors-text.js";

const gameRootOnce = async () => (await detectLegacyGame().catch(() => "")) || "";

/**
 * Источники и каталог проекта: `status` — `"web"` (нет Astral Desktop),
 * `"loading"`, `"empty"` (источников нет), `"ready"`, `"failed"`. `slugs` — только
 * эти паки Astral (редактор «Интерьеры Majestic RP» просит паки своей записи:
 * из двенадцати паков казино читает два); без него — все.
 */
export function useProjectCatalog(project, { slugs = null } = {}) {
  const slugsKey = slugs ? slugs.join(",") : "";
  const [state, setState] = useState({ project: null, status: "loading", units: [], sources: [], candidates: [], encryptedCache: false, game: false, message: "", report: [] });
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const token = useRef(0);

  useEffect(() => {
    const mine = (token.current += 1);
    const done = (next) => {
      if (token.current === mine) setState({ project, ...next });
    };
    if (!hasDesktopBridge()) {
      done({ status: "web", units: [], sources: [], candidates: [], encryptedCache: false, game: false, message: "", report: [] });
      return undefined;
    }
    setState((current) => (current.project === project ? { ...current, status: "loading" } : { project, status: "loading", units: [], sources: [], candidates: [], encryptedCache: false, game: false, message: "", report: [] }));
    (async () => {
      try {
        const listed = await readProjectInteriorsState({ project });
        if (!listed.sources.length) {
          done({ status: "empty", units: [], sources: [], candidates: listed.candidates, encryptedCache: listed.encryptedCache, game: false, message: "", report: [] });
          return;
        }
        const gameRoot = await gameRootOnce();
        const catalog = await readProjectInteriorsCatalog({ project, ...(gameRoot ? { gameRoot } : {}), ...(slugsKey ? { slugs: slugsKey.split(",") } : {}), ...(tick ? { force: tick > 1 } : {}) });
        done({
          status: "ready",
          units: catalog.units,
          sources: listed.sources,
          candidates: listed.candidates,
          encryptedCache: listed.encryptedCache,
          game: catalog.game,
          message: "",
          report: catalog.sources,
        });
      } catch (error) {
        done({ status: "failed", units: [], sources: [], candidates: [], encryptedCache: project === "majestic", game: false, message: sanitizeDesktopErrorMessage(error), report: [] });
      }
    })();
    return () => {
      token.current += 1;
    };
  }, [project, tick, slugsKey]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  const act = useCallback(
    async (work) => {
      setBusy(true);
      try {
        await work();
        reload();
        return "";
      } catch (error) {
        return sanitizeDesktopErrorMessage(error);
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );
  /* Папка — диалогом выбора; найденный кэш — по номеру. Возвращает текст отказа или пустую строку. */
  const add = useCallback(
    async (candidate = null) => {
      const gameRoot = await gameRootOnce();
      return act(() => addProjectInteriorsSource({ project, ...(candidate ? { candidate } : { pick: true }), ...(gameRoot ? { gameRoot } : {}) }));
    },
    [act, project],
  );
  const remove = useCallback((id) => act(() => removeProjectInteriorsSource({ id })), [act]);

  return { ...state, current: state.project === project, busy, add, remove, rescan: reload };
}

/* ------------------------------------------------------------------ *
 * Пакеты интерьеров из каталога Astral
 * ------------------------------------------------------------------ */

const POLL_MS = 700;

/**
 * Паки проекта из облачного каталога (список — из блока `domain` мода, без
 * скачивания) и то, что с ними на этом компьютере: скачан, идёт, ничего.
 * `onChanged` зовут, когда набор скачанного поменялся: каталог интерьеров
 * перечитывается. Окно называет проект и пак; манифест и адрес берутся у
 * облака (грант), путь выбирает главный процесс (`project-interiors/cdn.js`).
 */
export function useProjectPacks(project, onChanged = null) {
  const store = useSyncExternalStore(subscribeProjectPacks, projectPackSnapshot);
  const [cdn, setCdn] = useState({ project: null, fetched: [], active: [] });
  const [pending, setPending] = useState(() => new Set());
  const [note, setNote] = useState({ slug: "", text: "" });
  const desktop = hasDesktopBridge();
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      const state = await readProjectInteriorsCdnState({ project });
      setCdn({ project, fetched: state.fetched || [], active: state.active || [] });
    } catch {
      /* список скачанного не прочитался — окно остаётся с прежним */
    }
  }, [desktop, project]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const polling = pending.size > 0 || (cdn.project === project && cdn.active.length > 0);
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, refresh]);

  const mark = useCallback((slug, on) => setPending((current) => new Set(on ? [...current, slug] : [...current].filter((item) => item !== slug))), []);

  const download = useCallback(
    async (pack) => {
      setNote({ slug: "", text: "" });
      mark(pack.slug, true);
      try {
        const grant = await getCloudDownloadGrant(pack.id);
        await fetchProjectInteriorsPack({ project, slug: pack.slug, manifest: grant.manifest, baseUrl: grant.packageBaseUrl });
        changed.current?.();
      } catch (error) {
        setNote({ slug: pack.slug, text: packErrorText(error) });
      } finally {
        mark(pack.slug, false);
        refresh();
      }
    },
    [project, mark, refresh],
  );
  const cancel = useCallback(
    async (slug) => {
      try {
        await cancelProjectInteriorsPack({ project, slug });
      } catch {
        /* уже закончилось */
      }
      refresh();
    },
    [project, refresh],
  );
  const remove = useCallback(
    async (slug) => {
      setNote({ slug: "", text: "" });
      try {
        await removeProjectInteriorsPack({ project, slug });
        changed.current?.();
      } catch (error) {
        setNote({ slug, text: packErrorText(error) });
      }
      refresh();
    },
    [project, refresh],
  );

  const mine = cdn.project === project;
  const packs = useMemo(() => {
    const fetched = new Map((mine ? cdn.fetched : []).map((item) => [item.slug, item]));
    const active = new Map((mine ? cdn.active : []).map((item) => [item.slug, item]));
    return store.packs
      .filter((pack) => pack.project === project)
      .map((pack) => ({ ...pack, fetched: fetched.get(pack.slug) || null, active: active.get(pack.slug) || (pending.has(pack.slug) ? { percent: 0, downloadedBytes: 0, totalBytes: pack.bytes, message: "" } : null) }))
      .sort((a, b) => a.place.join("/").localeCompare(b.place.join("/")) || a.label.localeCompare(b.label));
  }, [store, mine, cdn, pending, project]);

  return { status: desktop ? "ready" : "web", closed: store.closed, packs, note, download, cancel, remove };
}

/* ------------------------------------------------------------------ *
 * Сцена кадра
 * ------------------------------------------------------------------ */

const scenes = new Map();
const SCENES_LIMIT = 6;
/* Сколько сцен окно держит готовыми: у казино семь залов, и все они ждут рядом (`preloadProjectScenes`), иначе первый зал уходил бы из памяти до возврата. */
let scenesLimit = SCENES_LIMIT;
/*
 * Вес сцен тоже с потолком (ТЗ 29.10.2026-e): второе помещение LSPD Mission Row — 106 МБ и 6090 сеток, шесть таких держали бы больше полугигабайта
 * памяти окна. Сверх предела старые сцены отпускаются (повторный вход берёт готовую сцену из кэша главного процесса), самая новая остаётся всегда.
 */
const SCENES_BYTES_LIMIT = 256 * 1024 * 1024;
const sceneBytes = new Map();
function trimScenes() {
  const weight = () => [...scenes.keys()].reduce((sum, key) => sum + (sceneBytes.get(key) || 0), 0);
  while (scenes.size > scenesLimit || (scenes.size > 1 && weight() > SCENES_BYTES_LIMIT)) {
    const oldest = scenes.keys().next().value;
    scenes.get(oldest)?.then((result) => result.url && URL.revokeObjectURL(result.url));
    scenes.delete(oldest);
    sceneBytes.delete(oldest);
  }
}
export function setProjectScenesLimit(limit) {
  scenesLimit = Math.max(SCENES_LIMIT, Math.floor(Number(limit)) || SCENES_LIMIT);
}

/** Сцена интерьера: обещание `{ url, eye, surfaces }` или `{ reason, needsGame }`. Одна ссылка на интерьер за сеанс окна. */
export function projectSceneSource(project, id, mlo = "") {
  if (!project || !id) return Promise.resolve({ reason: "" });
  const key = `${project}|${id}|${mlo}`;
  if (!scenes.has(key)) {
    const pending = (async () => {
      const gameRoot = await gameRootOnce();
      let answer = null;
      try {
        answer = await readProjectInteriorsScene({ project, id, ...(mlo ? { mlo } : {}), ...(gameRoot ? { gameRoot } : {}) });
      } catch (error) {
        return { reason: sanitizeDesktopErrorMessage(error) };
      }
      if (!answer?.scene) return { reason: answer?.reason || "", needsGame: Boolean(answer?.needsGame) };
      return { url: URL.createObjectURL(new Blob([answer.scene], { type: "application/octet-stream" })), eye: answer.eye, surfaces: answer.surfaces || {}, report: answer.report || {}, bytes: answer.scene.byteLength || 0 };
    })().then((result) => {
      /* Без сцены — не помним: игру подключили или файлы поправили, следующий раз спросим заново. */
      if (!result.url && scenes.get(key) === pending) scenes.delete(key);
      else if (result.url && scenes.get(key) === pending) {
        sceneBytes.set(key, result.bytes || 0);
        trimScenes();
      }
      return result;
    });
    scenes.set(key, pending);
    trimScenes();
  }
  return scenes.get(key);
}

/** Сцена интерьера для кадра: `{ state: "loading" | "ready" | "missing", url, eye, surfaces, reason, needsGame }`. */
export function useProjectScene(project, id, mlo = "") {
  const [result, setResult] = useState({ key: "", state: "loading" });
  const key = `${project}|${id}|${mlo}`;
  useEffect(() => {
    let alive = true;
    if (!id) return undefined;
    projectSceneSource(project, id, mlo).then((answer) => {
      if (alive) setResult(answer.url ? { key, state: "ready", ...answer } : { key, state: "missing", reason: answer.reason || "", needsGame: answer.needsGame });
    });
    return () => {
      alive = false;
    };
  }, [project, id, mlo, key]);
  return result.key === key ? result : { key, state: id ? "loading" : "missing", reason: "" };
}

/* ------------------------------------------------------------------ *
 * Листы кадра
 * ------------------------------------------------------------------ */

const BATCH = 48;

/**
 * Свой источник листов для общего кадра (`setSceneSheetSource`): листы
 * интерьера и штатных вещей читает главный процесс из файлов игрока. Запросы
 * одного кадра собираются в пачки.
 */
export function projectSheetSource(project, id) {
  let queue = [];
  let timer = 0;
  const flush = async () => {
    timer = 0;
    const batch = queue.splice(0, BATCH);
    if (queue.length) timer = setTimeout(flush, 0);
    if (!batch.length) return;
    let answer = null;
    try {
      const gameRoot = await gameRootOnce();
      answer = await readProjectInteriorsSheets({ project, id, ...(gameRoot ? { gameRoot } : {}), textures: batch.map(({ entry }) => ({ game: entry.game, name: entry.texture, size: 512 })) });
    } catch {
      answer = null;
    }
    batch.forEach((item, index) => {
      const buffer = answer?.textures?.[index];
      if (!buffer || typeof createImageBitmap !== "function") {
        item.resolve(null);
        return;
      }
      createImageBitmap(new Blob([buffer], { type: "image/webp" }))
        .then(item.resolve)
        .catch(() => item.resolve(null));
    });
  };
  return (entry) =>
    entry?.game
      ? new Promise((resolve) => {
          queue.push({ entry, resolve });
          if (!timer) timer = setTimeout(flush, 0);
        })
      : null;
}

/**
 * Лист целиком для студии текстур (ТЗ 29.10.2026-e): до 2048 px по длинной стороне (превью кадра — 512). `entry` — запись текстуры сцены (`{ game, texture }`);
 * `null` — нет записи (плашка без картинки), нет Astral Desktop или лист не прочитался.
 */
export async function projectSheetBitmap(project, id, entry, size = 2048) {
  if (!project || !id || !entry?.game || typeof createImageBitmap !== "function") return null;
  try {
    const gameRoot = await gameRootOnce();
    const answer = await readProjectInteriorsSheets({ project, id, ...(gameRoot ? { gameRoot } : {}), textures: [{ game: entry.game, name: entry.texture, size }] });
    const buffer = answer?.textures?.[0];
    return buffer ? await createImageBitmap(new Blob([buffer], { type: "image/webp" })) : null;
  } catch {
    return null;
  }
}

/**
 * Помещения интерьера заранее (26.10.2026, ТЗ п. C3: переключение залов казино не должно ждать сборки): по одному, в тихое время, пока открыт
 * редактор — поток читателя собирает их вне окна, кадр берёт готовую ссылку. `mlos` — хеши помещений (8 знаков) в порядке ожидания;
 * вызов возвращает функцию «хватит».
 */
export function preloadProjectScenes(project, id, mlos, { delay = 600 } = {}) {
  let stopped = false;
  let timer = 0;
  const queue = [...mlos];
  const next = async () => {
    timer = 0;
    if (stopped || !queue.length) return;
    try {
      await projectSceneSource(project, id, queue.shift());
    } catch {
      /* зал не собрался — его причину окно скажет, когда человек его откроет */
    }
    if (!stopped) timer = setTimeout(next, 50);
  };
  timer = setTimeout(next, delay);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** Редактор закрыт: ссылки на сцены освобождаются (каждая держит в памяти сцену целиком), сами сцены остаются в кэше главного процесса. */
export function releaseProjectScenes() {
  for (const pending of scenes.values()) pending.then((result) => result.url && URL.revokeObjectURL(result.url)).catch(() => {});
  scenes.clear();
  sceneBytes.clear();
  scenesLimit = SCENES_LIMIT;
}

/** Для тестов: ссылки живут весь сеанс окна. */
export function forgetProjectScenes() {
  scenes.clear();
  sceneBytes.clear();
  scenesLimit = SCENES_LIMIT;
}
