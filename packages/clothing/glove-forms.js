/*
 * Перчатки — вид целиком, а не номера (29.10.2026, владелец: «Перчатка — один стиль. … Человек нажимает «Установить» — и ему предлагается выбор, на какую
 * перчатку он хочет заменить»).
 *
 * Как устроены перчатки в игре (проверено по файлам игры владельца 29.10.2026). У перчаток нет одной модели: руки у игры — часть тела (`uppr`), и верх (`jbib`)
 * выбирает руки по своему крою торса. Поэтому одна перчатка — блок из 11 моделей `uppr`, по одной на крой торса: «Черные шерстяные перчатки» — №22–32 в коллекции
 * `mp_m_freemode_01_male_heist`, «Черные полуперчатки» — №33–43, «Хирургические» — №66–76. Блок называется одним именем на все 11 номеров. Те же 11 кроёв —
 * в базовой игре: рука без перчатки есть у типов торса 0, 1, 2, 4, 5, 6, 8, 11, 12, 14, 15 (в архиве `x64v` три набора ровно с такими номерами), и у блока форма
 * номер `i` — тип `GLOVE_TORSO_TYPES[i]`. Блоки других размеров (Байкеры, Лето, Рождество) число кроёв не повторяют — тип там неизвестен.
 *
 * Здесь — чистые функции для окна, движка и разбора:
 *   • `markGloveBlocks(rows)` — строки игры (`gameAssortmentRows`) → блоки перчаток: у строки появляется `glove: { start, size, index }`;
 *   • `gloveTiles(items)` — вещи ассортимента → плитки «одна перчатка»: плитка — первая форма, `together` — все формы блока;
 *   • `matchGloveForms(source, target)` — какая модель мода на какой номер выбранной перчатки: по крою торса, нет такого кроя — ближайший.
 *
 * Чистый JS: работает в окне и в главном процессе.
 */

/** Типы торса, на которые у игры есть руки: форма блока из 11 моделей номер `i` — тип `GLOVE_TORSO_TYPES[i]`. */
export const GLOVE_TORSO_TYPES = Object.freeze([0, 1, 2, 4, 5, 6, 8, 11, 12, 14, 15]);
/** Блок перчатки — не больше стольких форм: дальше начинается следующая перчатка. */
export const GLOVE_BLOCK_SIZE = GLOVE_TORSO_TYPES.length;

const nameOf = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/**
 * Строки игры → те же строки, у вещей блоков перчаток — `glove: { start, size, index }`: номер первой формы блока, число форм и номер формы (с нуля). Блок — подряд идущие
 * номера `uppr` одной папки с одним именем игры, не больше `GLOVE_BLOCK_SIZE`; рука без имени (голое тело, тип торса) блока не образует. Пустышки и повторы номера
 * (вещь игры и заплатка патча) блок не ломают. Если у строки есть группа одинаковых вещей (`look`, `game-looks.js`), блок — все именованные номера этой группы в папке, даже не подряд
 * и больше `GLOVE_BLOCK_SIZE`: у Байкеров одна перчатка — №3, 10, 17, у Лета — 14 номеров. Остальные строки возвращаются как были.
 */
export function markGloveBlocks(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (row?.component !== "uppr") continue;
    const key = `${row.gender}|${String(row.folder || "").toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const byDrawable = groups.get(key);
    const have = byDrawable.get(row.drawable);
    if (!have || (have.blank && !row.blank) || (!nameOf(have.name) && nameOf(row.name))) byDrawable.set(row.drawable, row);
  }
  const marks = new Map(); // `${gender}|${folder}|${drawable}` → glove
  for (const [key, byDrawable] of groups) {
    const all = [...byDrawable.values()].sort((left, right) => left.drawable - right.drawable);
    /* Одна перчатка — те же расцветки (`game-looks.js`), а не соседние номера: у Байкеров та же перчатка лежит под №3, 10 и 17 (шаг по числу стилей), у Лета — четырнадцать номеров,
       а не 11 и 3. Именованные номера одной группы — один блок, сколько бы их ни было. */
    const looks = new Map();
    for (const row of all) {
      if (!row.look || !nameOf(row.name) || row.blank) continue;
      if (!looks.has(row.look)) looks.set(row.look, []);
      looks.get(row.look).push(row);
    }
    for (const block of looks.values()) block.forEach((row, index) => marks.set(`${key}|${row.drawable}`, Object.freeze({ start: block[0].drawable, size: block.length, index })));
    const list = all.filter((row) => !marks.has(`${key}|${row.drawable}`));
    let run = [];
    const close = () => {
      for (let from = 0; from < run.length; from += GLOVE_BLOCK_SIZE) {
        const block = run.slice(from, from + GLOVE_BLOCK_SIZE);
        block.forEach((row, index) =>
          marks.set(`${key}|${row.drawable}`, Object.freeze({ start: block[0].drawable, size: block.length, index })),
        );
      }
      run = [];
    };
    for (const row of list) {
      const name = nameOf(row.name);
      const last = run.at(-1);
      if (!name || row.blank) {
        close();
        continue;
      }
      if (last && (row.drawable !== last.drawable + 1 || nameOf(last.name) !== name)) close();
      run.push(row);
    }
    close();
  }
  return (rows || []).map((row) => {
    const glove = row?.component === "uppr" ? marks.get(`${row.gender}|${String(row.folder || "").toLowerCase()}|${row.drawable}`) : null;
    return glove ? { ...row, glove } : row;
  });
}

/**
 * Вещи ассортимента вида `uppr` → плитки «одна перчатка» для выбора. Плитка — первая по номеру форма блока (картинка, число цветов и ключ — её), `together` — все формы блока
 * по возрастанию номера: выбор плитки — выбор всех. Имя плитки — то, как перчатку зовёт сервер (имя есть у любой формы блока: проект называет перчатку одним номером), нет —
 * имя игры. Рука без имени — голое тело, не перчатка, и в плитки не идёт.
 */
export function gloveTiles(items) {
  /* Игра не прочитана (нет файлов, браузер): блоков игры нет, а номера, что назвал сам автор мода, — есть. Подряд идущие номера автора с одним именем (или без имени) — одна
     перчатка (не больше `GLOVE_BLOCK_SIZE`): набор можно поставить «как задумал автор». */
  const own = new Map();
  const unmarked = (items || [])
    .filter((item) => item?.component === "uppr" && !item.glove && item.sources?.includes("author"))
    .sort((left, right) => String(left.folder).localeCompare(String(right.folder)) || left.drawable - right.drawable);
  let run = [];
  const close = () => {
    for (let from = 0; from < run.length; from += GLOVE_BLOCK_SIZE) {
      const block = run.slice(from, from + GLOVE_BLOCK_SIZE);
      block.forEach((item, index) => own.set(`${item.folder}|${item.drawable}`, { start: block[0].drawable, size: block.length, index }));
    }
    run = [];
  };
  for (const item of unmarked) {
    const last = run.at(-1);
    if (last && (last.folder !== item.folder || last.drawable + 1 !== item.drawable || nameOf(last.name) !== nameOf(item.name))) close();
    run.push(item);
  }
  close();
  const markOf = (item) => item.glove || own.get(`${item.folder}|${item.drawable}`) || null;
  const blocks = new Map();
  for (const item of items || []) {
    if (item?.component !== "uppr") continue;
    const mark = markOf(item);
    const key = mark ? `${item.folder}|${mark.start}` : `${item.folder}|${item.drawable}`;
    blocks.set(key, [...(blocks.get(key) || []), mark && !item.glove ? { ...item, glove: mark } : item]);
  }
  const tiles = [];
  for (const forms of blocks.values()) {
    const sorted = [...forms].sort((left, right) => left.drawable - right.drawable);
    const named = sorted.find((item) => item.name && item.server) || sorted.find((item) => item.name);
    /* Без имени — только перчатка автора мода (его номера): остальные безымянные руки — голое тело. */
    if (!named && !sorted.some((item) => item.sources?.includes("author"))) continue;
    const [first] = sorted;
    const tile = {
      ...first,
      /* Сервер назвал одну форму блока — вся перчатка стоит на его полке, а не среди вещей игры. */
      server: sorted.find((item) => item.server)?.server || null,
      name: named?.name || null,
      shop: named?.shop || first.shop,
      preview: first.preview || named?.preview || null,
      sources: [...new Set(sorted.flatMap((item) => item.sources || []))],
      together: sorted,
      glove: first.glove || { start: first.drawable, size: 1, index: 0 },
    };
    /* Строки игры по языкам (`names`) идут за именем: плитка берёт их у той формы, чьё имя взяла. */
    if (named?.names) tile.names = named.names;
    else delete tile.names;
    tiles.push(tile);
  }
  return tiles;
}

/** Тип торса формы: у блока из 11 моделей он известен по номеру формы, у блоков других размеров — нет. */
export function gloveTorsoType(form) {
  return form?.size === GLOVE_BLOCK_SIZE ? GLOVE_TORSO_TYPES[form.index] : null;
}

/**
 * Какая модель мода на какой номер выбранной перчатки. `source` — формы мода, `target` — формы выбранной перчатки: `[{ drawable, index, size }]` (`index` — номер формы в
 * блоке, `size` — сколько форм в блоке). Каждая форма цели получает форму мода того же кроя торса; нет такого кроя у мода — ближайший (по типу торса, а у блоков других размеров —
 * по месту в блоке). Возвращает `{ pairs: [{ target, source, exact }], notExact, unused }`: `pairs` — по строке на форму цели, `notExact` — у скольких цель получила не тот крой,
 * `unused` — сколько форм мода не пригодилось. Нет форм мода или цели — пустые пары.
 */
export function matchGloveForms(source, target) {
  const from = [...(source || [])].sort((left, right) => left.drawable - right.drawable);
  const to = [...(target || [])].sort((left, right) => left.drawable - right.drawable);
  if (!from.length || !to.length) return { pairs: [], notExact: 0, unused: from.length };
  /* Положение формы в блоке от 0 до 1: у блоков разных размеров ближайший крой — по нему. */
  const place = (form) => (form.size > 1 ? form.index / (form.size - 1) : 0);
  const pairs = to.map((one) => {
    const type = gloveTorsoType(one);
    const exact = type === null ? from.find((form) => form.size === one.size && form.index === one.index) : from.find((form) => gloveTorsoType(form) === type);
    if (exact) return { target: one, source: exact, exact: true };
    const distance = (form) => {
      const other = gloveTorsoType(form);
      return type !== null && other !== null ? Math.abs(other - type) : Math.abs(place(form) - place(one)) * 100;
    };
    const nearest = [...from].sort((left, right) => distance(left) - distance(right) || left.drawable - right.drawable)[0];
    return { target: one, source: nearest, exact: false };
  });
  const used = new Set(pairs.map((pair) => pair.source.drawable));
  return { pairs, notExact: pairs.filter((pair) => !pair.exact).length, unused: from.filter((form) => !used.has(form.drawable)).length };
}

/**
 * Формы мода из его «Заменяет» (`[{ folder, drawable }]`): номер формы и размер блока берутся у игры (`blockOf(folder, drawable)` — `glove` строки игры), нет игры — по порядку
 * подряд идущих номеров мода (набор из 11 подряд — блок целиком). Повторы номера (мод назвал его на двух серверах) — одна форма.
 */
export function modGloveForms(replaces, blockOf = () => null) {
  const seen = new Map();
  for (const place of replaces || []) {
    const drawable = Number(place?.drawable);
    if (!Number.isInteger(drawable) || seen.has(drawable)) continue;
    seen.set(drawable, place);
  }
  const numbers = [...seen.keys()].sort((left, right) => left - right);
  const own = new Map();
  let run = [];
  const close = () => {
    run.forEach((drawable, index) => own.set(drawable, { index, size: run.length }));
    run = [];
  };
  for (const drawable of numbers) {
    if (run.length && drawable !== run.at(-1) + 1) close();
    run.push(drawable);
  }
  close();
  return numbers.map((drawable) => {
    const known = blockOf(seen.get(drawable));
    return known ? { drawable, index: known.index, size: known.size } : { drawable, ...own.get(drawable) };
  });
}

/** Описание карточки набора перчаток: без номеров и «своих мест» — перчатка один стиль, ставится на выбранную. `genderLabel` — «Мужское», «Женское» или «пол уточнить». */
export const gloveSetDescription = (genderLabel) =>
  `Руки и перчатки · ${genderLabel}. Одна перчатка: модели под разные крои торса. Встаёт на любую перчатку игры или сервера — модель под нужный торс подберётся сама.`;
