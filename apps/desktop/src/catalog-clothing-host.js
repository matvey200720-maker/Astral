import { clothingHostEntries, translateClothingFiles } from "@modovik/install-engine/clothing-update-route.js";
import { translateOverlayFiles } from "@modovik/install-engine/overlays-update-route.js";

/*
 * Нужен ли хост одежды `astral_clothing` пакетам каталога (22.11.2026, задача В под 1.0.3: «Astral Clothing DLC не подготовлен или изменён», когда хост одежды уже зарегистрирован,
 * а после этого сделана нативная правка мастерской — небо, фонари). Зеркало `weaponUpdateRoute.needsHost`: обработчик установки каталога готовит хост одежды сам, до скачивания,
 * как готовит хост оружия (`installer-ipc.js`). Готовый неизменённый хост отвечает сразу, изменённый правкой `update.rpf` перебазируется без потери правок мастерской.
 *
 * Хост нужен, если у пакета с правом `direct-clothing-dlc-v1` после перевода маршрутами «одежда через update.rpf» и «наложения через update.rpf» (если включены) осталась хотя бы одна запись
 * в хосте одежды. Без маршрутов (режим выключен) остаётся всё — хост нужен любому такому пакету. Пакет, целиком ушедший в контейнер (одежда со всеми файлами в `x64/astral/…`,
 * тату при включённых наложениях), хоста не просит. Тату и наложения каталога несут то же право `direct-clothing-dlc-v1` (запись `astral_stream_00.rpf/<картинка>.ytd` в хосте одежды).
 */
const CLOTHING_CAPABILITY = "direct-clothing-dlc-v1";

export function catalogNeedsClothingHost(manifests, { clothingRoute = null, overlaysRoute = null } = {}) {
  for (const manifest of manifests || []) {
    if (!manifest?.capabilities?.includes(CLOTHING_CAPABILITY)) continue;
    let files = manifest.files || [];
    if (clothingRoute) files = translateClothingFiles({ files }).files;
    if (overlaysRoute) files = translateOverlayFiles({ files }).files;
    if (clothingHostEntries(files).length) return true;
  }
  return false;
}
