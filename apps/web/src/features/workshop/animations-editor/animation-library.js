/*
 * Список анимаций окна «Анимации» (ТЗ 29.10.2026-d): разделы, поиск, номера, отбор по источнику. Чистые функции без окна и
 * без чтения игры — список приходит готовым из главного процесса (`apps/desktop/src/animations/animation-index.js`).
 */

import { tr } from "../../../locales/ui.js";

/** Разделы выдачи — те же, что у главного процесса (`animation-catalog.js`). */
/* `other` — клипы не-человека (предметы, камеры): в «Все» и в эмоции не идут, лежат в своём разделе (14.11.2026). */
export const SECTION_IDS = Object.freeze([
  "emotes",
  "dances",
  "gestures",
  "scenarios",
  "rest",
  "poses",
  "other",
]);

/** Русская строка словаря, переводится при выводе: имя раздела для сетки и фильтра. */
const SECTION_NAMES = Object.freeze({
  all: "Все разделы",
  emotes: "Эмоции",
  dances: "Танцы",
  gestures: "Жесты",
  scenarios: "Сценарии",
  rest: "Сидеть и лежать",
  poses: "Позы",
  other: "Предметы и камеры",
  own: "Свои файлы",
});

/*
 * Проекты как источник (14.11.2026): словари анимаций серверов, список приходит из главного процесса по индексу, файлы качаются по требованию. Это отдельные разделы слева —
 * «GTA 5 RP» и «Nova RP» (имена собственные, на всех языках одни); в «Все» и в разделы игры они не входят, чтобы две с половиной тысячи записей не мешали сетке игры.
 */
export const PROJECT_SECTIONS = Object.freeze([
  "project:gta5rp",
  "project:novarp",
]);
const PROJECT_NAMES = Object.freeze({
  "project:gta5rp": "GTA 5 RP",
  "project:novarp": "Nova RP",
});

/** Запись из словаря проекта, а не игры и не своего файла. */
export const isProject = (entry) =>
  String(entry?.source || "").startsWith("project:");

export const sectionName = (id) =>
  PROJECT_NAMES[id] || tr(SECTION_NAMES[id] || SECTION_NAMES.emotes);

/** Русская строка раздела для колонки слева (её переводит сама колонка, `EditorToolRail`): «Все» вместо «Все разделы» — колонка и так о разделах. */
export const sectionLabel = (id) =>
  id === "all"
    ? "Все"
    : PROJECT_NAMES[id] || SECTION_NAMES[id] || SECTION_NAMES.emotes;

/**
 * Что это такое — одним словом, в единственном числе: подпись на самой карточке и под фигурой в окне проигрывания («Эмоция Air Drums»). Раздел — это
 * куда сложены (множественное, для фильтра), вид — что перед глазами. Русская строка словаря, переводится при выводе.
 */
const KIND_NAMES = Object.freeze({
  emotes: "Эмоция",
  dances: "Танец",
  gestures: "Жест",
  scenarios: "Сценарий",
  rest: "Отдых",
  poses: "Поза",
  other: "Предмет",
});

export const kindName = (section) =>
  tr(KIND_NAMES[section] || KIND_NAMES.emotes);

/*
 * Парные анимации (14.11.2026): двое персонажей — обнимашки, поцелуи, «совместный танец», пара словарей `..._male` / `..._female`. Окно рисует одного персонажа,
 * поэтому такой клип подписан «парная, показан один»: второй герой — в другом клипе или словаре. Признак — слово в имени словаря или клипа; те же слова у группы «Парные»
 * описи дампов (`scripts/server-dump/animations-report.mjs`). Второй персонаж на сцене не рисуется: общего начала двух клипов в просмотре нет (`docs/server-dumps/anim-preview.md`).
 */
/* Слова-приставки: целое слово (`hug`, `pairs`) или начало слова, где это безопасно (`kissfemale8`, `couple1`). Та же таблица — у главного процесса, `apps/desktop/src/animations/pair-words.js`;
   общий список примеров — `tests/fixtures/pair-names.json` (проверяют обе копии). */
const PAIR_EXACT = new Set([
  "couple",
  "couples",
  "cpl",
  "pair",
  "pairs",
  "hug",
  "hugs",
  "hugging",
  "handshake",
  "handshakes",
  "highfive",
  "embrace",
  "propose",
  "proposal",
]);
const PAIR_PREFIX = /^(kiss|couple|cpl|handshake|highfive|embrace)/;
const nameWords = (text) =>
  String(text || "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

/** Парная ли по словам имени словаря и клипа: слова по границам частей, а не подстроки («Blow Kiss», `thug`, `huge`, `clover` парными не считаются). */
export function isPairedName(dictionary, clip = "") {
  const words = nameWords(`${dictionary} ${clip}`);
  return words.some((word, at) => {
    if (word === "kiss" && words[at - 1] === "blow") return false;
    if (word === "high" && words[at + 1] === "five") return true;
    return PAIR_EXACT.has(word) || PAIR_PREFIX.test(word);
  });
}

/** Парная ли запись: у записей проектов — флаг `paired` из главного процесса (он считает теми же словами), у игры и своих файлов — по словам имени. */
export const isPairedEntry = (entry) =>
  isProject(entry)
    ? Boolean(entry.paired)
    : isPairedName(entry?.dictionary, entry?.clip);

/** Дольше этого клип заранее не читается: сборка дорожки — секунды работы движка, а наведение мыши — не выбор. */
export const WARM_MAX_SECONDS = 16;

/** Можно ли читать дорожку записи заранее (соседи выбранной, плитка под курсором). Нельзя записям проектов (чтение — это скачивание словаря) и клипам длиннее 16 с: такие читаются только по выбору (ревью 14.11, п. 12). */
export const canWarm = (entry) =>
  !isProject(entry) && !(Number(entry?.seconds) > WARM_MAX_SECONDS);

/** Вид записи для карточки и окна: у парной — с пометкой, что показан один из двоих («Эмоция · парная, показан один»). */
export const kindLabel = (entry) =>
  isPairedEntry(entry)
    ? `${kindName(entry?.section)} · ${tr("парная, показан один")}`
    : kindName(entry?.section);

/** Свой файл, а не анимация игры. */
export const isOwn = (entry) => String(entry?.source || "").startsWith("own");

/** Номер в меню — место в общем списке: «Название или номер» ищут и по числу. */
export function numberEntries(entries) {
  return entries.map((entry, index) => ({ ...entry, number: index + 1 }));
}

const tokensOf = (text) =>
  String(text || "")
    .toLowerCase()
    .split(/[\s·_@.-]+/)
    .filter(Boolean);

/**
 * Отбор для сетки: раздел (`all`, раздел или `own` — только свои файлы) и поиск. Поиск — по словам названия, по словарю и
 * клипу и по номеру; каждое слово запроса должно найтись, порядок любой.
 */
export function filterAnimations(
  entries,
  { section = "all", query = "" } = {},
) {
  const words = tokensOf(query);
  const inProject = Boolean(PROJECT_NAMES[section]);
  return entries.filter((entry) => {
    /* Записи проектов видны только в своих разделах (весь проект одним списком); в остальных — игра и свои файлы, как было. */
    if (isProject(entry) !== inProject) return false;
    if (inProject) {
      if (entry.source !== section) return false;
    } else {
      /* Клип предмета или камеры — не эмоция: в «Все» его нет, смотреть его можно в разделе «Предметы и камеры». */
      if (section === "all" && entry.section === "other") return false;
      if (
        section === "own"
          ? !isOwn(entry)
          : section !== "all" && entry.section !== section
      )
        return false;
    }
    if (!words.length) return true;
    const haystack =
      `${entry.name} ${entry.dictionary} ${entry.clip} ${entry.number}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Сколько анимаций в каждом разделе (`own` — своих файлов) — подписи в выпадающем списке. */
export function sectionCounts(entries) {
  const counts = { all: 0, own: 0 };
  for (const entry of entries) {
    if (isProject(entry)) {
      counts[entry.source] = (counts[entry.source] || 0) + 1;
      continue;
    }
    if (entry.section !== "other") counts.all += 1;
    counts[entry.section] = (counts[entry.section] || 0) + 1;
    if (isOwn(entry)) counts.own += 1;
  }
  return counts;
}

/** Какие разделы показывать (колонка слева, 02.11.2026): «Все», непустые разделы, «Свои файлы» — только когда они есть. */
export function sectionIds(counts) {
  return [
    "all",
    ...SECTION_IDS.filter((id) => counts[id]),
    ...(counts.own ? ["own"] : []),
    ...PROJECT_SECTIONS.filter((id) => counts[id]),
  ];
}

/** Те же разделы строками «имя · число»: пустые не показываются, «Свои файлы» — только когда они есть. */
export function sectionOptions(counts) {
  return sectionIds(counts).map((id) => [
    id,
    `${sectionName(id)} · ${counts[id] ?? 0}`,
  ]);
}

/** Описание записи для запроса к главному процессу: только то, что нужно, чтобы найти клип. */
export function entryRequest(entry) {
  return {
    id: entry.id,
    source: entry.source,
    dictionary: entry.dictionary,
    clip: entry.clip,
    ...(entry.archive ? { archive: entry.archive, entry: entry.entry } : {}),
    ...(entry.file ? { file: entry.file } : {}),
    /* Словарь проекта качается по хэшу из описи, пути в запросе нет. */
    ...(entry.sha256 ? { sha256: entry.sha256, bytes: entry.bytes } : {}),
  };
}
