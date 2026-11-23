/*
 * Облик вещей места в файлах (ТЗ 27.10.2026, «Предметы»: своя модель, цвет, своя картинка у вещи места — как у вещей зала арены, `recolor-arenas.js`).
 *
 * Вещь места — запись сущности в карте района игры; общий файл её модели (один на всю карту) не правится. У вещи со своим обликом:
 *
 *   • своя копия модели под именем `astral_<набор>_item_<номер группы>` — «Цвет»: файл модели игры (`.ydr` или `.yft`) с перекрашенными встроенными
 *     листами и свой словарь `.ytd` с общими листами (`buildPaintedCopy`); «Своя модель» и «Своя картинка» (только рисуемая модель, `.ydr`): своя
 *     сетка, вписанная в рамку прежней (`compileFittedModel`), на основе файла прежней модели — коллизия остаётся прежней (`keepOriginalCollision`);
 *   • архетип копии — клон архетипа вещи в постоянных типах места (`localizePlaceFiles`: \`plan.clones\`, \`compile-place-types\`);
 *   • сущность вещи в карте района встаёт на копию (\`repointPlaceEntities\`: по архетипу и месту).
 *
 * Картинка на элементах (\`kind: "elements"\`, владелец 31.10.2026) — как «Цвет»: байтовая копия файла модели (\`.ydr\` или \`.yft\`), листы элементов
 * переписаны своей картинкой по развёртке (\`buildPaintedCopy\` с \`elements\`); верх картинки — по первой вещи группы, как в кадре.
 *
 * Облик на часть модели (\`part\`, ТЗ 29.10.2026) — как у вещей зала (\`buildPartCopy\`): копия — прежняя модель без треугольников частей и облик каждой
 * части, пересаженный в неё; несколько частей одной вещи — одна копия (\`placeItemCopies\`).
 *
 * Здесь — копии и записи для них: файлы, клоны плана и сущности; ставит их \`recolor-customizer.js\` рядом с изоляцией места.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PLACE_ITEM_GROUP_LIMIT, placeItemCopies, placeItemCopyName, placeItemFrame, placeItemPlace, placeItemSource } from "@modovik/climb-contract/recolor/place-item-looks";
import { joaatName } from "./place-isolation.js";
import { buildPaintedCopy, buildPartCopy, compileFittedModel, keepOriginalCollision } from "./recolor-arenas.js";

const ITEM_SHEET_SIDE = 512;
const REFUSAL_NO_FILE = "Файла модели «{0}» нет в вашей игре — облик этой вещи не поставить: файлы игры не той версии.";

/**
 * Копии вещей места. \`items\` — группы работы (\`[{ keys, kind, colour?, model, scale, turn }]\`); \`modelOf(номер)\` — модель вещи, \`worldOf(номер)\` — её место в
 * мире \`[x, y, z]\`; \`sources\` — картинки и сетки своих моделей из окна (\`decodePlaceModelImages\`); \`game.read(адрес)\` — файлы игры.
 * \`{ files, clones, entities, report }\`: \`files\` — копии моделей под именами \`<копия>_src.<вид>\` (клон переименует их в \`<копия>.<вид>\`) и словари \`<копия>.ytd\`;
 * \`clones\` — записи для \`plan.clones\`; \`entities\` — что поставить на копии в картах.
 */
export async function buildPlaceItemCopies({ setId, items, modelOf, worldOf, game, compile, stateDir, sources }) {
  const out = { files: [], clones: [], entities: [], report: { groups: 0, painted: 0, replaced: 0, kept: 0, parts: 0, elements: 0, fallback: [] } };
  if (!items?.length) return out;
  if (typeof compile !== "function") throw new Error("Сборщик копий вещей места не подключён — обновите Astral.");
  if (!game) throw new Error("Облик вещей места собирается из файлов вашей игры — подключите GTA V и нажмите «Применить» ещё раз.");
  const readAt = (at) => game.read(at).catch(() => null);
  const staging = path.join(stateDir || ".", "recolor", setId, "items", randomUUID());
  try {
    /* Копии: облик на всю модель — копия на группу; облик по частям — копия на набор частей вещи. */
    const copies = placeItemCopies(items);
    if (copies.length > PLACE_ITEM_GROUP_LIMIT) throw new Error(`Разных обликов у вещей места — ${copies.length}, больше ${PLACE_ITEM_GROUP_LIMIT}: верните часть вещей или частей к игре.`);
    for (const [copyIndex, copy] of copies.entries()) {
      const group = items[copy.group ?? copy.parts[0]];
      const model = modelOf(copy.keys[0]);
      const source = placeItemSource(setId, model);
      const frame = placeItemFrame(setId, model);
      if (!source || !frame) throw new Error(REFUSAL_NO_FILE.replace("{0}", model));
      const name = placeItemCopyName(setId, copyIndex);
      const work = path.join(staging, name);
      let painted = !copy.parts.length && group.kind === "colour" && group.colour ? await buildPaintedCopy({ name, colour: group.colour, source: [source.at, source.txd], readAt, work, compile, kind: source.kind }) : null;
      let bytes = null;
      if (!copy.parts.length && group.kind === "elements") {
        /* Картинка на элементах: копия файла модели с её сеткой, шейдерами и коллизией; листы элементов — своей картинкой по развёртке. */
        const built = await buildPaintedCopy({
          name,
          colour: null,
          source: [source.at, source.txd],
          readAt,
          work,
          compile,
          kind: source.kind,
          elements: group.elements,
          pictures: sources?.pictures,
          place: placeItemPlace(setId, copy.keys[0]),
        });
        if (!built) throw new Error(REFUSAL_NO_FILE.replace("{0}", model));
        const [main, ...rest] = built.files;
        bytes = main.bytes;
        out.files.push(...rest);
        out.report.elements += group.elements.length;
      } else if (copy.parts.length) {
        if (source.kind !== "ydr") throw new Error(REFUSAL_NO_FILE.replace("{0}", model));
        const built = await buildPartCopy({ name, parts: copy.parts.map((index) => items[index]), modelName: model, frame, source: [source.at, source.txd], readAt, sources, compile, work });
        const [main, ...rest] = built.files;
        bytes = main.bytes;
        out.files.push(...rest);
        out.report.parts += copy.parts.length;
      } else if (painted) {
        out.report.painted += 1;
        const [main, ...rest] = painted.files;
        bytes = main.bytes;
        out.files.push(...rest);
      } else {
        /* Одноцветная сетка, своя модель или картинка — только у рисуемой модели: у фрагмента архетип другого вида, собранная рисовалка им не загрузится. */
        if (source.kind !== "ydr") throw new Error(REFUSAL_NO_FILE.replace("{0}", model));
        const built = await compileFittedModel({ name, model: group.model, bounds: frame, entry: group, sources, compile, work: path.join(work, "fit"), label: group.model.label || group.model.name || model, side: ITEM_SHEET_SIDE });
        const kept = await keepOriginalCollision({ name, built: built.bytes, source: [source.at], readAt, work: path.join(work, "collision"), compile });
        bytes = kept ? kept.bytes : built.bytes;
        if (group.kind === "colour") out.report.fallback.push(model);
        else out.report.replaced += 1;
        if (kept) out.report.kept += 1;
        painted = null;
      }
      out.report.groups += 1;
      out.files.push({ name: `${name}_src.${source.kind}`, bytes });
      const dictionary = out.files.some((file) => file.name === `${name}.ytd`) ? name : null;
      out.clones.push({
        archetype: source.archetype >>> 0,
        archetypeName: model,
        ytyp: source.ytyp,
        assetType: source.assetType,
        model: `${name}_src.${source.kind}`,
        name,
        ...(dictionary ? { textureDictionary: dictionary } : {}),
        entities: [],
      });
      for (const key of copy.keys) out.entities.push({ archetype: source.archetype >>> 0, position: worldOf(key), to: joaatName(name) });
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  return out;
}
