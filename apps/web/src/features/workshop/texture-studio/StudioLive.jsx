/*
 * Живой 3D-вид у отделки поверхностей (ТЗ 18.10.2026, Session 1, задача 6Б).
 *
 * Редактор — страница с кадром и колонкой — говорит студии одно: «мой кадр
 * рисуется так» (`<StudioLiveProvider project render>`). Поверхность, которую
 * открыла студия, — это место в работе (`path`: ключи вглубь, `["parts", "walls"]`):
 * плавающее окно рисует тот же кадр с работой, где на этом месте стоит
 * «картинка» под живым ключом (`live-finish.js`) — её текстура и есть холст
 * студии. Ничего не копируется: кадр тот же, облик материалов тот же, что у
 * редактора; другие поверхности работы — какие сейчас у человека.
 */

import { createContext, useContext, useMemo } from "react";
import { liveFinishAsset } from "../finish/live-finish.js";

const StudioLiveContext = createContext(null);

/**
 * `project` — работа редактора сейчас; `render(project, hint)` — его кадр с этой
 * работой (`<FactoryStage project={project} />`; `hint` — подсказка поверхности). Перерисовку кадра при каждом
 * обновлении холста окно студии берёт на себя (`LiveStageContext`). `wall` — стена, по которой
 * щёлкнули в кадре (`wall-pick.js`, 3Б ТЗ 18.10.2026) или `null`: «Студия» у части, которой стена
 * принадлежит, откроется на ней.
 */
export function StudioLiveProvider({ project, render, wall = null, children }) {
  const value = useMemo(() => ({ project, render, wall }), [project, render, wall]);
  return <StudioLiveContext.Provider value={value}>{children}</StudioLiveContext.Provider>;
}

/** Что редактор сказал студии (`StudioLiveProvider`) или `null` — редактор без живого вида. */
export const useStudioLive = () => useContext(StudioLiveContext);

function setAt(node, path, value) {
  if (!path.length) return value;
  const [key, ...rest] = path;
  return { ...(node || {}), [key]: setAt(node?.[key], rest, value) };
}

/**
 * Работа, где на месте `path` стоит «картинка» под ключом `asset` (холст
 * студии), растянутая на всю поверхность и без подкраски; прочие поля места —
 * как были.
 */
export function withLiveFinish(project, path, asset, { width = 2048, height = 2048 } = {}) {
  let current = project;
  for (const key of path) current = current?.[key];
  const { animation: _animation, ...image } = current?.image || {};
  return setAt(project, path, {
    ...(current || {}),
    mode: "image",
    image: { ...image, asset, name: "", width, height, fit: "stretch", scale: 100, tint: "#ffffff", strength: 0 },
    /* Картинка студии — готовый лист: деталей основы под ней нет (их несёт сама картинка), как при «Поставить» (`FinishField`). */
    shade: 0,
  });
}

/**
 * `view3d` поверхности для студии: `{ asset, frameKey, stage, reloads }` — живой
 * ключ картинки и кадр редактора с работой, где она стоит на `path` (массив ключей
 * или `(project) => массив`: место зависит от того, чей облик сейчас правится).
 * `prepare(project)` — подготовить работу до подмены (вид, что шёл «как все»,
 * заводит свой облик); `patch(project, asset)` — свой способ поставить живую
 * картинку (вместо `path`: у билбордов один облик на несколько щитов); `kind` — вид хранилища картинки у редактора
 * (`finish-image` или `hangar-emblem`); `reloads` — кадр собирает листы пикселями
 * из картинки хранилища (арена, дороги, билборды): ему с каждым обновлением холста
 * отдаётся новый ключ, и он читает холст заново. `stage(version)` — сам кадр.
 * `hint` — что кадру подсказать о поверхности (вторым аргументом `render`: какую часть
 * показать крупно). `null`, если редактор живого вида не даёт.
 */
export function finishView3d(live, { id, path = null, patch = null, width, height, frameKey = "", prepare = null, kind = "finish-image", reloads = false, hint = null }) {
  if (!live?.render || (!Array.isArray(path) && typeof path !== "function" && typeof patch !== "function")) return null;
  const base = prepare ? prepare(live.project) : live.project;
  const where = typeof path === "function" ? path(base) : path;
  const stand = (asset) => (typeof patch === "function" ? patch(base, asset, { width, height }) : withLiveFinish(base, where, asset, { width, height }));
  return {
    asset: liveFinishAsset(id, kind),
    frameKey,
    reloads,
    stage: (version = 0) => live.render(stand(liveFinishAsset(id, kind, reloads ? version : 0)), hint),
  };
}
