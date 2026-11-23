/*
 * Слой редукса в основном состоянии установки (проводка 17.11.2026, проект `docs/INSTALL-RUST-REDUX.md` §5.3).
 *
 * Установленный редукс — запись `installed` цели с полем `reduxLayer`: `{ layerId, dlcs: [{ name, bytes, sha256, order }], state }`
 * (`state` — `enabled` или `disabled`). Слоёв-файлов в хранилище у него нет (его данные — свой dlc в игре, а регистрация — малый
 * слой в `update.rpf`, которым владеет движок), поэтому `resources` и `archiveEntries` пусты, а «Библиотека» видит запись как любой
 * мод. Снятие и «Починить» знают поле по крючкам приложения (`reduxRemover`, `reduxRepairer`): сам движок установки движка
 * редукса не держит.
 */

export const REDUX_LAYER_KEY = "reduxLayer";

/* `fileId` — отметка файла из ответа сборки (`<том>:<номер>:<время>`): без неё быстрая проверка dlc при «Включить» невозможна. */
const cleanDlc = ({ name, bytes, sha256, order, fileId }) => ({ name, bytes, sha256, order, ...(fileId ? { fileId } : {}) });

/** Поле слоя записи установленного или `null`, если запись — не редукс. */
export const reduxLayerOf = (item) => (item && typeof item === "object" && item[REDUX_LAYER_KEY] && typeof item[REDUX_LAYER_KEY] === "object" ? item[REDUX_LAYER_KEY] : null);

/** Установленные редуксы цели: `[{ modId, layerId, dlcs, state }]` в порядке установки. */
export function reduxLayersOf(target) {
  const out = [];
  for (const item of Array.isArray(target?.installed) ? target.installed : []) {
    const layer = reduxLayerOf(item);
    if (layer) out.push({ modId: item.modId, layerId: layer.layerId, dlcs: Array.isArray(layer.dlcs) ? layer.dlcs : [], state: layer.state, pointId: layer.pointId ?? null });
  }
  return out;
}

/**
 * Кладёт редукс в `installed` цели (меняет `state` на месте; записать — дело вызывающего: он уже внутри мутации установки).
 * Тот же мод второй раз заменяет запись. Нет цели — заводит её так же, как установка пакета.
 */
export function recordReduxLayer(state, { targetKey = "default", gameRoot, edition = null, modId, version = "0.0.0", layerId, dlcs, state: layerState = "enabled", origin = null, pointId = null }) {
  if (!state || typeof state !== "object") throw new Error("Redux state: no state to write into.");
  if (!modId || !layerId || !Array.isArray(dlcs) || dlcs.length === 0) throw new Error("Redux state: modId, layerId and dlcs are required.");
  state.targets ||= {};
  const target =
    state.targets[targetKey] ||
    (state.targets[targetKey] = {
      id: targetKey,
      gameRoot,
      edition,
      baselineMode: "original",
      installed: [],
      resources: {},
      archives: {},
      dlcRegistrations: {},
    });
  target.installed ||= [];
  const item = {
    modId,
    version,
    adapter: "rpf-entry",
    slots: [],
    targetId: targetKey,
    resources: [],
    installedAt: new Date().toISOString(),
    mode: "transactional",
    ...(origin ? { origin } : {}),
    [REDUX_LAYER_KEY]: { layerId, dlcs: dlcs.map(cleanDlc), state: layerState, ...(pointId ? { pointId } : {}) },
  };
  const index = target.installed.findIndex((entry) => entry?.modId === modId);
  if (index >= 0) target.installed[index] = item;
  else target.installed.push(item);
  return item;
}

/** Меняет `state` слоя (`enabled` или `disabled`) у записи редукса; нет записи — `false`. */
export function setReduxLayerState(target, modId, layerState) {
  const item = (target?.installed || []).find((entry) => entry?.modId === modId);
  const layer = reduxLayerOf(item);
  if (!layer) return false;
  layer.state = layerState;
  return true;
}
