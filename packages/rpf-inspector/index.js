/*
 * Разбор чужого редукса: что в нём изменено и на какие моды каталога это
 * раскладывается.
 *
 * Пакет намеренно чистый: он не открывает архивы и ничего не пишет на диск.
 * На вход идут два отпечатка, которые строит нативная команда `index-archive`,
 * на выход — находки и спецификации пакетов. Поэтому весь разбор проверяется
 * тестами без игры на машине, а нативная часть отвечает ровно за одно —
 * прочитать архив.
 *
 * Две опоры разбора:
 *
 *   1. авторские контейнеры — папки и `.rpf`, которых нет в чистой игре
 *      (`x64/hls/arena.rpf`); опознаются по содержимому и не зависят от
 *      сборки игры;
 *   2. разница с чистой базой — правки штатных файлов; честна только при
 *      совпадении сборки, иначе сжимается до известных маршрутов с оговоркой.
 *
 * Договор описан в `docs/REDUX-INSPECTOR.md`.
 */

export { diffArchiveIndex, touchedEntries } from "./diff.js";
export {
  assignableCategories,
  classifyChanges,
  recategorizeFinding,
  sortFindings,
  summarizeFindings,
} from "./classify.js";
export {
  changedModifierNames,
  diffModifiers,
  refineByModifiers,
} from "./refine.js";
export {
  FINDING_CATEGORIES,
  NEVER_PUBLISHABLE,
  STRUCTURAL_RULES,
  exactRouteIndex,
  matchStructuralRule,
} from "./rules.js";
export {
  TRACER_TEXTURES,
  buildClothingSpec,
  buildContentLayerSpec,
  buildFamilySpec,
  buildGunpackSpec,
  buildPackageSpec,
  partContainer,
  planExtraction,
  worldFileOk,
  tracerDraft,
} from "./spec.js";
export { FAMILY_KINDS, FAMILY_ORDER, groupFamilies } from "./families.js";
export {
  authorLabelOf,
  classifyContainers,
  findAuthorContainers,
} from "./containers.js";
export { assessBuildMatch } from "./build-match.js";
export {
  CATALOG_PLACEMENT,
  reduxLabel,
  suggestCard,
  suggestPackageId,
  suggestWeaponCard,
} from "./card.js";
export { isKnownWeapon, weaponName, weaponNamesLine } from "./weapon-names.js";
export { CATALOG_WEAPON_SLOTS, describeWeaponSlot } from "./weapon-slots.js";

import { diffArchiveIndex } from "./diff.js";
import {
  classifyChanges,
  sortFindings,
  summarizeFindings,
} from "./classify.js";
import {
  authorLabelOf,
  classifyContainers,
  findAuthorContainers,
} from "./containers.js";
import { assessBuildMatch } from "./build-match.js";

/** Полный разбор одним вызовом: контейнеры, разница, находки. */
export function inspectArchive(baseline, candidate, options = {}) {
  const diff = diffArchiveIndex(baseline, candidate);
  const containers = findAuthorContainers(candidate, baseline, {
    content: candidate.content,
  });
  const buildMatch = assessBuildMatch(diff, baseline, candidate);
  /* Имена чистой игры — по ним контейнер из подменённых штатных объектов
     отличается от маппинга с новыми. */
  const vanillaNames = new Set(
    (baseline.entries || []).map((entry) =>
      String(entry.path || "")
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        .toLowerCase(),
    ),
  );
  const fromContainers = classifyContainers(containers, {
    ...options,
    vanillaNames,
  });
  const fromDiff = classifyChanges(diff, {
    ...options,
    containers,
    buildMatch,
  });
  const findings = sortFindings([
    ...fromContainers.findings,
    ...fromDiff.findings,
  ]);
  return {
    schema: 2,
    baseline: {
      archive: baseline.archive || null,
      sha256: baseline.archiveSha256 || null,
      label: baseline.label || null,
      entries: baseline.entries.length,
    },
    candidate: {
      archive: candidate.archive || null,
      sha256: candidate.archiveSha256 || null,
      label: candidate.label || null,
      entries: candidate.entries.length,
      /* Авторские контейнеры из `content.xml` — прямая улика того, что
         редукс подключает своё, а не только правит игровое. */
      customRpfs: candidate.content?.customRpfs || [],
    },
    totals: diff.totals,
    identical: diff.identical && !containers.some((item) => !item.astral),
    buildMatch,
    containers: containers.map((item) => ({
      path: item.path,
      label: item.label,
      kind: item.kind,
      registered: item.registered,
      astral: item.astral,
      author: item.author,
      files: item.files,
      bytes: item.bytes,
    })),
    skippedContainers: fromContainers.skipped,
    author: authorLabelOf(containers),
    findings,
    summary: summarizeFindings(findings, diff),
  };
}

/* Личность архива — по ней подбирается чистая база. */
export {
  archiveIdentity,
  looksLikeGamePack,
  parseSetupXml,
} from "./identity.js";

/* Таблица оружия: модель, имя в weapons.meta, подраздел каталога, полка. */
export {
  WEAPONS,
  cleanWeaponModel,
  identifyWeaponModel,
  weaponById,
  weaponByModel,
} from "./weapon-identity.js";
export { ATTACHMENTS_SUBCATEGORY } from "./weapon-slots.js";
export { attachmentName, attachmentPartsLine } from "./weapon-names.js";
export { CATALOG_SHELF, gunpackComposition } from "./card.js";

/* Эффекты и трассеры: что автор перерисовал в ядре, привязки следов, кровь. */
export {
  BLANK_TEXTURE_SIDE,
  BLOOD_CLASS_LABELS,
  EFFECT_TEXTURE_KINDS,
  analyzeBloodRouting,
  diffCoreTextures,
  diffTracerBindings,
  effectKindLabel,
  effectTextureKind,
  isHandWeapon,
  readWeaponTracerBindings,
  tracerVisible,
  BLOODFX_ENTRY,
  BLOOD_ROUTING_PAYLOAD,
  bloodRoutingSpec,
} from "./effects.js";
export {
  vegetationGroupsOf,
  vegetationOfFiles,
  vegetationWords,
} from "./vegetation-groups.js";
export {
  effectsSummaryOf,
  effectsSummaryText,
  mergeEffectsSummaries,
} from "./effects-summary.js";

/* Работник очереди заданий (бот, агент, CLI): редуксы без чистой базы. */
export {
  FULL_PACK_ENTRIES,
  claimRedux,
  coverKindsFor,
  createReduxWorker,
  gameIndexOf,
  labelOf,
  titleLabel,
} from "./intake-worker.js";
export { postKey } from "./post-key.js";
