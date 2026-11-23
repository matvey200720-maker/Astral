import { isCatalogBundle, postKeyOf } from "../../catalog-utils.js";
import { isReduxBase } from "./bundles/component-groups.js";

// Слова по языкам: kind, set, installAll, installedAll, partOf, openRedux, затем виды кусков в порядке PIECE_KINDS.
const PIECE_KINDS = ["metadata", "occl", "lodlights", "lights", "zapretka", "optimization", "meta"];

const dictionaryOf = ([kind, set, installAll, installedAll, partOf, openRedux, ...pieces]) => ({
  kind,
  set,
  installAll,
  installedAll,
  partOf,
  openRedux,
  pieces: Object.fromEntries(PIECE_KINDS.map((name, at) => [name, pieces[at]])),
});

const WORDS = {
  ru: dictionaryOf(["Маппинг", "Весь маппинг редукса", "Поставить весь маппинг", "Весь маппинг стоит", "Часть редукса", "Открыть редукс", "Метаданные района", "Окклюзия", "Дальние огни", "Огни", "Запретки", "Оптимизация", "Метаданные"]),
  uk: dictionaryOf(["Мапінг", "Увесь мапінг редуксу", "Поставити весь мапінг", "Увесь мапінг стоїть", "Частина редуксу", "Відкрити редукс", "Метадані району", "Оклюзія", "Далекі вогні", "Вогні", "Заборонені зони", "Оптимізація", "Метадані"]),
  en: dictionaryOf(["Mapping", "The redux's full mapping", "Install all mapping", "All mapping installed", "Part of the redux", "Open the redux", "District metadata", "Occlusion", "Distant lights", "Lights", "Restricted zones", "Optimization", "Metadata"]),
  de: dictionaryOf(["Mapping", "Das gesamte Mapping des Redux", "Gesamtes Mapping installieren", "Gesamtes Mapping installiert", "Teil des Redux", "Redux öffnen", "Bezirksmetadaten", "Okklusion", "Ferne Lichter", "Lichter", "Sperrzonen", "Optimierung", "Metadaten"]),
  pl: dictionaryOf(["Mapping", "Całe mapowanie reduxa", "Zainstaluj całe mapowanie", "Całe mapowanie zainstalowane", "Część reduxa", "Otwórz redux", "Metadane dzielnicy", "Okluzja", "Dalekie światła", "Światła", "Strefy zakazane", "Optymalizacja", "Metadane"]),
  fr: dictionaryOf(["Mapping", "Tout le mapping du Redux", "Installer tout le mapping", "Tout le mapping est installé", "Partie du Redux", "Ouvrir le Redux", "Métadonnées du quartier", "Occlusion", "Lumières lointaines", "Lumières", "Zones interdites", "Optimisation", "Métadonnées"]),
};

// Язык ищется обычным обращением к объекту: «constructor» и подобные дают значение прототипа.
export const mappingSetWords = (language = "ru") => WORDS[language] ?? WORDS.ru;

export function isMappingPiece(mod) {
  if (!mod || mod.catalogSection !== "redux" || mod.catalogSlot !== "mapping") return false;
  /* «Основа редукса» лежит на полке маппинга (нарочно), но куском маппинга не является: в набор «Весь маппинг редукса» она не входит и свой кусок не рисует. */
  if (isReduxBase(mod)) return false;
  return !isCatalogBundle(mod) && !mod.includedModIds?.length && !mod.domain?.variant;
}

const emptySets = () => ({ members: new Map(), leaderOf: new Map(), owner: new Map() });
const NO_SETS = Object.freeze(emptySets());
const remembered = new WeakMap();

// Наборы по сборкам (ведущий — первый по составу), затем по общему посту (ведущий — первый в списке).
function gatherSets(mods) {
  const byId = new Map(mods.map((mod) => [mod.id, mod]));
  const taken = new Set();
  const owned = mods
    .filter((one) => isCatalogBundle(one) && one.includedModIds?.length)
    .flatMap((bundle) => {
      const pieces = bundle.includedModIds.map((id) => byId.get(id)).filter((one) => one && isMappingPiece(one) && !taken.has(one.id));
      if (pieces.length < 2) return [];
      pieces.forEach((one) => taken.add(one.id));
      return [{ pieces, owner: bundle }];
    });
  const posts = mods
    .filter((one) => isMappingPiece(one) && !taken.has(one.id))
    .reduce((groups, one) => {
      const post = postKeyOf(one);
      return post ? groups.set(post, [...(groups.get(post) ?? []), one]) : groups;
    }, new Map());
  return [...owned, ...[...posts.values()].filter((pieces) => pieces.length > 1).map((pieces) => ({ pieces }))];
}

export function mappingSetsOf(mods) {
  if (!Array.isArray(mods) || mods.length === 0) return NO_SETS;
  if (!remembered.has(mods)) {
    const result = emptySets();
    for (const { pieces, owner } of gatherSets(mods)) {
      const [lead] = pieces;
      result.members.set(lead.id, Object.freeze(pieces));
      for (const one of pieces) result.leaderOf.set(one.id, lead.id);
      if (owner) result.owner.set(lead.id, owner);
    }
    remembered.set(mods, Object.freeze(result));
  }
  return remembered.get(mods);
}

const leaderIdOf = (mod, mods) => mappingSetsOf(mods).leaderOf.get(mod?.id);

export const mappingSetOf = (mod, mods) => {
  const lead = leaderIdOf(mod, mods);
  return lead === undefined ? [] : (mappingSetsOf(mods).members.get(lead) ?? []);
};

export const hiddenMappingPiece = (mod, mods) => {
  const lead = leaderIdOf(mod, mods);
  return lead !== undefined && lead !== mod.id;
};

// ---------- имя куска ----------

// Район и вид: «Cityhills_03_metadata» → район «Cityhills 03», вид metadata; остальные виды — только целиком.
const DISTRICT_KIND = /^(.+?)[_-]*(metadata|occl)$/i;
const PLAIN_KINDS = {
  lodlights: /^lodlightsv?$/i,
  lights: /^lights$/i,
  zapretka: /^(?:\p{L}+[_-])?zapret(?:k[ai])?$/iu,
  optimization: /^optimi[sz]ation$/i,
  meta: /^meta$/i,
};

// Текст куска: содержимое первой пары «…» или имя без ведущего «Маппинг»; подчёркивания — пробелы.
const pieceText = (name) => {
  const [, quoted] = /«([^»]+)»/.exec(name) ?? [];
  return (quoted ?? name.replace(/^маппинг\s+/i, "")).replace(/_/g, " ").replace(/\s{2,}/g, " ").trim();
};

export const mappingPieceWords = (mod, language = "ru") => {
  const name = String(mod?.name || "");
  const text = pieceText(name);
  const key = text.replace(/\s/g, "_");
  const district = DISTRICT_KIND.exec(key);
  const kind = district ? district[2].toLowerCase() : Object.keys(PLAIN_KINDS).find((one) => PLAIN_KINDS[one].test(key));
  if (!kind) return { kind: null, name: text || name };
  const word = mappingSetWords(language).pieces[kind];
  const place = district ? district[1].replace(/_/g, " ").trim() : "";
  return place ? { kind: word, name: place } : { kind: null, name: word };
};
