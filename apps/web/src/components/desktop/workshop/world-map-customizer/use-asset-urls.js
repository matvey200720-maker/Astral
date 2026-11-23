// Ссылки на файлы проекта (картинки, значки, подложка, текстура): читаются из
// хранилища один раз на файл, отзываются при закрытии окна.
import { useEffect, useReducer, useRef } from "react";
import { blipIconAssets } from "@modovik/vector-map/blip-icons";
import { getWorkshopAsset } from "../workshop-assets.js";

const NO_ASSETS = [];

// Идентификаторы ассетов, которые нужны сцене и панелям, без повторов и пустых
function assetIdsOf({ emblems, imageId, textureId, markers, blipWork }) {
  const lists = [
    (emblems?.items || []).map((item) => item.assetId),
    [imageId, textureId],
    (markers?.items || []).map((item) => item.iconAssetId),
    Object.values(markers?.categories || {}).map((category) => category?.iconAssetId),
    blipIconAssets(blipWork),
  ];
  return [...new Set(lists.flat().filter(Boolean))];
}

// Адреса для недостающих файлов: [id, адрес] только для тех, что нашлись, пока запуск открыт
async function readAddresses(ids, assets, issued, run) {
  const entries = await Promise.all(
    ids.map(async (id) => {
      const key = assets.find((asset) => asset.id === id)?.storageKey;
      const file = key ? await getWorkshopAsset(key) : null;
      // второй адрес на тот же файл и ответ после перезапуска эффекта не нужны
      return file && run.open && !issued.has(id) ? [id, URL.createObjectURL(file)] : null;
    }),
  );
  return entries.filter(Boolean);
}

export function useAssetUrls({ config, project }) {
  const [assetUrls, addUrls] = useReducer(
    (known, entries) => Object.assign({}, known, Object.fromEntries(entries)),
    {},
  );
  const issued = useRef(null);
  issued.current ??= new Map();
  const assets = project?.assets || NO_ASSETS;
  const { emblems, markers, blipIcons: blipWork } = config;
  const imageId = config.base.imageAssetId;
  const textureId = config.base.textureAssetId;

  useEffect(() => {
    const book = issued.current;
    const missing = assetIdsOf({ emblems, imageId, textureId, markers, blipWork }).filter(
      (id) => !book.has(id),
    );
    if (missing.length === 0) return undefined;

    // запуск закрывается при перезапуске эффекта: его поздний ответ не нужен
    const run = { open: true };
    readAddresses(missing, assets, book, run).then((entries) => {
      if (!run.open || entries.length === 0) return;
      entries.forEach(([id, href]) => book.set(id, href));
      addUrls(entries);
    });
    return () => {
      run.open = false;
    };
  }, [emblems, imageId, textureId, markers, blipWork, assets]);

  useEffect(
    () => () => {
      for (const href of issued.current.values()) URL.revokeObjectURL(href);
    },
    [],
  );

  return assetUrls;
}
