/*
 * «Из паков какого проекта эта вещь» — по карточке каталога (слово владельца 14.11.2026: «чтобы можно было выбрать шмотки с GTA 5 РП, с новой РП или же с Majestic»).
 *
 * Карточка проекта — слаг `clothing-<проект>-…` (`clothing-gta-5-rp-teef011-89bd3a94`, `clothing-nova-rp-…`, `clothing-majestic-rp-…`) **и** блок «откуда вещь» в самой карточке:
 * `domain.clothing.dlc.source === "dlc"` и `domain.clothing.dlc.title` — название проекта у конвейера («GTA 5 RP», «Nova RP», «Majestic RP»). Одного слага мало (ревью 14.11.2026, №4):
 * слаг вещи автора строится из названия поста, и «GTA 5 RP Куртка» дала бы `clothing-gta-5-rp-kurtka-…`; у всех настоящих карточек проекта блок `dlc` стоит (по базе: все 3195 карточек GTA 5 RP).
 * Название вещи, автор и теги не разбираются: «Шляпа с Majestic RP By Venetto» — работа автора, а не пак проекта.
 * Слаг карточки — `slug`; у части выдач его нет и `id` — тот же слаг (как у `isStandardZonesCard`).
 *
 * Это не выбор «на каком сервере я играю» (`apps/web/src/features/catalog/catalog-projects.js`, видимость по серверу): там вопрос «где работает мод», здесь — «из чьих паков вещь».
 * Чистый JS без зависимостей: модуль читают и окно, и конвейер.
 */

/** Проекты, чьи паки превращаются в карточки одежды. Имена собственные — не переводятся; `dlcTitle` — как проект назван у конвейера в блоке `dlc` карточки. */
export const CARD_PROJECTS = Object.freeze([
  Object.freeze({
    id: "gta5rp",
    name: "GTA 5 RP",
    slug: "clothing-gta-5-rp-",
    dlcTitle: "GTA 5 RP",
  }),
  Object.freeze({
    id: "novarp",
    name: "Nova RP",
    slug: "clothing-nova-rp-",
    dlcTitle: "Nova RP",
  }),
  Object.freeze({
    id: "majesticrp",
    name: "Majestic",
    slug: "clothing-majestic-rp-",
    dlcTitle: "Majestic RP",
  }),
]);

const BY_ID = new Map(CARD_PROJECTS.map((project) => [project.id, project]));

/** Слаг карточки: `slug`, иначе `id`. */
export const cardSlug = (mod) =>
  String(mod?.slug || mod?.id || "").toLowerCase();

const plain = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

/** Проект карточки — `"gta5rp"`, `"novarp"`, `"majesticrp"` — или `null` (работа автора, не одежда проекта): слаг проекта и блок `dlc` карточки (`source: "dlc"`, `title` — название проекта). */
export function projectOfCard(mod) {
  const slug = cardSlug(mod);
  const found = CARD_PROJECTS.find((project) => slug.startsWith(project.slug));
  if (!found) return null;
  const dlc = (mod?.domain?.clothing || mod?.clothing)?.dlc;
  return dlc?.source === "dlc" && plain(dlc.title) === plain(found.dlcTitle)
    ? found.id
    : null;
}

/** Проект по id (`"novarp"` → `{ id, name, slug, dlcTitle }`) или `null`. */
export const cardProject = (id) => BY_ID.get(id) ?? null;
