/*
 * Зал арены мода в окне редактора (Хелпер 7, 25.10.2026).
 *
 * `project.mod` говорит, чей зал открыт (`arena-mod.js`); сам зал собирает Astral Desktop из пакета мода и игры игрока
 * (`apps/desktop/src/arena-mod-hall.js`) и отдаёт сцену ARS1 и листы WebP. Здесь — загрузка: разрешение каталога на пакет →
 * канал → адрес сцены, превью листов (по имени листа в игре) и источник листов кадра. Источник общий на окно
 * (`setSceneSheetSource`) и ставится до того, как кадр спросит первый лист; уходит вместе с залом.
 *
 * Состояния: `loading` — собирается (первый раз — минуты: детали зала из игры), `ready`, `failed` (слова причины в `error`),
 * `unsupported` — без Astral Desktop зала нет.
 */

import { useEffect, useState } from "react";

import { getCloudDownloadGrant, readArenaModHall } from "../../../api.js";
import { setSceneSheetSource, sheetSourceKey } from "../model-stage/scene-textures.js";

const IDLE = Object.freeze({ status: "loading", hall: null, error: "" });

/**
 * Площадь поверхности каждого листа мода в зале (м²): по ней список листов идёт от самых заметных — пол, стены, потолок, баннеры, — а
 * не по алфавиту. `asset` — сцена кадра (`decodeSceneAsset`): сетки уже стоят на своих местах, материал помнит имя листа.
 */
export function sheetAreas(asset) {
  const areas = new Map();
  for (const mesh of asset?.meshes || []) {
    const sheet = asset.materials?.[mesh.material]?.sheet;
    if (!sheet) continue;
    const { positions, indices } = mesh;
    let area = 0;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const a = indices[at] * 3;
      const b = indices[at + 1] * 3;
      const c = indices[at + 2] * 3;
      const ux = positions[b] - positions[a];
      const uy = positions[b + 1] - positions[a + 1];
      const uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a];
      const vy = positions[c + 1] - positions[a + 1];
      const vz = positions[c + 2] - positions[a + 2];
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
    areas.set(sheet, (areas.get(sheet) || 0) + area);
  }
  return areas;
}

/** Слова причины из отказа канала: «Error invoking remote method …: Error: причина» → причина. */
export function hallErrorText(error) {
  const text = String(error?.message || error || "");
  return text.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, "").trim();
}

/**
 * Зал мода `mod` (`{ id }` из работы) на сервере `server`: `{ status, hall, error }`; `hall` — `{ url, server, named, thumbs }`,
 * `thumbs` — `Map` имя листа → адрес картинки. `deps` — подмена для проверок (`grant`, `read`).
 */
export function useArenaModHall(mod, server = "gta5rp", deps = {}) {
  const [state, setState] = useState(IDLE);
  const id = mod?.id || "";
  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    const urls = [];
    /* Каталог не отдал пакет: мод снят — зала уже не будет, и `failed` говорит об этом полем `gone`. */
    let gone = false;
    setState(IDLE);
    (async () => {
      const grant = await (deps.grant || getCloudDownloadGrant)(id).catch(() => null);
      gone = !grant?.manifest?.version;
      const answer = await (deps.read || readArenaModHall)({ manifest: grant?.manifest || { id }, baseUrl: grant?.packageBaseUrl || "", server });
      if (!live) return;
      if (!answer) {
        setState({ status: "unsupported", hall: null, error: "" });
        return;
      }
      const sheets = new Map(answer.sheets.map((sheet) => [String(sheet.key).toLowerCase(), sheet.bytes]));
      const url = URL.createObjectURL(new Blob([answer.scene]));
      urls.push(url);
      const thumbs = new Map();
      for (const entry of answer.named || []) {
        const bytes = sheets.get(String(entry.key).toLowerCase());
        if (!bytes) continue;
        const thumb = URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
        urls.push(thumb);
        thumbs.set(entry.name, thumb);
      }
      /* Листы кадра — из ответа, а не из игры: у зала мода записи `set: hall` (деталь/лист), игре они неизвестны. */
      setSceneSheetSource((entry) => {
        const bytes = sheets.get(sheetSourceKey(entry));
        return bytes ? createImageBitmap(new Blob([bytes], { type: "image/webp" })) : null;
      });
      setState({ status: "ready", hall: { url, server: answer.server, named: answer.named || [], thumbs }, error: "" });
    })().catch((error) => {
      if (live) setState({ status: "failed", hall: null, error: hallErrorText(error), gone });
    });
    return () => {
      live = false;
      setSceneSheetSource(null);
      for (const url of urls) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` — подмена для проверок, зал не пересобирается из-за неё
  }, [id, server]);
  return state;
}
