// Подписи семи групп ползунков «Неба» и поиск группы по месту наведения.
// Строки русские: они же ключи словаря, переводятся при показе через tr().

const FOCUS_ATTRIBUTE = "data-sky-focus";
const FOCUS_SELECTOR = `[${FOCUS_ATTRIBUTE}]`;

const note = (title, text) => ({ title, text });

export const SKY_FOCUS_COPY = Object.freeze({
  sky: note(
    "Небо",
    "Цвет купола над городом — так в игре окрасится всё небо в эти часы",
  ),
  sun: note(
    "Солнце",
    "Диск и ореол солнца; его цвет ложится и на стены домов",
  ),
  night: note(
    "Луна и звёзды",
    "Видны ночью: диск луны, её свет и звёзды над городом",
  ),
  clouds: note(
    "Облака",
    "Облака на небе и их цвет — на все сутки",
  ),
  world: note(
    "Свет мира",
    "Как солнце и небо освещают дома, дороги и машины",
  ),
  haze: note(
    "Дымка",
    "Воздух у горизонта: дальние дома и холмы тонут в этом цвете",
  ),
  picture: note(
    "Весь кадр",
    "Яркость и насыщенность всей картинки игры, как фильтр на экране",
  ),
});

// Ближайший сам-или-предок с атрибутом: узел без closest не группа,
// а closest не-функция — ошибка вызывающего, её не прячем.
function nearestMarked(target) {
  const finder = target?.closest;
  if (finder == null) return null;
  return Reflect.apply(finder, target, [FOCUS_SELECTOR]);
}

export function focusOfTarget(target) {
  const marked = nearestMarked(target);
  if (!marked) return null;
  const value = marked.getAttribute(FOCUS_ATTRIBUTE);
  return Object.hasOwn(SKY_FOCUS_COPY, value) ? value : null;
}
