import { useEffect, useState } from "react";
import { loadSelectionMarkup } from "./selection-markup-load.js";

/*
 * Разметка выделения сцены для кадра редактора (ТЗ 26.10.2026, раздел D): запись манифеста сцены → `{ markup, status, exact }`.
 *
 *   const { markup } = useSelectionMarkup(scene.selection, { scene: fingerprint });
 *   <ModelStage markup={markup} … />
 *
 * `status`: `none` — у сцены разметки нет (запись пуста), `loading`, `ready`, `stale` — файл не подошёл сборке сцены (кадр идёт
 * запасным путём), `failed` — файла нет или он не читается (то же). `exact` — разметка снята именно с этой сборки (иначе по
 * сущностям она работает, но могла устареть). `scene` — отпечаток загруженной сцены (`sceneFingerprint`): пока его нет, разметка
 * не сверяется, а как только появился — сверяется по тому же файлу из памяти. Подробно — `selection-markup-load.js`.
 */

const NONE = Object.freeze({ markup: null, status: "none", exact: false });

export function useSelectionMarkup(entry, { scene = null, read = null } = {}) {
  const url = entry?.url || "";
  const sha = entry?.sha256 || "";
  const sceneKey = scene ? `${scene.sha256 || ""}:${scene.meshes ?? ""}:${scene.triangles ?? ""}` : "";
  const [state, setState] = useState(url ? { markup: null, status: "loading", exact: false } : NONE);

  useEffect(() => {
    if (!url) {
      setState(NONE);
      return undefined;
    }
    let live = true;
    setState((current) => (current.status === "loading" && !current.markup ? current : { markup: null, status: "loading", exact: false }));
    loadSelectionMarkup(entry, { scene, read })
      .then((markup) => {
        if (live) setState({ markup, status: markup ? "ready" : "stale", exact: markup ? markup.exact(scene || {}) : false });
      })
      .catch(() => {
        if (live) setState({ markup: null, status: "failed", exact: false });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- запись и отпечаток сцены — по их ключам: новый объект с тем же содержимым файл заново не берёт
  }, [url, sha, sceneKey, read]);

  return state;
}
