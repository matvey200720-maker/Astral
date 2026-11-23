// Сколько высоты нужно окну, чтобы шаг «Установка» поместился без прокрутки
// (крупный текст Windows делает его выше макета 960x600, коммит от 21.10.2026).
// Вне этого шага ответ — высота макета. Результат в единицах макета.

const READY_BODY = '.screen[data-screen="ready"] > .screen-body';

// Читает что-нибудь у тела, пока оно разжато, и возвращает стили как были.
// Защиты на случай исключения нет: чтение offsetHeight в браузере не бросает.
const whileUnsqueezed = (body, read) => {
  const { style } = body;
  const [keptFlex, keptHeight] = [style.flex, style.height];
  style.flex = "none";
  style.height = "auto";
  const outcome = read(body);
  style.flex = keptFlex;
  style.height = keptHeight;
  return outcome;
};

// «Всё, кроме тела» (шапка, низ с кнопкой) плюс настоящая высота тела; первое
// считается до любых правок стиля.
const heightWithFullBody = (root, body) => {
  const outer = root.offsetHeight;
  const squeezed = body.offsetHeight;
  return outer - squeezed + whileUnsqueezed(body, (el) => el.offsetHeight);
};

const neededWindowHeight = (root, designHeight = 600) => {
  const body = root.querySelector(READY_BODY);
  return body ? Math.max(designHeight, Math.ceil(heightWithFullBody(root, body))) : designHeight;
};

export { neededWindowHeight };
