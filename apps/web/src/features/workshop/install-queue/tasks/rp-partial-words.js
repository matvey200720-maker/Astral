import { tr } from "../../../../locales/ui.js";

/*
 * Частичный случай режима RP (21.11.2026): часть работы легла контейнером, часть нет. Главный процесс присылает в плане `viaUpdate` (`chosen`, `refused`, `droppedParts` —
 * `roads-update-install.js`, `vegetation-update-install.js`); здесь они становятся словами «На GTA 5 RP видно: …. Не видно: ….» названиями из самой мастерской
 * (группы разметки, части дорог, породы), без внутренних кодов. Список длиннее пяти обрезается: «… и ещё N». Шесть языков: `locales/ui-text/zone-rp-partial-2111.js` и `fr/`.
 *
 * Названия берутся из модулей мастерской по требованию (`import()`): ни словарь, ни тяжёлые модули не попадают в главный кусок окна.
 * Места частью (арена, 21.11.2026): группы называет `arena-rp-parts.js` (главный процесс присылает их id), названия — в `rp-places-groups.js` по требованию; словарь — `locales/ui-text/zone-rp-arena-2111.js` и `fr/`.
 */
const SHOWN = 5;

/** Список названий через запятую, не больше `SHOWN`, остаток — «и ещё N» (число без падежей: слово стоит перед ним). */
function listText(names) {
  const shown = names.slice(0, SHOWN).join(", ");
  return names.length > SHOWN ? `${shown} ${tr("и ещё {0}").replace("{0}", String(names.length - SHOWN))}` : shown;
}

async function labelersOf(set) {
  if (set === "roads") {
    const { ROAD_MARKING_GROUPS, ROAD_PARTS } = await import("@modovik/climb-contract/recolor/roads");
    return {
      group: (id) => ROAD_MARKING_GROUPS.find((item) => item.id === id)?.label || "",
      part: (id) => ROAD_PARTS.find((item) => item.id === id)?.label || "",
    };
  }
  if (set === "vegetation") {
    const { speciesLabel: workshopSpeciesLabel } = await import("../../vegetation-editor/species-art.js");
    /* Породы без своего названия в мастерской (кедры лежат у сосен, эвкалипты и ивы не названы) — свои слова: без них «видно / не видно» пропадали целиком, и окно говорило общей строкой с числами (21.11.2026, ветка j3/rp-words-human). */
    const OTHER_SPECIES = { cedar: "Кедры", eucalyptus: "Эвкалипты", willow: "Ивы" };
    const speciesLabel = (id) => workshopSpeciesLabel(id) || OTHER_SPECIES[id] || "";
    /* Единицы носителя и общего цвета (21.11.2026): деревья общим набором, трава по зонам, живые изгороди, цветы; части, что остались «как в игре». Названия — слова мастерской (словарь `zone-rp-partial-2111.js`). */
    const UNITS = { "global-colour": "Деревья", "grass-city": "Трава в городе", "grass-country": "Трава за городом", bushes: "Кусты своим цветом", hedges: "Живые изгороди", flowers: "Цветы" };
    const PARTS = { sandy: "Трава", flowers: "Цветы", hedges: "Живые изгороди", bushes: "Кусты своим цветом", improved: "Улучшенные деревья", forest: "Лес", density: "Густота посадки", variety: "В разнобой" };
    /* Деревья по породам (ступень 2, 21.11.2026): единица `tree-<порода>` — название породы. */
    return { group: (id) => UNITS[id] || speciesLabel(String(id).startsWith("tree-") ? String(id).slice(5) : id), part: (id) => PARTS[id] || "" };
  }
  /* Места, что едут частью (арена и др.): названия групп — в своём модуле по требованию, в главный кусок окна он не входит. */
  const { placesGroupLabel } = await import("./rp-places-groups.js");
  const label = placesGroupLabel(set);
  return label ? { group: label, part: () => "" } : null;
}

/**
 * Слова частичного случая или `null`: режим выключен, всё влезло, вид без частичного случая (места едут целиком или отказом), неизвестное имя группы
 * (не выдумываем — остаются прежние слова с числами, `viaUpdateNote`).
 */
export async function rpPartialNote(set, via) {
  if (!via || typeof via !== "object") return null;
  /* Билборды (21.11.2026): «видно N из M щитов» — число щитов работы, а не названия групп; слова зависят от числа и языка, поэтому функцией (`rp-billboards-copy.js`, по требованию). Все щиты видны — говорить нечего. */
  if (set === "billboards") {
    const { seen, total, limited } = via.shields || {};
    if (!Number.isInteger(seen) || !Number.isInteger(total) || seen >= total) return null;
    const [{ billboardsRpWords }, { currentUiLanguage }] = await Promise.all([import("./rp-billboards-copy.js"), import("../../../../locales/ui.js")]);
    return billboardsRpWords(currentUiLanguage(), seen, total, Number.isInteger(limited) ? limited : 0) || null;
  }
  const chosen = Array.isArray(via.chosen) ? via.chosen : [];
  const refused = Array.isArray(via.refused) ? via.refused : [];
  const dropped = Array.isArray(via.droppedParts) ? via.droppedParts : [];
  if (!chosen.length || (!refused.length && !dropped.length)) return null;
  const labelers = await labelersOf(set);
  if (!labelers) return null;
  const seen = chosen.map((id) => labelers.group(id));
  const hidden = refused.map((item) => labelers.group(item?.id));
  /* Снятые части называются у дорог и у растительности; у растительности неназванная часть оставляет прежнюю общую фразу. */
  /* Часть «трава» (sandy) остаётся в снятых, когда не влезла одна из зон (`grass-country`, `grass-city`): зона уже названа в «Не видно», общее слово «Трава» рядом её дублирует (замечание j3). */
  const zoneRefused = set === "vegetation" && refused.some((item) => String(item?.id).startsWith("grass-"));
  const droppedNames = dropped.filter((id) => !(zoneRefused && id === "sandy")).map((id) => labelers.part(id));
  const namedAll = droppedNames.every(Boolean);
  if (set === "roads" ? !namedAll : false) return null;
  if ([...seen, ...hidden].some((name) => !name)) return null;
  if (set !== "roads") for (let index = droppedNames.length - 1; index >= 0; index -= 1) if (!droppedNames[index]) droppedNames.splice(index, 1);
  /* Одно название — один раз: единица, что не влезла (`refused`), и та же часть работы «как в игре» (`droppedParts`: цветы, изгороди) не должны стоять в «Не видно» дважды. */
  const notSeen = [...new Set([...hidden, ...droppedNames].map((name) => tr(name)))];
  if (!notSeen.length) return null;
  const text = tr("На GTA 5 RP видно: {0}. Не видно: {1}.")
    .replace("{0}", listText(seen.map((name) => tr(name))))
    .replace("{1}", listText(notSeen));
  return set !== "roads" && dropped.length && !namedAll ? `${text} ${tr("Части работы вне цвета пород и групп разметки в этом режиме не помещаются.")}` : text;
}
