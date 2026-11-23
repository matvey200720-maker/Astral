import { tr } from "../../../../locales/ui.js";
import { trFill } from "../../../../locales/tr-fill.js";

/*
 * Слова режима «часть работы в update.rpf» (GTA 5 RP, 20.11.2026): дороги и растительность через контейнеры (`ASTRAL_ROADS_VIA_UPDATE`, `ASTRAL_VEGETATION_VIA_UPDATE`).
 * Показываются только когда режим включён: главный процесс присылает в ответе плана `viaUpdate`, а отказ режима приходит ошибкой со словом «отказ <код>». Без режима этих
 * полей нет и окно молчит. Шесть языков: записи в `locales/ui-text/zone-rp-update-parts-2011.js` и `fr/`.
 */
const SET_PARTS = Object.freeze({ roads: "дорог", vegetation: "растительности" });

/** Строка о том, что поставится часть работы, или `null` (всё влезло или режим выключен). */
export function viaUpdateNote(set, via) {
  if (!via || typeof via !== "object" || !SET_PARTS[set]) return null;
  const chosen = Array.isArray(via.chosen) ? via.chosen.length : 0;
  const refused = Array.isArray(via.refused) ? via.refused.length : 0;
  const dropped = Array.isArray(via.droppedParts) ? via.droppedParts.length : 0;
  if (!refused && !dropped) return null;
  const key = set === "roads" ? "На GTA 5 RP ставится часть дорог: влезло {0} из {1}, остальное остаётся как в игре." : "На GTA 5 RP ставится часть растительности: влезло {0} из {1}, остальное остаётся как в игре.";
  const text = tr(key).replace("{0}", String(chosen)).replace("{1}", String(chosen + refused));
  return dropped ? `${text} ${tr("Части работы вне цвета пород и групп разметки в этом режиме не помещаются.")}` : text;
}

/*
 * Дороги или растительность уже стоят прежним способом (код `packs-standing`): одна строка на отказ режима и на запасной путь. Как их снять, человеку сказано местом и кнопками, имена берутся из словаря окна:
 * Мастерская → «Дороги» или «Растительность» → кнопка «Ещё» → «Снять из игры» (`useRecolorEditor.jsx`, пункт `rollback`; кнопка `EditorActions.jsx`). Своих переводов кнопок здесь нет.
 */
const STANDING_PACKS = "Дороги или растительность Astral уже установлены прежним способом, поэтому на GTA 5 RP их не видно. Чтобы они там появились, снимите их: {0} → {1} или {2} → «{3}» → «{4}», затем примените заново.";
const standingPacksWords = () => trFill(STANDING_PACKS, tr("Мастерская"), tr("Дороги"), tr("Растительность"), tr("Ещё"), tr("Снять из игры"));
/* Слова строки: ключ словаря или функция, которой нужны имена кнопок. */
const said = (words) => (typeof words === "function" ? words() : tr(words));

/* Откат на прежний пакет при включённом само режиме RP (`apps/desktop/src/rp-fallback.js`): причина → слова, потом общая строка «в сюжете есть, на GTA 5 RP не видно». */
const FALLBACK_REASONS = Object.freeze({
  budget: "Этот готовый вариант пока не помещается в файл игры.",
  global: "Общий цвет, яркость или износ касаются всего сразу, и на GTA 5 RP такая правка пока не помещается.",
  part: "В этой работе есть части, которые на GTA 5 RP пока не ставятся.",
  "packs-standing": standingPacksWords,
  places: "Эти места перекрывают файлы игры, которые на GTA 5 RP пока не ставятся.",
  "no-visible": "Ни один щит этой работы на GTA 5 RP не виден: текстуры этих щитов лежат в файлах игры, которые Astral для GTA 5 RP пока не меняет.",
  other: "Эту работу пока нельзя поставить для GTA 5 RP.",
});

/** Строка о том, что работа ушла в прежний пакет и на GTA 5 RP не видна; `null` — признака нет (режим выключен, контейнер встал). */
export function rpFallbackNote(info) {
  if (!info || typeof info !== "object" || info.container !== false) return null;
  const reason = FALLBACK_REASONS[info.reason] ?? FALLBACK_REASONS.other;
  return `${said(reason)} ${tr("Установлено прежним способом: в сюжетной игре работа есть, на GTA 5 RP её не видно.")}`;
}

/* Код отказа режима → слова человеку (те же коды, что у `apps/desktop/src/rp-fallback.js` и строк журнала дорог, растительности и мест): код, имя файла и числа остаются в журнале `[astral]`, окно их не показывает. */
const REFUSAL_WORDS = [
  [["packs-standing", "carrier-packs-standing"], FALLBACK_REASONS["packs-standing"]],
  [["global-trees", "global-markings"], "Общий цвет, яркость или износ касаются всего сразу и на GTA 5 RP не помещаются: оставьте цвет только отдельным породам или группам."],
  [["parts-unavailable", "part-unavailable"], "На GTA 5 RP ставятся только цвета пород деревьев и групп разметки: такой работы в этом режиме нет."],
  [["over-budget", "nothing-fits", "container-too-big", "carrier-over-budget", "carrier-container-full"], "На GTA 5 RP это не влезает в файлы игры: уберите часть работы или ставьте на обычную GTA."],
  [["overrides", "map-set"], FALLBACK_REASONS.places],
  [["no-visible"], FALLBACK_REASONS["no-visible"]],
];

/** Строка отказа маршрута: «Дороги|Растительность|Места через update.rpf (update2.rpf), отказ <код>: …». */
const ROUTE_REFUSAL = /через update2?.rpf, отказ ([a-z0-9-]+)/;
/** Ошибки чтения файлов игры и пустой сборки того же маршрута (обычные `Error`, без кода отказа). */
const ROUTE_READ_FAILED = /(?:Не прочитана длина|Длина) update2?.rpf/;
const ROUTE_EMPTY_BUILD = /через update2?.rpf: сборка не дала/;
/** Файл другой работы Astral (дорожная копия общего словаря), поверх которой ложится растительность, не читается (`readComposedFile`, `recolor-vegetation.js`): обычная `Error` без кода отказа, в тексте имя файла и метка архива. */
const ROUTE_SHARED_UNREADABLE = /Файл «[^»]*» поставлен другой работой Astral \([^)]*\), но не читается/;

/** Текст ошибки сборки для человека: строка отказа режима RP (код, имя файла, числа) — словами, любая другая — как есть. Для мест, где причина вставляется внутрь предложения («…не собралась заново поверх: …»). */
export const humanRouteMessage = (message) => viaUpdateRefusalText(message) ?? String(message ?? "");

/**
 * Слова человеку вместо журнальной строки отказа режима; `null` — это не ошибка режима. Любой код маршрута получает слова (неизвестный — общие «нельзя поставить для GTA 5 RP»): строка
 * с кодом, именем файла и английскими именами пород до окна не доходит.
 */
export function viaUpdateRefusalText(message) {
  const text = String(message || "");
  if (ROUTE_READ_FAILED.test(text)) return tr("Не удалось прочитать файлы игры для GTA 5 RP: закройте игру, проверьте папку и попробуйте ещё раз.");
  if (ROUTE_EMPTY_BUILD.test(text)) return tr(FALLBACK_REASONS.other);
  if (ROUTE_SHARED_UNREADABLE.test(text) && /: дороги не могут лечь поверх/.test(text)) return tr("Дороги не могут лечь поверх другой работы Astral: её файл в игре не читается. Закройте игру, проверьте папку и попробуйте ещё раз.");
  if (ROUTE_SHARED_UNREADABLE.test(text) && /: эта работа не может лечь поверх/.test(text)) return tr("Эта работа не может лечь поверх другой работы Astral: её файл в игре не читается. Закройте игру, проверьте папку и попробуйте ещё раз.");
  if (ROUTE_SHARED_UNREADABLE.test(text)) return tr("Растительность не может лечь поверх другой работы Astral: её файл в игре не читается. Закройте игру, проверьте папку и попробуйте ещё раз.");
  const hit = ROUTE_REFUSAL.exec(text);
  if (!hit) return null;
  const found = REFUSAL_WORDS.find(([codes]) => codes.includes(hit[1]));
  return said(found ? found[1] : FALLBACK_REASONS.other);
}
