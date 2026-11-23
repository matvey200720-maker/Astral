/*
 * Пять мест ганпака — один список стволов (ТЗ владельца 11.11.2026: «ты добавляешь в компоненты одно, а на превью другое, и в предпросмотре потом тоже другое»).
 *
 * Источник правды — состав пакета установки (`domain.weapon.weapons` пака: что встанет в игру). Из него же строятся:
 *   • «Компоненты» — карточки стволов пака (`included_mod_ids`);
 *   • кадры под 3D — те же карточки с обложкой;
 *   • 3D — те же карточки с моделью;
 *   • обложка пака — картинки стволов в галерее пака (по ним собирается коллаж).
 * Функция берёт карточки в форме ответа каталога (`domain`, `media`, `included_mod_ids`) и возвращает список каждого места строчными именами моделей, по алфавиту,
 * а `disagreements` — по каким местам список не равен пакету. Пустая галерея обложки не считается расхождением (обложка без раскладки по стволам).
 */

const lower = (value) => String(value || "").toLowerCase();

/** Имя модели ствола из пути кадра галереи (`preview/gallery/03-w-ar-musket.png` → `w_ar_musket`); не узнано — пусто. */
export function modelOfGalleryFrame(source) {
  const match = /\d+-(w-[a-z]{2}-[a-z0-9-]+?)\.(?:png|webp|jpe?g)/i.exec(String(source || ""));
  return match ? match[1].replace(/-/g, "_").toLowerCase() : "";
}

const sorted = (values) => [...new Set(values.filter(Boolean).map(lower))].sort();
const equal = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

/** Ствол-карточка: у неё есть файлы ствола (карточки обвесов в состав стволов не входят). */
const isWeaponCard = (card) => Array.isArray(card?.domain?.weapon?.files);

/**
 * Списки стволов пяти мест у одного пака. `pack` — карточка пака, `cards` — карточки каталога, из которых берутся его части (по `included_mod_ids`).
 * Возвращает `{ package, components, frames, model3d, cover, disagreements }`; `cover` — `null`, если у пака нет раскладки галереи по стволам.
 */
export function gunpackLists(pack, cards) {
  const byId = new Map((cards || []).map((card) => [card.id, card]));
  const parts = (pack?.included_mod_ids || []).map((id) => byId.get(id)).filter(isWeaponCard);
  const gallery = pack?.media?.gallery || [];
  const named = gallery.map((frame) => modelOfGalleryFrame(frame?.source));
  const lists = {
    package: sorted(pack?.domain?.weapon?.weapons || []),
    components: sorted(parts.map((card) => card.domain.weapon.model)),
    frames: sorted(parts.filter((card) => card.media?.cover?.sha256).map((card) => card.domain.weapon.model)),
    model3d: sorted(parts.filter((card) => card.media?.model).map((card) => card.domain.weapon.model)),
    cover: gallery.length > 0 && named.every(Boolean) ? sorted(named) : null,
  };
  const disagreements = [];
  for (const place of ["components", "frames", "model3d", "cover"]) if (lists[place] && !equal(lists[place], lists.package)) disagreements.push(place);
  return { ...lists, disagreements };
}

/** Сводка по каталогу: сколько паков с расхождением и по каким местам (для переписи и тест-сторожа). */
export function gunpackListsSummary(cards) {
  const packs = (cards || []).filter((card) => card?.placement?.section === "gunpacks" && card?.placement?.mode === "pack");
  const places = { components: 0, frames: 0, model3d: 0, cover: 0 };
  const bad = [];
  for (const pack of packs) {
    const lists = gunpackLists(pack, cards);
    if (lists.disagreements.length === 0) continue;
    bad.push({ slug: pack.slug, places: lists.disagreements, lists });
    for (const place of lists.disagreements) places[place] += 1;
  }
  return { packs: packs.length, disagree: bad.length, places, bad };
}
