/*
 * Что снимает установка пакета каталога, когда в игре есть копии с другим размером модели (26.11.2026, «новый мод старше», 18.11.2026).
 *
 * Мод каталога в 100 % стоит под id манифеста (slug), а с другим размером — локальным пакетом `local-gunpack-*` (`catalog-model-scale.js`), и мод за ним называет только происхождение:
 * `origin.catalogModId`. Окно кладёт туда id мода в каталоге (у облачного — UUID, не slug), поэтому копия сверяется с происхождением ставящегося пакета и, запасным ходом, с id манифеста.
 * Для замены это один и тот же мод: новая установка снимает прежнюю — и в 100 %, и с размером.
 *
 * Новых правил «что считать тем же местом» здесь нет: названное окном остаётся названным. Одно исключение — копия пака, у которой новый пакет закрывает не все стволы: у пака под id
 * манифеста окно видит это по плану движка (`keeps`) и такую работу к замене не называет (`plan-keeps.js`), а копию под локальным id не узнаёт. Здесь она тоже остаётся.
 */
const SCALED_COPY = /^local-gunpack-[0-9a-f]{12}$/;
const WEAPON_SLOT = /^weapon-/;

/* Копия мода каталога с другим размером: локальный пакет ганпака, за которым стоит мод каталога. */
const isScaledCopy = (record) =>
  SCALED_COPY.test(String(record?.modId)) &&
  Boolean(record?.origin?.catalogModId);

function isSameMod(record, { manifest, origin }) {
  if (record?.modId === manifest?.id) return true;
  return (
    isScaledCopy(record) &&
    [origin?.catalogModId, manifest?.id].includes(record.origin.catalogModId)
  );
}

/* Общий ствол есть, и есть ствол, которого у нового пакета нет, — та же граница, что `keeps` плана. */
function keepsOtherGuns(record, slots) {
  const guns = (record?.slots || []).filter((slot) => WEAPON_SLOT.test(slot));
  return (
    guns.some((slot) => slots.has(slot)) &&
    guns.some((slot) => !slots.has(slot))
  );
}

/**
 * Список замены для пакета каталога `item = { manifest, origin?, replaceModIds? }` при установленных записях `installed`: названное окном и записи того же мода каталога.
 * Берутся только записи того же мода с общим слотом — чужую без пересечения движок к замене не примет. `installingId` — id, под которым пакет встанет: он сам себя не заменяет
 * (у подписанного пакета это id манифеста; у копии с размером id ещё не известен, и прежняя подписанная установка того же мода уходит тоже).
 */
export function catalogReplacements(item, installed, { installingId } = {}) {
  const slots = new Set(item?.manifest?.slots || []);
  const records = new Map(
    (installed || []).map((record) => [record?.modId, record]),
  );
  const asked = (item?.replaceModIds || []).filter((id) => {
    const record = records.get(id);
    return !(
      isScaledCopy(record) &&
      !isSameMod(record, item) &&
      keepsOtherGuns(record, slots)
    );
  });
  const own = [...records.values()]
    .filter(
      (record) =>
        isSameMod(record, item) &&
        (record.slots || []).some((slot) => slots.has(slot)),
    )
    .map((record) => record.modId);
  return [...new Set([...asked, ...own])].filter((id) => id !== installingId);
}
