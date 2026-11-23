/*
 * Что сказать человеку после установки заменёнки: увидит ли её клиент сервера (14.11.2026, `docs/clothing/server-routes.md`).
 *
 * «Установлено» в журнале не значит «видно в игре»: Majestic грузит только DLC из белого списка, RAGE MP запускают из своей папки игры, а Astral Clothing DLC игра подключает,
 * только если он записан в `dlclist.xml` внутри `update.rpf`. Здесь маршруты установленных вещей (`clothing-route.js`) и факты проверки (`clothing-registration-check.js`)
 * сводятся в короткий список кодов с параметрами — окно (`features/clothing/install-words.js`) переводит их в слова на языке интерфейса. Тексты здесь не пишутся: Desktop говорит
 * кодами, окно — словами (шесть языков).
 *
 * Чистый модуль: диска и реестра не трогает.
 */

import path from "node:path";

const same = (left, right) =>
  Boolean(left && right) &&
  path.win32.resolve(String(left)).toLowerCase() ===
    path.win32.resolve(String(right)).toLowerCase();

/** Ключ маршрута: вещи с одинаковым маршрутом говорят одно и то же один раз. */
const keyOf = (route) =>
  [
    route.route,
    route.server || "",
    route.pack || "",
    route.why || "",
    route.container === true ? "container" : "",
  ].join("|");

/**
 * Вещь ушла в контейнер `x64/astral/astral_rp_clothing.rpf` внутри `update.rpf` (режим `ASTRAL_CLOTHING_VIA_UPDATE`, GTA 5 RP): метку `container: true` на маршруте ставит приложение (`clothing-replace.js`),
 * только когда режим включён и ВСЕ файлы вещи переведены. Такую запись клиент RAGE MP видит (заходы владельца 20.11), поэтому слова «записана в Astral Clothing DLC, на GTA 5 RP её не видно» к ней
 * не относятся. Цель Majestic сюда не входит: одежду из контейнера на Majestic не проверяли — слова её маршрута прежние. Без метки всё как до этой работы.
 */
const inContainer = (route) =>
  route.container === true &&
  route.route === "astral" &&
  route.server !== "majestic";

/* Слова о самом маршруте: что записано и кто это увидит. `level`: info — как задумано, warn — часть клиентов заменёнку не увидит или не проверено в игре. */
function routeProblem(route) {
  if (route.route === "pack")
    return {
      level: "info",
      code: route.server === "majestic" ? "pack-majestic" : "pack",
      pack: route.pack,
    };
  if (route.route === "overlay")
    return { level: "warn", code: "overlay", pack: route.pack };
  if (inContainer(route)) return { level: "info", code: "container-gta5rp" };
  if (route.why === "base") return { level: "warn", code: "astral-base" };
  if (route.why === "pack")
    return { level: "warn", code: "astral-pack", pack: route.pack };
  if (route.why === "files")
    return { level: "warn", code: "astral-files", pack: route.pack };
  /* Файл вещи перекрыт копией в патч-паке вне белого списка (`later`; `pack` — этот патч) или порядок паков не прочитался (`order`): запись в пак вещи игра не увидела бы, Astral Clothing DLC грузится последним. */
  if (route.why === "later")
    return { level: "warn", code: "astral-later", pack: route.pack };
  if (route.why === "order") return { level: "warn", code: "astral-order" };
  /* Цвет вещи (бронежилет): в паке игры нет файла этого цвета или модели кроя лежат в разных архивах — на месте одной записью не заменить. */
  if (route.why === "colour")
    return { level: "warn", code: "astral-colour", pack: route.pack };
  if (route.why === "split")
    return { level: "warn", code: "astral-split", pack: route.pack };
  if (route.server === "gta5rp")
    return { level: "warn", code: "astral-gta5rp" };
  return { level: "warn", code: "astral-unknown" };
}

/**
 * Какие клиенты увидят запись этого маршрута (находка 5 ревью, 14.11.2026): RAGE MP — если маршрут не «нет» для него и цель не Majestic (игрок, ставящий вещь для Majestic, про RAGE MP
 * не спрашивал: папка игры у RAGE MP ему ни при чём); Majestic — если маршрут не «нет» для него.
 * @returns {Array<"rage"|"majestic">}
 */
export function routeClients(route) {
  const clients = [];
  if (route?.ragemp !== "no" && route?.server !== "majestic")
    clients.push("rage");
  if (route?.majestic !== "no") clients.push("majestic");
  return clients;
}

/**
 * @param {{ routes: Array<object>, facts?: object|null, gameRoot?: string, extra?: Array<object> }} input `routes` — `route` каждой установленной вещи; `facts` — `clothingVisibilityFacts`;
 *   `extra` — что не сошлось при самой установке (например, прежняя заменёнка не снялась): кладётся в список как есть
 * @returns {{ problems: Array<{ level: "info"|"warn"|"error", code: string, [key: string]: unknown }>, clean: boolean }}
 *   `problems` — сначала то, что мешает (регистрация, папки игры), потом слова о маршрутах; `clean` — нечего оговаривать: ни одного `warn` и `error`.
 */
export function installVisibility({
  routes = [],
  facts = null,
  gameRoot = "",
  extra = [],
}) {
  const list = routes.filter(Boolean);
  const problems = [];
  const root = gameRoot || facts?.gameRoot || "";
  /* Вещи в контейнере регистрация Astral Clothing DLC не нужна. */
  const usesAstral = list.some((route) => route.route === "astral" && route.container !== true);
  /* Astral Clothing DLC игра подключает, только если он записан в dlclist.xml внутри update.rpf. */
  if (
    usesAstral &&
    facts?.registration?.checked === true &&
    facts.registration.registered === false
  )
    problems.push({ level: "error", code: "registration-missing" });
  /* RAGE MP запускает игру из папки реестра (`game_v_path`), Majestic — из `prefs.latest.json`: записи в другую папку они не читают. Ошибка — когда запись не увидит НИ ОДИН клиент маршрута;
     если другой клиент той же вещи смотрит в нужную папку — предупреждение о части («на RAGE MP не появится, на Majestic появится»). */
  const wrong = {
    rage: Boolean(facts?.ragePath && !same(facts.ragePath, root)),
    majestic: Boolean(facts?.majesticPath && !same(facts.majesticPath, root)),
  };
  const blind = new Set();
  const partial = new Set();
  for (const route of list) {
    const clients = routeClients(route);
    const bad = clients.filter((client) => wrong[client]);
    if (!bad.length) continue;
    const bucket = bad.length === clients.length ? blind : partial;
    for (const client of bad) bucket.add(client);
  }
  for (const client of ["rage", "majestic"]) {
    const rage = client === "rage";
    const code = rage ? "rage-path" : "majestic-path";
    const found = rage ? facts?.ragePath : facts?.majesticPath;
    const other = rage ? facts?.majesticPath : facts?.ragePath;
    if (blind.has(client))
      problems.push({ level: "error", code, path: found, gameRoot: root });
    else if (partial.has(client))
      problems.push({
        level: "warn",
        code: `${code}-partial`,
        path: found,
        gameRoot: root,
        /* Что второй клиент ту же вещь увидит — только когда его папка прочитана и совпала. */
        otherOk: Boolean(other && same(other, root)),
      });
  }
  problems.push(...extra.filter(Boolean));
  const seen = new Set();
  for (const route of list) {
    const key = keyOf(route);
    if (seen.has(key)) continue;
    seen.add(key);
    /* RAGE MP смотрит в другую папку: об этом уже сказано выше, а «на GTA 5 RP вещь видна» говорить нельзя. */
    if (inContainer(route) && (blind.has("rage") || partial.has("rage"))) continue;
    problems.push(routeProblem(route));
  }
  return {
    problems,
    clean: !problems.some((problem) => problem.level !== "info"),
  };
}
