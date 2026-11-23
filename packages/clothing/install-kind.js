/*
 * Как ставится карточка одежды (круг 4, 28.10.2026; владелец: у ВСЕХ вещей одежды — нынешних и будущих из скрипта разбора — «Установить» сначала
 * открывает выбор «на что поставить», а не ставит сразу).
 *
 * Один классификатор на окно и на разбор: окно по нему выбирает диалог («Сделать заменёнку» или «На что ставится»), разбор — проверяет каждую карточку,
 * прежде чем она уйдёт в каталог, чтобы вещь без понятного вида установки не доехала до витрины и не встала молча.
 *
 *   pick       — новая вещь своего DLC: человек выбирает вещь, вместо которой она встанет (нужен `component`);
 *   retexture  — перекраска штатной вещи игры, место одно;
 *   gloves     — набор перчаток (модели под крои торса, `glove-forms.js`): человек выбирает, на какую перчатку заменить, формы мода раскладываются на её номера
 *                (29.10.2026, владелец: «Перчатка — один стиль… ему предлагается выбор, на какую перчатку он хочет заменить»);
 *   ownPlaces  — набор другого вида, каждая модель на своё место;
 *   tattoo     — рисунки на коже, места на теле нет;
 *   pack       — комплект из нескольких карточек;
 *   unknown    — карточка одежды, а вид установки не определён (нет блока одежды или места на теле);
 *   ""         — не карточка одежды.
 *
 * Принимает и карточку каталога (`placement`, `domain.clothing`, `publicationMode`), и заявку разбора (`card`, `domain.clothing`, `kind`).
 */

const isClothingSection = (card, place) =>
  [card.catalogSection, card.catalogCategory, place.section, place.category].some((value) => value === "clothing");

export function clothingInstallKind(card) {
  if (!card || typeof card !== "object") return "";
  const place = card.placement || card.card || {};
  const raw = card.domain?.clothing || card.clothing || null;
  const clothing = isClothingSection(card, place) || Boolean(raw);
  if (!clothing && card.kind !== "outfit-pack") return "";
  /* Тату — по слоту и категории: у них нет места на теле (`component` пуст), и пак тела («Spiderman Body») несёт блок первой вещи. */
  if (place.slot === "tattoos" || raw?.category === "tattoos") return "tattoo";
  if (
    place.mode === "pack" ||
    card.kind === "outfit-pack" ||
    card.publicationMode === "bundle" ||
    (Array.isArray(card.includedModIds) && card.includedModIds.length > 0) ||
    (Array.isArray(card.children) && card.children.length > 0)
  )
    return "pack";
  if (!raw) return "unknown";
  if (raw.retexture === true) return "retexture";
  if (raw.ownPlaces === true) return raw.component === "uppr" ? "gloves" : "ownPlaces";
  if (raw.component) return "pick";
  return "unknown";
}

/**
 * Проверка разбора: у каждой карточки одежды вид установки определён. Заявке без него дописывается `block` (такая вещь в каталог не идёт), чтобы вещь без
 * места на теле не ставилась молча и не открывала пустой выбор. Остальные заявки возвращаются как были.
 */
export function checkInstallKinds(drafts) {
  return (drafts || []).map((draft) => {
    if (clothingInstallKind(draft) !== "unknown") return draft;
    return {
      ...draft,
      problems: [
        ...(draft.problems || []),
        {
          code: "install-kind-unknown",
          message: `«${draft.card?.name || draft.id}»: непонятно, как ставится вещь — нет ни места на теле (component), ни отметки «перекраска», «набор» или «тату». «Установить» не сможет спросить, на что её поставить.`,
          severity: "block",
        },
      ],
    };
  });
}
