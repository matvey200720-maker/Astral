import { majesticImageMap } from "./item-picture.js";
import { useServerBase } from "./useServerBase.js";
import { useProjectClothing } from "./useProjectClothing.js";
import { useGameClothing } from "./useGameClothing.js";
import { useServerClothing } from "./useServerClothing.js";
import { catalogTargets } from "./clothing-targets.js";
import { readMajesticWiki } from "../../api.js";
import { pictureAllowed } from "@modovik/clothing/project-items";
import { BASE_SERVERS } from "@modovik/clothing/server-base";
import { tabServer } from "@modovik/clothing/target-tabs";
import { calibrateMajestic, majesticType } from "@modovik/clothing/majestic-wiki";
import { useEffect, useMemo, useState } from "react";

const NOTHING = Object.freeze([]);
const WIKI_IDLE = Object.freeze({ status: "idle", items: NOTHING });

// ---------- вики Majestic: один вопрос на пару «пол|вид» ----------

// Ответ вики в состояние хука: нет статуса — unavailable, не список — пусто.
const toWiki = (reply) => ({
  status: reply?.status || "unavailable",
  items: [reply?.items].find(Array.isArray) ?? [],
});

const wikiBook = new Map();

export function forgetMajesticWiki() {
  wikiBook.clear();
}

function askWiki(key) {
  if (wikiBook.has(key)) return wikiBook.get(key);
  const [gender, component] = key.split("|");
  const answer = new Promise((resolve) => resolve(readMajesticWiki({ gender, component })))
    .then(toWiki)
    .catch(() => {
      wikiBook.delete(key);
      return toWiki(null);
    });
  wikiBook.set(key, answer);
  return answer;
}

// Ключ запроса вики; пустой, пока вики не нужна.
function wikiKey(server, wear) {
  const kind = wear?.component;
  const wanted = server === "majestic" && kind && majesticType(kind);
  return wanted ? `${wear.gender}|${kind}` : "";
}

function useWikiState(server, wear) {
  const key = wikiKey(server, wear);
  const [state, setState] = useState(WIKI_IDLE);
  useEffect(() => {
    const gate = new AbortController();
    const answer = key ? askWiki(key) : Promise.resolve(WIKI_IDLE);
    answer.then((next) => {
      if (!gate.signal.aborted) setState(next);
    });
    return () => gate.abort();
  }, [key]);
  return state;
}

// ---------- калибровка по вещам каталога и совета автора ----------

function* anchorItems(wear, pools) {
  for (const pool of pools) {
    for (const item of pool) {
      const same = item.gender === wear.gender && item.component === wear.component;
      if (same && item.server === "majestic") yield item;
    }
  }
}

function calibrate(items, wear, mods, author) {
  if (!items.length) return null;
  return calibrateMajestic(items, [...anchorItems(wear, [catalogTargets(mods), author])]);
}

// Если у Majestic есть своя база, вики остаётся только для вещей GTA Online.
function wikiView(calibrated, status, baseHasMajestic) {
  if (!calibrated) return { list: NOTHING, info: null };
  const { items, packs } = calibrated;
  if (baseHasMajestic) return { list: items.filter((item) => item.byGame), info: null };
  return { list: items, info: { status, packs } };
}

// ---------- одинаковый набор списков — тот же массив extra ----------

const ROW = {};
const rowRoot = new WeakMap();

function intern(node, lists, row) {
  if (!lists.length) return node.get(ROW) ?? node.set(ROW, row).get(ROW);
  const [head, ...tail] = lists;
  const key = Object(head);
  return intern(node.get(key) ?? node.set(key, new WeakMap()).get(key), tail, row);
}

const sameRow = (lists) => intern(rowRoot, lists, lists);

// ---------- хук ----------

// Запросы идут в этом порядке: файлы, игра, вики, проект, база. `server` — вкладка («gta», «majestic», «gta5rp»): у «GTA» проекта нет, вики и вещи проекта не нужны.
function useRawSources(wear, server) {
  const files = useServerClothing();
  const game = useGameClothing(wear);
  const wiki = useWikiState(tabServer(server), wear);
  const project = useProjectClothing(wear, tabServer(server));
  const base = useServerBase(wear);
  return { files, game, wiki, project, base };
}

export function useServerSources(params) {
  const { mods, wear, server, author = NOTHING } = params;
  const { files, game, wiki, project, base } = useRawSources(wear, server);

  const hasWear = Boolean(wear);
  const [gender, component] = [wear?.gender, wear?.component];
  const calibrated = useMemo(
    () => (hasWear ? calibrate(wiki.items, { gender, component }, mods, author) : null),
    [wiki.items, hasWear, gender, component, mods, author],
  );
  const baseHasMajestic = (base.lists.majestic?.length ?? 0) > 0;
  const view = useMemo(
    () => wikiView(calibrated, wiki.status, baseHasMajestic),
    [calibrated, wiki.status, baseHasMajestic],
  );
  const majesticImages = useMemo(() => majesticImageMap(wiki.items, pictureAllowed), [wiki.items]);

  const baseLists = BASE_SERVERS.map((id) => base.lists[id] ?? NOTHING);
  return {
    extra: sameRow([files, game, project.items, view.list].concat(baseLists)),
    majesticImages,
    wiki: view.info,
    project: project.status,
    base: base.status,
  };
}
