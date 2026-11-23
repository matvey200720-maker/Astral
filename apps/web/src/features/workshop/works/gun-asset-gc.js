import { deleteWorkshopAsset, listWorkshopAssetKeys } from "../../../components/desktop/workshop/workshop-assets.js";
import { CLOTHING_DRAFTS_KEY, GUN_DRAFTS_KEY } from "./gun-draft-store.js";
import { WORKS_KEY, unpackWorkState } from "./workshop-works.js";

const IMAGE_KEY_PREFIX = "gun:";
const PACKED_STATE_PREFIX = "z1:";
// Ссылка в проекте: приставка и ровно 64 строчных шестнадцатеричных знака.
const ASSET_LINK = /asset:gun:([0-9a-f]{64})/g;

// Сырой текст трёх ключей в порядке: стволы, одежда, работы. Ключ, который бросил, пропускается.
function readStoredTexts(storage) {
  return [GUN_DRAFTS_KEY, CLOTHING_DRAFTS_KEY, WORKS_KEY].flatMap((key) => {
    try {
      return [storage?.getItem?.(key) ?? ""];
    } catch {
      return [];
    }
  });
}

// Развёрнутые сжатые снимки из записей последнего текста. Любая беда обрывает разбор,
// но уже развёрнутое остаётся.
function expandPackedStates(lastText) {
  const expanded = [];
  try {
    for (const { state } of JSON.parse(lastText).works) {
      if (typeof state === "string" && state.startsWith(PACKED_STATE_PREFIX)) {
        expanded.push(unpackWorkState(state) ?? "");
      }
    }
  } catch {
    // испорченный снимок работ: ссылок из него не берём
  }
  return expanded;
}

export function referencedGunAssets(storage = globalThis.localStorage) {
  const texts = readStoredTexts(storage);
  const everything = [...texts, ...expandPackedStates(texts.at(-1))];
  return new Set(everything.flatMap((text) => [...text.matchAll(ASSET_LINK)].map((hit) => IMAGE_KEY_PREFIX + hit[1])));
}

export async function collectGunAssets(storage = globalThis.localStorage) {
  const alive = referencedGunAssets(storage);
  const stored = await listWorkshopAssetKeys(IMAGE_KEY_PREFIX);
  const orphans = Array.from(stored).filter((key) => !alive.has(key));

  // Удаляем по одному: каждое ждёт предыдущее, отказ одного не мешает остальным.
  await orphans.reduce(
    (previous, key) =>
      previous
        .then(() => deleteWorkshopAsset(key))
        .catch(() => {}),
    Promise.resolve(),
  );
  return orphans.length;
}
