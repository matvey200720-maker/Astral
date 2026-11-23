/*
 * Карточки обвесов ганпаков (ТЗ 24.10.2026, п. 4).
 *
 * Разбор ганпака кладёт его обвесы отдельной карточкой «Обвесы <ганпак>» (`domain.weapon.attachments` —
 * список моделей `w_at_*`, без `model` ствола и без `pack`). Владелец: обвесы в каталоге отдельными
 * карточками не показываются — они «подтягиваются» в каталог обвесов студии ствола, когда человек
 * скачал ганпак. Поэтому:
 *   • выдача каталога такие карточки не показывает (`useCatalogResults`);
 *   • в студии ствола вид обвеса из каталога предлагается только для скачанных ганпаков
 *     (`attachmentLooksIndex`, `ownedAttachmentCards`).
 *
 * «Скачан» — стоит в игре сам ганпак, любой его ствол или сама карточка обвесов. Связь карточки обвесов
 * с её ганпаком — пост-источник: у карточки обвесов, пака и его стволов пост один. Сравнивается id поста
 * (`postKey`), а не адрес целиком: один пост пишут по-разному (`ptb.discord.com`, `?query`, `/` на конце,
 * `@me` вместо сервера). Из одного поста бывает несколько паков (цвета BLADE): обвесы у них общие, нужен любой.
 *
 * Модуль чистый: каталог и список установленных приходят параметрами.
 */

/** Карточка обвесов: список моделей обвесов у мода, который не ствол и не пак. */
export function isAttachmentCard(mod) {
  const weapon = mod?.domain?.weapon;
  return Boolean(
    weapon &&
      weapon.pack !== true &&
      !weapon.model &&
      Array.isArray(weapon.attachments),
  );
}

/*
 * Id поста из адреса: Discord — сообщение (id сообщения во всём Discord один, сервер и ветка в ключ не идут),
 * Telegram — канал и номер записи. Адрес, который не узнан, сводится к себе без хвоста: так хоть совпадение
 * точь-в-точь не потеряется. Пусто — источника нет.
 */
const DISCORD_POST = /^https?:\/\/(?:[a-z0-9-]+\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{1,20})\/\d{1,20}\/(\d{1,20})(?:[/?#]|$)/i;
const TELEGRAM_POST = /^https?:\/\/(?:www\.)?(?:t|telegram)\.me\/(?:s\/)?(c\/\d+|[a-z0-9_]{4,64})\/(\d{1,12})(?:[/?#]|$)/i;

export function postKey(origin) {
  const url = String(origin?.url || "").trim();
  if (!url) return "";
  const discord = DISCORD_POST.exec(url);
  if (discord) return `discord:${discord[1]}`;
  const telegram = TELEGRAM_POST.exec(url);
  if (telegram) return `telegram:${telegram[1].toLowerCase()}/${telegram[2]}`;
  return url.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
}

const sourceOf = (mod) => postKey(mod?.origin);

/**
 * Какие карточки обвесов скачаны: `Set<id>`.
 *
 * @param {object[]} mods каталог, как его получило окно
 * @param {Iterable<string>} installed id установленных модов каталога
 */
export function ownedAttachmentCards(mods, installed) {
  const have = new Set(installed || []);
  const sources = new Set(
    (mods || [])
      .filter((mod) => have.has(mod?.id))
      .map(sourceOf)
      .filter(Boolean),
  );
  const owned = new Set();
  for (const mod of mods || []) {
    if (!isAttachmentCard(mod)) continue;
    if (have.has(mod.id) || (sourceOf(mod) && sources.has(sourceOf(mod))))
      owned.add(mod.id);
  }
  return owned;
}

/** Каталог без карточек обвесов — то, что видит игрок на полках. */
export const withoutAttachmentCards = (mods) =>
  (mods || []).filter((mod) => !isAttachmentCard(mod));

/*
 * Обвесы в домене самого пака (ТЗ 24.10.2026, п. 6): разбор пишет имена видимых обвесов в `domain.weapon.attachmentModels`
 * пака — отдельной карточки «Обвесы» им не нужно. Студия берёт их из скачанного ганпака.
 *
 * Пак «скачан» — стоит он сам или любой его ствол (`includedModIds`). Пак, что несёт имена, закрывает пост: карточка
 * «Обвесы» и обвесы стволов того же поста его не дублируют (иначе у одного обвеса по три-пять одинаковых видов) —
 * пока пак не скачан, вместо них подсказка. Паки без имён (ещё не переопубликованные) работают по-старому.
 */

/** Пак, который несёт имена своих обвесов. */
export const packWithAttachmentModels = (mod) =>
  mod?.domain?.weapon?.pack === true &&
  Array.isArray(mod.domain.weapon.attachmentModels) &&
  mod.domain.weapon.attachmentModels.length > 0;

/** Посты, где есть пак с именами обвесов: `Set<postKey>`. */
export function packPosts(mods) {
  const posts = new Set();
  for (const mod of mods || []) {
    const post = sourceOf(mod);
    if (post && packWithAttachmentModels(mod)) posts.add(post);
  }
  return posts;
}

/** Какие паки с именами обвесов скачаны: `Set<id>` — стоит сам пак или любой из его стволов. */
export function ownedAttachmentPacks(mods, installed) {
  const have = new Set(installed || []);
  const owned = new Set();
  for (const mod of mods || []) {
    if (!packWithAttachmentModels(mod)) continue;
    if (have.has(mod.id) || (mod.includedModIds || []).some((id) => have.has(id))) owned.add(mod.id);
  }
  return owned;
}

/** Мод, чьи обвесы уже несёт пак его поста: карточка обвесов или ствол — их имена идут через пак. */
export const coveredByPack = (mod, posts) =>
  !packWithAttachmentModels(mod) && posts.has(sourceOf(mod)) && Array.isArray(mod?.domain?.weapon?.attachments);
