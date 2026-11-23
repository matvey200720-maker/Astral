import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { sha256File } from "./manifest.js";

/*
 * Коллекции наложений педа (`*_overlays.xml`) — стратегия объединения
 * `decoration-overlay-v1` (ТЗ 06.10.2026, вечер, задача 3: место тату).
 *
 * Тату игры лежит на теле там, где его ставит коллекция: зона, `uvPos`,
 * `scale`, `rotation`. Мастерская переносит тату под рисунок, переписывая
 * эти поля у выбранных тату. Пакет несёт файл коллекции целиком (собран
 * приложением из файла игрока) и список своих тату — `includeNames`
 * (`nameHash` наложений). Слоёв на одной записи бывает несколько — работы
 * разных людей и разных тату: нижний документ — основа, у каждого верхнего
 * в итог идут только его тату, по возрастанию приоритета и порядку слоёв.
 * Одиночный слой — его файл как есть.
 */

export {
  DECORATION_NAME_PATTERN,
  DECORATION_OVERLAY_ENTRY_PATTERN,
  DECORATION_OVERLAY_STRATEGY,
} from "./decoration-overlay-shape.js";

const ITEM = /<Item(?:\s[^>]*)?>[\s\S]*?<\/Item>/g;

const nameOf = (block) => {
  const match = /<nameHash>\s*([^<]*?)\s*<\/nameHash>/.exec(block);
  return match ? match[1].toLowerCase() : "";
};

/** Блоки `<Item>` раздела `<presets>`: `{ start, end, name, text }`. */
export function decorationItems(xml) {
  const presets = /<presets\s*>([\s\S]*?)<\/presets>/.exec(xml);
  if (!presets) return { items: [], presetsEnd: -1 };
  const offset = presets.index + presets[0].indexOf(">") + 1;
  const items = [];
  for (const match of presets[1].matchAll(ITEM)) {
    const start = offset + match.index;
    items.push({ start, end: start + match[0].length, name: nameOf(match[0]), text: match[0] });
  }
  const presetsEnd = presets.index + presets[0].lastIndexOf("</presets>");
  return { items, presetsEnd };
}

/**
 * Объединяет документы `[{ xml, priority, includeNames, index }]`: основа —
 * первый по порядку, у остальных — только их наложения.
 */
export function mergeDecorationOverlayXml(documents) {
  const ordered = [...documents].sort(
    (left, right) => (left.priority ?? 0) - (right.priority ?? 0) || (left.index ?? 0) - (right.index ?? 0),
  );
  if (!ordered.length) throw new Error("Нет слоёв коллекции наложений.");
  let result = String(ordered[0].xml);
  for (const document of ordered.slice(1)) {
    const wanted = new Set((document.includeNames || []).map((name) => String(name).toLowerCase()));
    if (!wanted.size) continue;
    const donors = new Map(
      decorationItems(String(document.xml))
        .items.filter((item) => wanted.has(item.name))
        .map((item) => [item.name, item.text]),
    );
    for (const [name, text] of donors) {
      const { items, presetsEnd } = decorationItems(result);
      const present = items.find((item) => item.name === name);
      if (present) result = result.slice(0, present.start) + text + result.slice(present.end);
      else if (presetsEnd >= 0) result = `${result.slice(0, presetsEnd)}  ${text}\n  ${result.slice(presetsEnd)}`;
    }
  }
  return result;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Собранный файл записи из слоёв — в хранилище составных, по отпечатку слоёв. */
export async function materializeDecorationOverlayComposite({
  layers,
  entry,
  targetKey,
  payloadsRoot,
  resolveLayerSource,
}) {
  const lastBaseIndex = layers.findLastIndex(
    (layer, index) => index < layers.length - 1 && (!layer.merge || layer.action === "delete"),
  );
  const compositionLayers = layers
    .slice(Math.max(0, lastBaseIndex))
    .filter((layer) => layer.action !== "delete" && layer.cachePath);
  /* Один слой — его файл как есть: собирать нечего, а хеш записи совпадает
     с хешем пакета (по нему узнаёт свою запись уборка основы). */
  if (compositionLayers.length === 1) {
    const only = resolveLayerSource(compositionLayers[0].cachePath);
    if (compositionLayers[0].sha256 && (await sha256File(only)) !== compositionLayers[0].sha256)
      throw new Error(`Payload коллекции наложений повреждён: ${entry}`);
    return only;
  }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        entry,
        layers: compositionLayers.map((layer, index) => ({
          sha256: layer.sha256,
          priority: layer.merge?.priority ?? 0,
          includeNames: layer.merge?.includeNames || null,
          index,
        })),
      }),
    )
    .digest("hex");
  const source = path.join(payloadsRoot, "_decoration-composites", targetKey, `${fingerprint}.xml`);
  if (await exists(source)) return source;
  const documents = [];
  for (const [index, layer] of compositionLayers.entries()) {
    const cachePath = resolveLayerSource(layer.cachePath);
    if (!(await exists(cachePath))) throw new Error(`Payload коллекции наложений недоступен: ${entry}`);
    if (layer.sha256 && (await sha256File(cachePath)) !== layer.sha256)
      throw new Error(`Payload коллекции наложений повреждён: ${entry}`);
    documents.push({
      xml: await fs.readFile(cachePath, "utf8"),
      priority: layer.merge?.priority ?? 0,
      includeNames: layer.merge?.includeNames || null,
      index,
    });
  }
  const merged = mergeDecorationOverlayXml(documents);
  await fs.mkdir(path.dirname(source), { recursive: true });
  const stage = `${source}.${process.pid}.${randomUUID()}.stage`;
  try {
    await fs.writeFile(stage, merged, { encoding: "utf8", flag: "wx" });
    await fs.rename(stage, source);
  } catch (error) {
    await fs.rm(stage, { force: true }).catch(() => {});
    throw error;
  }
  return source;
}
