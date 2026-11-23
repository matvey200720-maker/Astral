/*
 * Значки Astral — набор и счёт (макет 15.11.2026: `r7/shared/badges.js`, `badge-art.js`).
 *
 * Набор — 21 значок в пяти группах, у каждого настоящее действие, которое
 * можно посчитать. Имена и «как получить» — русские строки: их переводят в
 * месте отрисовки (`tr`), а не при загрузке модуля.
 *
 * Где значок берёт цифру:
 *   — окно знает само (`have` считает `badge-progress.js` по тому, что стоит в
 *     игре, по сборкам, избранному и веткам);
 *   — окну это неоткуда узнать (`source: "none"`): откат мода, ссылка на сборку,
 *     подтверждённая ошибка, возраст аккаунта, сезонный календарь. Сервер этих
 *     цифр окну не присылает, поэтому значок честно стоит «Скоро», а не
 *     «Закрыт»: закрытым его назвать нельзя — окно не знает, получен ли он.
 *
 * Ступени (`steps`) — один значок с уровнями: у полученного номер ступени, а
 * кольцо — путь до следующей.
 */
export const BADGE_GROUPS = Object.freeze([
  {
    id: "start",
    name: "Первые шаги",
    items: [
      {
        id: "first-mod",
        icon: "download",
        name: "Первый мод",
        how: "Установи первый мод из каталога",
        need: 1,
      },
      {
        id: "rollback",
        icon: "undo",
        name: "Не зашло",
        how: "Откати мод одним нажатием",
        need: 1,
        source: "none",
      },
      {
        id: "discord",
        icon: "discord",
        name: "На сервере",
        how: "Войди через Discord — и ты на сервере Astral Mods",
        need: 1,
      },
      {
        id: "build",
        icon: "layers",
        name: "Своя сборка",
        how: "Собери первую сборку в «Сборках»",
        need: 1,
      },
      {
        id: "share",
        icon: "link",
        name: "Поделился",
        how: "Отправь сборку другу по ссылке",
        need: 1,
        source: "none",
      },
      {
        id: "fav",
        icon: "heart",
        name: "Избранное",
        how: "Добавь 10 модов в избранное",
        need: 10,
      },
    ],
  },
  {
    id: "collect",
    name: "Коллекция",
    items: [
      {
        id: "collector",
        icon: "box",
        name: "Коллекционер",
        how: "Держи в игре 10, 25, 50, 100 модов",
        steps: [10, 25, 50, 100],
      },
      {
        id: "redux",
        icon: "sun",
        name: "Редуксы",
        how: "Поставь 3 редукса",
        need: 3,
      },
      {
        id: "guns",
        icon: "crosshair",
        name: "Ганпаки",
        how: "Поставь 5 ганпаков",
        need: 5,
      },
      {
        id: "wardrobe",
        icon: "shirt",
        name: "Гардероб",
        how: "Поставь 10 вещей одежды",
        need: 10,
      },
      {
        id: "night",
        icon: "moon",
        name: "Ночной город",
        how: "Поставь фонари и небо",
        need: 2,
      },
      {
        id: "explorer",
        icon: "grid",
        name: "Всё понемногу",
        how: "Моды из 6 разных разделов каталога",
        need: 6,
      },
    ],
  },
  {
    id: "workshop",
    name: "Мастерская",
    items: [
      {
        id: "own-gunpack",
        icon: "wrench",
        name: "Свой ганпак",
        how: "Собери ганпак в мастерской оружия: от 4 стволов",
        need: 1,
      },
      {
        id: "fitting",
        icon: "hanger",
        name: "Примерочная",
        how: "Сделай заменёнку в мастерской одежды",
        need: 1,
      },
      {
        id: "optimizer",
        icon: "gauge",
        name: "Лёгкая игра",
        how: "Поставь оптимизацию: текстуры или дальность",
        need: 1,
      },
      {
        id: "radar",
        icon: "radar",
        name: "Свой радар",
        how: "Поменяй мини-карту или значки на карте",
        need: 1,
      },
    ],
  },
  {
    id: "team",
    name: "Astral",
    items: [
      {
        id: "alpha",
        icon: "alpha",
        name: "Альфа-тестер",
        how: "Приглашение в альфу: новые сборки раньше всех",
        need: 1,
      },
      {
        id: "beta",
        icon: "beta",
        name: "Бета-тестер",
        how: "Доступ к ранним сборкам до выхода",
        need: 1,
      },
      {
        id: "bug",
        icon: "bug",
        name: "Нашёл баг",
        how: "Сообщи об ошибке в поддержку — команда подтвердит",
        need: 1,
        source: "none",
      },
      {
        id: "veteran",
        icon: "clock",
        name: "Старожил",
        how: "30, 100, 365 дней с Astral",
        steps: [30, 100, 365],
        source: "none",
      },
    ],
  },
  {
    id: "season",
    name: "Сезон",
    items: [
      {
        id: "advent",
        icon: "gift",
        name: "Адвент 2026",
        how: "Открой все 24 окна адвент-календаря",
        need: 24,
        source: "none",
      },
    ],
  },
]);

export const ALL_BADGES = Object.freeze(
  BADGE_GROUPS.flatMap((group) => group.items),
);

export const badgeById = (id) =>
  ALL_BADGES.find((badge) => badge.id === id) || null;

const stageOf = (steps, have) =>
  steps.reduce((stage, step, at) => (have >= step ? at + 1 : stage), 0);

/*
 * Состояние значка по цифре `have` (макет: `AstralBadgeArt.info`).
 *   got  — получен; prog — есть прогресс, но до цели не хватает; lock — прогресса нет;
 *   soon — окну неоткуда знать (`source: "none"`).
 * `ring` — на медали кольцо пути: у значка в процессе и у ступенчатого до последней ступени.
 */
export function badgeInfo(badge, have = 0) {
  const known = badge.source !== "none";
  const value = known ? Math.max(0, Number(have) || 0) : 0;
  const info = {
    id: badge.id,
    have: value,
    steps: badge.steps || null,
    total: 0,
    stage: 0,
    need: null,
    next: null,
    pct: 0,
    ring: false,
    state: "lock",
    done: false,
  };
  if (badge.steps) {
    info.total = badge.steps.length;
    info.stage = stageOf(badge.steps, value);
    info.next = badge.steps[info.stage] || null;
    info.need = info.next || badge.steps[badge.steps.length - 1];
    info.pct = info.next ? Math.min(1, value / info.next) : 1;
    info.done = info.stage > 0;
  } else {
    info.need = badge.need ?? 1;
    info.done = value >= info.need;
    info.pct = info.done ? 1 : Math.min(1, value / info.need);
  }
  info.state = info.done ? "got" : info.pct > 0 ? "prog" : "lock";
  if (!known) info.state = "soon";
  info.ring =
    info.state === "prog" ||
    (info.state === "got" && Boolean(badge.steps) && info.stage < info.total);
  return info;
}
