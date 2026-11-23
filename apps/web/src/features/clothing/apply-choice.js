import {
  applyClothingReplacement,
  applyGameBeard,
  applyTattooPaint,
} from "../../api.js";
import { GAME_BEARD_KIND } from "./game-beard-items.js";
import { modCoverSha } from "../library/mod-picture.js";

/* Выбор «на что поставить» у установки (15.11.2026, `saved-choice.js`): оболочка берёт эти два вместе с `applyCatalogChoice`. */
export { looksLikeClothing, withSavedChoice } from "./saved-choice.js";

/*
 * Установка того, что выбрано в окне каталога: заменёнка на вещь сервера или набор тату с выбором «часть → тату игры» (круг 7).
 * Очередь установок (`DesktopShell`) не знает, чем они различаются: оба ставит Desktop по выбору, а не по манифесту мода.
 */
/** Ставит выбранное; ответ — слова об оговорках установки `{ text, tone }` (`install-words.js`) или `null`: оговаривать нечего. */
export async function applyCatalogChoice(current, game) {
  const base = {
    manifest: current.manifest,
    baseUrl: current.packageBaseUrl,
    name: current.name,
  };
  const place = { gameRoot: game.path, targetId: game.id };
  if (current.tattooSetChoice) {
    /* Картинки частей — в выбранные тату, пакетом покраски тату. */
    const painted = await applyTattooPaint({
      ...base,
      tattooSet: true,
      picks: current.tattooSetChoice.picks,
      ...place,
    });
    /* Режим RP (21.11.2026): картинка осталась в Astral Clothing DLC — слова; ответа `visibility` нет (режим выключен, всё ушло в контейнер) — тату по-прежнему уходит без слов. */
    return painted?.visibility
      ? (await import("./install-words.js")).installNotice(painted, current.name)
      : null;
  }
  /* Цель — штатная борода игры (Ц3в, 16.11.2026): модель ложится плоским рисунком в лист выбранного номера пакетом DLC. Лист Desktop печёт сам из вещи (`manifest`, `colour` — буква расцветки): в выборе его нет. */
  const beard = current.clothingChoice?.target;
  if (beard?.kind === GAME_BEARD_KIND) {
    const letter = String(current.clothingChoice.variant || "");
    await applyGameBeard({
      ...base,
      key: beard.key,
      ...(/^[a-z]$/.test(letter) ? { colour: letter } : {}),
      ...(current.domain?.clothing?.gender
        ? { gender: current.domain.clothing.gender }
        : {}),
      ...place,
    });
    return null;
  }
  const result = await applyClothingReplacement({
    ...base,
    catalogModId: current.id, // карточка мода в «Библиотеке» (`clothing-placements.js`)
    /* Обложка мода (sha256) — в запись установки: карточка «Библиотеки» не ждёт каталог (`clothing-placements.js`). */
    cover: modCoverSha(current),
    /* Вещи сервера (у брони — несколько) и расцветка мода. */
    ...current.clothingChoice,
    ...place,
  });
  /* Слова об установке — только когда есть что оговорить: регистрация DLC, папка игры у клиентов, кто увидит заменёнку (14.11.2026). */
  /* «Чисто» (`clean`) больше не значит «слов нет»: вещь в контейнере update.rpf (info `container-gta5rp`) говорит, что записано и что видно. Что говорить, решает `installNotice`: «как задумано» (`pack`) он отдаёт пустым. */
  return result?.visibility
    ? (await import("./install-words.js")).installNotice(result, current.name)
    : null;
}
