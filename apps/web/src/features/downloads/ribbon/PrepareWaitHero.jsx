import { trIn } from "../../../locales/ui.js";
import Hero from "./Hero.jsx";
import { catalogHeroPhoto } from "./row-photo.js";

/*
 * Герой «Загрузок», пока установка ждёт подготовку игры (T-0001): тот же `Hero`, что у ждущей строки очереди, без кнопки отмены (подготовку не отменить)
 * и без процента. Слова — два ключа словаря, название мода — заголовок. Запись ожидания ведёт `features/downloads/prepare-wait.js`.
 */
export default function PrepareWaitHero({ wait, copy, language }) {
  const model = {
    mode: "wait",
    title: wait.mod?.name || "",
    cover: catalogHeroPhoto(wait.mod || {}),
    percent: null,
    pills: [{ text: copy.kicker.waiting, tone: "solid", dot: true }],
    sub: trIn(language, "Готовим игру к первой установке, до двух минут"),
    note: trIn(language, "Установка начнётся сама"),
    rail: null,
  };
  return <Hero model={model} />;
}
