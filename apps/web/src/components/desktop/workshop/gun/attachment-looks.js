import { weaponAttachPoints } from "@modovik/rpf-inspector/weapon-attachments";
import { cloudCatalogIDPattern } from "../../../../catalog-utils.js";
import { catalogPackageOf } from "./clothing-models.js";
import {
  coveredByPack,
  isAttachmentCard,
  ownedAttachmentCards,
  ownedAttachmentPacks,
  packPosts,
  packWithAttachmentModels,
} from "../../../../features/catalog/attachment-cards.js";

/*
 * «Вид из каталога» у обвеса (ТЗ 23.10.2026, п. C, часть 2).
 *
 * Обвес на стволе — глушитель, прицел, фонарь, рукоять, магазин — может стоять не моделью из игры, а моделью из мода
 * каталога: ствол или пак кладёт свой `w_at_…` в пакет (`domain.weapon.attachments` у ствола и карточки обвесов,
 * `domain.weapon.attachmentModels` у пака — какие модели обвесов он несёт).
 * Список вариантов для обвеса собирается из каталога, который окно уже получило, — без скачивания; пакет качает
 * главный процесс (`apps/desktop/src/attachment-looks.js`), только когда мод выбран.
 *
 * Выбор хранит проект: `project.attachmentLooks = { кость: id мода }`. Он живёт, пока на кости стоит тот же обвес и мод
 * есть в каталоге; иначе обвес встаёт моделью игры, а панель говорит об этом.
 */

const MODEL = /^[a-z0-9][a-z0-9_]{2,79}$/;

/* Есть ли у мода пакет, который можно скачать: подписанный манифест или облачная выдача. */
const hasPackage = (item) =>
  Boolean(item?.manifest && item.packageBaseUrl) || cloudCatalogIDPattern.test(item?.id || "");

const cleanModels = (value) => {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((name) => String(name || "").trim().toLowerCase()).filter((name) => MODEL.test(name)))];
};

/**
 * Модели обвесов, что несёт мод каталога (строчными). У пака — `attachmentModels`, имена его видимых обвесов (ТЗ
 * 24.10.2026, п. 6); у пака без них (ещё не переопубликован) имён нет — только число, он в выбор не идёт.
 */
function modelsOf(item) {
  const weapon = item?.domain?.weapon;
  if (!weapon || weapon.hidden === true) return [];
  if (weapon.pack === true) return packWithAttachmentModels(item) ? cleanModels(weapon.attachmentModels) : [];
  return cleanModels(weapon.attachments);
}

/**
 * Варианты обвесов из каталога: `Map<модель обвеса, [{ id, name, item }]>`. Моды без пакета и ещё не загруженные
 * (`pending`, `missing`) в список не входят.
 *
 * `installed` (ТЗ 24.10.2026, п. 4) — id установленных модов каталога. Карточки обвесов ганпаков в каталоге не
 * показываются: их обвесы подтягиваются в студию, когда человек скачал ганпак (сам пак, любой его ствол или эта
 * карточка — `attachment-cards.js`). Без `installed` (`null`) — как прежде, все карточки: так зовёт тот, кто
 * списка установленного не знает.
 *
 * Пак с `attachmentModels` (п. 6) даёт свои обвесы сам, когда скачан: его пост закрыт — карточка «Обвесы» и обвесы
 * стволов того же поста его не дублируют, а пока пак не скачан, не показываются вовсе.
 */
export function attachmentLooksIndex(items, { installed = null } = {}) {
  const index = new Map();
  const owned = installed ? ownedAttachmentCards(items, installed) : null;
  const ownedPacks = installed ? ownedAttachmentPacks(items, installed) : null;
  const posts = packPosts(items);
  for (const item of items || []) {
    if (!item?.id || item.pending || item.missing || !hasPackage(item)) continue;
    if (owned && isAttachmentCard(item) && !owned.has(item.id)) continue;
    if (coveredByPack(item, posts)) continue;
    if (ownedPacks && packWithAttachmentModels(item) && !ownedPacks.has(item.id)) continue;
    for (const model of modelsOf(item)) {
      const list = index.get(model) || [];
      list.push({ id: item.id, name: String(item.name || item.id), item });
      index.set(model, list);
    }
  }
  for (const list of index.values()) list.sort((left, right) => left.name.localeCompare(right.name, "ru"));
  return index;
}

/** Варианты для обвеса `component` (из таблицы игры) — пусто, если каталог такого обвеса не несёт. */
export const looksOfComponent = (index, component) => index.get(String(component?.model || "").toLowerCase()) || [];

/**
 * Какие виды сейчас действуют: `{ кость: id мода }` — для костей, где обвес выбран, мод выбран и несёт модель этого
 * обвеса. `selection` — `{ кость: обвес }` (`attachmentSelection`), `chosen` — `project.attachmentLooks`.
 */
export function activeLooks({ weapon, selection, chosen, index }) {
  const result = {};
  if (!weapon || !chosen) return result;
  for (const point of weaponAttachPoints(weapon)) {
    const modId = chosen[point.bone];
    const component = point.components.find((item) => item.id === selection?.[point.bone]);
    if (modId && component && looksOfComponent(index, component).some((look) => look.id === modId))
      result[point.bone] = modId;
  }
  return result;
}

/** Ключ действующих видов — в ключ загрузки модели: другой вид — другая модель. */
export const looksKey = (active) =>
  Object.entries(active || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bone, id]) => `${bone}=${id}`)
    .join(",");

/**
 * Запрос к главному процессу: `{ кость: { name, manifest, baseUrl, models? } }` — подписанный манифест мода (у облачного — через
 * выдачу ссылки). `null`, если видов нет: запрос тогда прежний, байт в байт.
 */
export async function lookRequests(active, items) {
  const entries = Object.entries(active || {});
  if (!entries.length) return null;
  const byId = new Map((items || []).map((item) => [item?.id, item]));
  const result = {};
  for (const [bone, id] of entries) {
    const item = byId.get(id);
    if (!item) continue;
    /* Пак несёт и стволы, и текстуры по сто мегабайт: хосту нужны только файлы его обвесов (`models`). */
    const models = packWithAttachmentModels(item) ? cleanModels(item.domain.weapon.attachmentModels) : [];
    result[bone] = { ...(await catalogPackageOf(item)), name: String(item.name || id), ...(models.length ? { models } : {}) };
  }
  return Object.keys(result).length ? result : null;
}
