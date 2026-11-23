/*
 * Что уезжает в игру из редактора эффектов.
 *
 * Набор один — след пули, попадания и огонь уходят в игру одним патчем, — а
 * редакторов три, и у каждого своя правка в общем черновике. Прежде
 * «Применить» в любом из них ставило черновик целиком: человек крутил
 * трассер, не применял, уходил в эффекты попадания, нажимал «Применить» там —
 * и в игру уезжали и попадания, и недоделанный трассер, и огонь, которого он
 * не применял (владелец, 23.09.2026).
 *
 * Теперь редактор ставит свою часть из правки, а остальные — такими, какими
 * они стоят в игре: снимок установленного набора хранится в записи установки
 * (`installedProject`). Запись, сделанная до этого правила, снимка не несёт —
 * тогда набор узнаётся по работе в «Моих работах», которую та установка
 * отметила поставленной. Не нашлось и её — в игре непонятно что, и остаётся
 * прежнее поведение: весь черновик. Установки нет вовсе — остальные части
 * пусты, ставить их нечего.
 *
 * Тем же путём библиотека снимает часть набора: «удалить трейсеры» — это
 * набор, какой он стоит в игре, но с пустыми трейсерами (`withoutEffectsParts`).
 * Журналы прошлой установки при этом возвращают стволам штатный след, а
 * bloodfx.dat — штатную кровь, ровно как при «Применить» с выключенной частью.
 */

import {
  IMPACT_ZONES,
  createProject,
  layerNeedsUpload,
  layerPictureKey,
  parseProject,
  serializeProject,
} from "@modovik/ptfx-studio";
import { applyPtfxCustomization } from "../../../api.js";
import { installEditorWork } from "../../../features/workshop/install-queue/tasks/editor-work.js";
import { installedEditorWorkState } from "../../../features/workshop/works/workshop-works.js";
import { installedEffectsParts } from "../../../workshop-library.js";

/* Ключ записи установки набора. Он же — основа ключей очереди: у каждой части
   своё место (`…install.v1:<часть>`), см. EffectsStudio. */
export const EFFECTS_INSTALL_KEY = "astral.effects-studio.install.v1";

export const EFFECTS_PARTS = Object.freeze(["tracer", "impact", "environment"]);

function parsed(candidate) {
  if (!candidate) return null;
  try {
    return parseProject(
      typeof candidate === "string" ? JSON.parse(candidate) : candidate,
    );
  } catch {
    return null;
  }
}

/**
 * Что стоит в игре: `{ project, known }`. `known: false` — установка есть,
 * а какой набор она поставила, узнать не из чего.
 */
export function installedEffects(record, storage = globalThis.localStorage) {
  if (!record?.restorePointId)
    return { project: parseProject(createProject()), known: true };
  const project =
    parsed(record.installedProject) ||
    parsed(installedEditorWorkState("effects", storage));
  return project ? { project, known: true } : { project: null, known: false };
}

/**
 * Набор для установки из редактора части `part`: она — из правки, остальные —
 * как стоят в игре. Имя — из правки: под ним работа ляжет в «Мои работы».
 */
export function composeEffectsInstall({ draft, installed, part }) {
  const own = serializeProject(draft);
  if (!installed?.known || !installed.project) {
    /* Выстрел стволов правят в студии ствола (часть `muzzle`); черновик
       остальных частей она не трогает — ставится только её часть. */
    if (part !== "muzzle") return own;
    const blank = serializeProject(createProject(own.name));
    return own.muzzle ? { ...blank, muzzle: own.muzzle } : blank;
  }
  const base = serializeProject(installed.project);
  const { muzzle: _ownMuzzle, ...rest } = base;
  /* Часть без записи в каноническом виде (нет своих вспышек) — пустая. */
  if (part === "muzzle")
    return own.muzzle
      ? { ...rest, name: own.name, muzzle: own.muzzle }
      : { ...rest, name: own.name };
  return { ...base, name: own.name, [part]: own[part] };
}

/**
 * Отличается ли часть правки от стоящей в игре: «Применить» без отличий
 * переставило бы то же самое.
 */
export function partDiffers({ draft, installed, part }) {
  if (!installed?.known || !installed.project) return true;
  return (
    JSON.stringify(serializeProject(draft)[part] ?? null) !==
    JSON.stringify(serializeProject(installed.project)[part] ?? null)
  );
}

/**
 * Слои попаданий, которым нужна картинка человека: без неё набор не собрать.
 * Картинки не часть проекта — они лежат рядом (`effects-stamp.js`) под
 * ключом «зона:слой».
 */
export function uploadLayers(project) {
  if (!project?.impact?.enabled) return [];
  /* «Убрать совсем»: слои спрятаны и в игру не едут — картинки им не нужны. */
  if (project.impact.removeAll === true) return [];
  const keys = [];
  for (const zone of IMPACT_ZONES) {
    const settings = project.impact.zones[zone.id];
    if (!settings?.enabled) continue;
    settings.layers.forEach((layer, index) => {
      if (layerNeedsUpload(layer))
        keys.push({ zone: zone.id, label: zone.label, layer: index });
    });
  }
  return keys;
}

const uploadKeys = (project) =>
  uploadLayers(project).map((item) => layerPictureKey(item.zone, item.layer));

/**
 * Набор без частей `parts`: они возвращаются к пустому старту. Выстрел
 * стволов (вспышки, дым, гильзы) живёт на карточке трейсеров — снятие
 * трейсеров снимает и его.
 */
export function withoutEffectsParts(project, parts) {
  const base = serializeProject(project);
  const blank = serializeProject(createProject(base.name));
  const next = {
    ...base,
    ...Object.fromEntries(
      parts
        .filter((part) => part !== "muzzle")
        .map((part) => [part, blank[part]]),
    ),
  };
  if (parts.includes("tracer") || parts.includes("muzzle")) delete next.muzzle;
  return next;
}

/**
 * Можно ли пересобрать стоящий набор без частей `parts` — и чем он станет.
 *
 *   `ready`    — набор известен, картинки на месте: в игру уедет `set`, в нём
 *                останутся части `keep`;
 *   `empty`    — без этих частей в наборе ничего не остаётся: его снимают
 *                целиком, обычным удалением точки отката;
 *   `unknown`  — что стоит в игре, узнать не из чего: по частям не снять;
 *   `pictures` — картинки попаданий, стоящие в игре, не найдены или заменены
 *                после установки (`missing` — их ключи): собрать заново то же
 *                самое нечем;
 *   `gone`     — набора в игре уже нет.
 *
 * @param {{ record: object|null, parts: string[], pictures?: object }} input
 */
export function planEffectsWithout({ record, parts, pictures = {} }) {
  if (!record?.restorePointId) return { status: "gone", keep: [] };
  const installed = installedEffects(record);
  if (!installed.known || !installed.project)
    return { status: "unknown", keep: [] };
  const set = withoutEffectsParts(installed.project, parts);
  const keep = installedEffectsParts(set);
  if (!keep.length) return { status: "empty", set, keep };
  const shipped = record.installedPictures || {};
  const missing = uploadKeys(set).filter(
    (key) =>
      !pictures[key]?.base64 ||
      (shipped[key] && pictures[key].key !== shipped[key]),
  );
  if (missing.length) return { status: "pictures", set, keep, missing };
  return { status: "ready", set, keep };
}

/**
 * Поставить набор эффектов целиком: `set` — что уедет, `record` — запись
 * прежней установки, какой она лежит на момент записи в игру.
 *
 * Картинки слоёв едут отдельно от проекта: проект — это то, что человек
 * сохраняет файлом, и двоичному в нём не место. Готовые значки не едут
 * вовсе: приложение собирает их из тех же контуров, что рисует окно.
 */
export function installEffectsSet({
  set,
  record,
  pictures = {},
  gameRoot,
  report = null,
}) {
  const keys = uploadKeys(set);
  const impactImages = Object.fromEntries(
    keys
      .filter((key) => pictures[key]?.base64)
      .map((key) => [key, pictures[key].base64]),
  );
  const pictureKeys = Object.fromEntries(
    keys
      .filter((key) => pictures[key]?.key)
      .map((key) => [key, pictures[key].key]),
  );
  const previousBlood = record?.bloodJournal || null;
  const previousTracers = record?.tracerJournal || null;
  return installEditorWork({
    editor: "effects",
    storageKey: EFFECTS_INSTALL_KEY,
    state: set,
    report,
    /* Установка сама собирает файлы, проверяет патч нативным хостом и только
       потом пишет в игру. Отдельный план перед ней собирал бы всё то же
       второй раз — полминуты ожидания, после которых ничего не меняется. */
    apply: () =>
      applyPtfxCustomization({
        gameRoot,
        project: set,
        impactImages,
        /* Журнал прошлой установки: по нему приложение снимает прежнюю правку
           bloodfx.dat перед новой — выключенная зона обязана вернуться к
           штатной крови. */
        ...(previousBlood ? { previousBlood } : {}),
        /* Журнал оружия: стволы, с которых трассер сняли, получают свой след
           обратно. */
        ...(previousTracers ? { previousTracers } : {}),
      }),
    details: (result) => ({
      files: result?.files?.length || 0,
      ...(result?.bloodJournal ? { bloodJournal: result.bloodJournal } : {}),
      ...(result?.tracerJournal ? { tracerJournal: result.tracerJournal } : {}),
      /* Вспышки выстрела: ствол, клон и штатная вспышка-донор. */
      ...(result?.muzzles?.length ? { muzzles: result.muzzles } : {}),
      /* Что стоит в игре после этой установки: по нему соседние редакторы
         собирают следующую, не трогая чужую правку. */
      installedProject: set,
      installedPictures: pictureKeys,
    }),
  });
}
