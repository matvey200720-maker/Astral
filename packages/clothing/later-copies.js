/*
 * Копии файлов вещи, которые игра грузит ПОЗЖЕ пака вещи (15.11.2026).
 *
 * Патч-паки (`patchdayNNng`, `patch20XX_0N`, `mppatchesng`) держат исправленные копии отдельных файлов одежды — модели и листов — в той же папке коллекции под тем же именем. Паки игры
 * грузятся по порядку `update/common/data/dlclist.xml`, и копия из пака, стоящего позже пака вещи, перекрывает её: запись «на месте» в пак вещи в игре не видна (стенд в настоящей игре, 15.11:
 * `mp_f_freemode_01_mp_f_luxe_01/lowr_000_r.ydd` — копия в `patchday27ng`, плавки показались штатными брюками; лист c жилета `mp_m_freemode_01_mp_m_january2016` — копия в `patchday9ng`, цвет не сменился).
 * Контроль: вещи без копий в патче (восемь из десяти целей стенда) встали верно, а `astral_clothing` в порядке последний и перекрывает патчи сам.
 *
 * Чем что упорядочено (кадры 15.11.2026): ЗАГРУЗКА копий файла — по месту пака в `dlclist.xml` (плавки `luxe_01`: копия `patchday27ng` перекрыла `mpluxe`; жилет `january2016`: `patchday9ng`; между двумя патчами порядок не доказан, поэтому запись идёт во ВСЕ
 * копии, и Obey на двух копиях в третьем заходе встал верно); СКВОЗНЫЕ НОМЕРА вещей (то, что принимают `pedvar` и `hat`, `game-clothing-order.js`) — по `<order>`/`<minorOrder>` из `setup2.xml`, это другая величина, и путать их нельзя.
 *
 * Чистый JS: работает в окне, в движке и в тестах. Оглавление игры (`game-clothing-index.js`, версия 5) даёт два поля: `index.overlaps` — «папка/файл» (нижний регистр) -> `[[пак, каталог
 * вложенного архива]]` для файлов в двух и более местах, `index.order` — паки в порядке загрузки (нижний регистр).
 */

const BASE_RANK = -1;

/** Место в порядке загрузки: база — раньше всех; пака нет в порядке — `null` (неизвестно, кто позже). */
export function loadRank(index, pack) {
  const name = String(pack || "").toLowerCase();
  if (!name) return BASE_RANK;
  const at = (index?.order || []).indexOf(name);
  return at < 0 ? null : at;
}

const packArchive = (pack) =>
  pack ? `update/x64/dlcpacks/${pack}/dlc.rpf` : "x64v.rpf";
const innerOf = (dir) =>
  String(dir || "").slice(0, String(dir || "").lastIndexOf("/"));

/** Имена файлов вещи: основная модель, доп. модели и все расцветки — то, что пишет заменёнка. */
export const placeFiles = (place) =>
  [place?.model, ...(place?.alternates || []), ...(place?.textures || [])]
    .filter(Boolean)
    .map(String);

/**
 * Копии файлов вещи в паках, что грузятся ПОЗЖЕ пака вещи: `[{ pack, archive, inner, names }]` по порядку загрузки, по одной записи на пару (пак, вложенный архив); `names` — файлы вещи, лежащие там.
 * Пишем во ВСЕ такие копии, а не в «верхнюю»: какая из нескольких копий верхняя, мы знаем только по позиции в `dlclist.xml` (стенд подтвердил порядок для одной копии; для 2–5 и против `setup2.xml <order>`
 * это не доказано), а запись во все подключённые более поздние копии от выбора не зависит. `place` — место вещи (`placeInIndex`: `pack`, `folder`, `model`, `alternates`, `textures`; `only` — какие
 * файлы вещи пишет операция: покраска не пишет доп. модели). В `index.overlaps` попадают только файлы из архивов, которые пак подключает (`content.xml`, версия оглавления 6).
 * Пусто — перекрытия нет. Пак вне порядка загрузки (его нет в `dlclist.xml`, игра его не монтирует) в перекрытие не входит и называется в `unknownOrder`. Нет порядка вовсе при наличии копий — `orderMissing`:
 * кто из паков позже, неизвестно, и вещь не ставится «на месте» (`majesticPlaceProblem`).
 */
export function laterCopies(index, place, only = null) {
  const copies = new Map();
  const unknown = new Set();
  const own = loadRank(index, place?.pack);
  const folder = String(place?.folder || "").toLowerCase();
  const names = placeFiles(place).filter(
    (name) => !only || only.includes(name),
  );
  const result = (list, extra = {}) =>
    Object.assign(list, { unknownOrder: [], orderMissing: false, ...extra });
  if (!folder || !index?.overlaps) return result([]);
  const keyOf = (name) => `${folder}/${name.toLowerCase()}`;
  if (!(index.order || []).length)
    return result([], {
      orderMissing: names.some(
        (name) => (index.overlaps[keyOf(name)] || []).length > 0,
      ),
    });
  if (own === null) return result([]);
  for (const name of names) {
    for (const [pack, dir] of index.overlaps[keyOf(name)] || []) {
      if (String(pack).toLowerCase() === String(place.pack || "").toLowerCase())
        continue;
      const rank = loadRank(index, pack);
      if (rank === null) {
        unknown.add(pack);
        continue;
      }
      if (rank <= own) continue;
      const inner = innerOf(dir);
      const id = `${pack}|${inner}`;
      const found = copies.get(id) || {
        pack,
        archive: packArchive(pack),
        inner,
        rank,
        names: [],
      };
      found.names.push(name);
      copies.set(id, found);
    }
  }
  const list = [...copies.values()]
    .sort((a, b) => a.rank - b.rank || a.inner.localeCompare(b.inner))
    .map(({ rank, ...rest }) => rest);
  return result(list, { unknownOrder: [...unknown].sort() });
}
