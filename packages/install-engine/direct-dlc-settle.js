import { directDlcsOf } from "./direct-dlcs.js";
import { composeDirectDlcRegistry } from "./registry-composers.js";

/*
 * Выключение опустевшего прямого DLC Astral (`DIRECT_DLCS`: пакеты оружия, одежды, мест, дорог, растительности, текстур, звука). Пока в нём что-то стоит, он включён; когда не осталось ни одного слоя,
 * регистрация уходит из `directDlcRegistrations`, `dlclist.xml` пересобирается, а хосту (`dlc.state`) ставится `preparedOnly`. Правило одно для снятия (`remove-batch.js`), установки с заменой
 * (`stage-package.js`: вытесненная работа ушла в другое место, в её пакете больше никого нет — перенос набора мест из пакета в контейнер `update.rpf` оставлял пустой `astral_places` записанным) и
 * подготовки хоста оружия и одежды без включения (`fast-weapon-dlc.js`, `clothing-dlc.js`).
 *
 * Модуль грузится по вызову (`import()` в местах вызова): он нужен только при снятии, замене и подготовке пустого записанного хоста, а на старте главного процесса его исходник не нужен
 * (потолок `tests/main-startup-imports.test.js`). Статический `import` его из модулей старта вернул бы исходник в граф и дал бы цикл с `direct-dlcs.js`, который тянет хосты.
 */

/** Есть ли в архиве прямого DLC хоть один слой — не считая слоёв работ из `ignoring` (вытесняемые: их слои уже сняты или вот-вот снимутся). */
function hasLayers(target, dlcTarget, ignoring = null) {
  return Object.values(target.archives?.[dlcTarget]?.entries || {}).some((entry) => (entry.layers || []).some((layer) => !ignoring?.has(layer.modId)));
}

/**
 * Какие прямые DLC опустеют, когда `supersededIds` уйдут, а пакет с файлами `parsedFiles` ляжет: те, в которых пишут вытесняемые работы, где не останется чужих слоёв и куда новый пакет не пишет.
 * Чистая функция: состояние не меняет. Нужна ДО вытеснения — состоянию архива основы (`update.rpf`) нужно перебазирование раньше пересборки `dlclist.xml`.
 */
export function directDlcsEmptiedBy({ target, supersededIds, parsedFiles = [] }) {
  const written = new Set(parsedFiles.map((file) => file.target));
  const found = new Map();
  for (const record of target.installed || []) {
    if (!supersededIds.has(record.modId)) continue;
    for (const dlc of directDlcsOf(record, target.directDlcRegistrations)) found.set(dlc.name, dlc);
  }
  return [...found.values()].filter((dlc) => !written.has(dlc.target) && !hasLayers(target, dlc.target, supersededIds));
}

/**
 * Снимает регистрацию одного прямого DLC и пересобирает `dlclist.xml` в слое `update.rpf`. Порядок один для всех путей; вызывающий добавляет `update/update.rpf` к затронутым архивам.
 * Всё меняется в копии состояния и в файлах ресурсов: игру пишет только транзакция после, так что отказ посередине оставляет игру как была.
 */
export async function unregisterDirectDlc({ target, targetKey, paths, dlcListProvider, name }) {
  delete target.directDlcRegistrations?.[name];
  await composeDirectDlcRegistry({ target, targetKey, paths, dlcListProvider, archiveTarget: "update/update.rpf" });
}

/**
 * Выключает из `directDlcs` те DLC, в которых не осталось слоёв: регистрация, `dlclist.xml`, `preparedOnly` хосту. Ответ — выключенные DLC;
 * `update/update.rpf` при этом добавляется в `touched` (множество затронутых архивов вызывающего), если оно дано.
 */
export async function settleEmptyDirectDlcs({ target, targetKey, paths, dlcListProvider, directDlcs, touched = null }) {
  const settled = [];
  for (const dlc of directDlcs) {
    if (hasLayers(target, dlc.target)) continue;
    await unregisterDirectDlc({ target, targetKey, paths, dlcListProvider, name: dlc.name });
    if (dlc.state && target[dlc.state]) target[dlc.state].preparedOnly = true;
    settled.push(dlc);
  }
  if (settled.length) touched?.add("update/update.rpf");
  return settled;
}
