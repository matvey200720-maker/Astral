import * as crypto from "node:crypto";
import path from "node:path";
import { discoverGames } from "@modovik/game-discovery";
import fs from "node:fs/promises";
import * as rust from "./native-engine-rust.js";

const sealed = (value) => Object.freeze(value);

// Донор — пять полей; строка таблицы идёт в том же порядке, имена полей — в DONOR_FIELDS.
const DONOR_FIELDS = ["archive", "entry", "file", "bytes", "sha256"];
const DONOR_TABLE = [
  ["x64j", "levels/gta5/_citye/hollywood_01/hw1_08.rpf/hw1_08_hotplaz_rail.ydr", "hw1_08_hotplaz_rail.ydr", 4984, "2a18d6addde729f5b65c5636de034e62e10261e3c6f0b5476cfa28c02ab8fc05"],
  ["x64l", "levels/gta5/_citye/sunset/bt1_01.rpf/bt1_01_logoglow.ydr", "bt1_01_logoglow.ydr", 552, "f754df197d806e4c05663287040b1922595ff00f2972f3b57c6f3326a69df8a5"],
  ["x64h", "levels/gta5/interiors/v_int_16.rpf/v_16_barglow.ydr", "v_16_barglow.ydr", 1388, "79640548e1b15e3a9af20731bceb36c6a15d1b8b4f7589234c3a2a3b70f15b05"],
  ["update/x64/dlcpacks/mpbiker/dlc", "x64/levels/gta5/props/mp_biker_printingmachines.rpf/bkr_prop_prtmachine_dryer_spin.ydr", "bkr_prop_prtmachine_dryer_spin.ydr", 90645, "f687cd282050c24fface713566297187a00cc4127241a5aade6c6ca40c1f4886"],
  ["x64n", "levels/gta5/_hills/cityhills_01/ch1_04b.rpf/ch1_04b_ammosign_lod.ydr", "ch1_04b_ammosign_lod.ydr", 2435, "94c52ae402e43edf99208447f6742f12b36a9710282f1240342741d1c30b2edf"],
];
const frozenDonor = (row) => sealed(Object.fromEntries(DONOR_FIELDS.map((name, at) => [name, row[at]])));
const [HW1_DONOR, GLOW_DONOR, SKY_DONOR, DRYER_DONOR, MEGA_MALL_DONOR] = DONOR_TABLE.map(frozenDonor);
export { DRYER_DONOR, GLOW_DONOR, HW1_DONOR, MEGA_MALL_DONOR, SKY_DONOR };

const SHARED_CACHE = "game-donors";
const REQUEST_WITH_DONOR = rust.DONOR_REQUEST_FILE;

// Строка маршрута: команда, подпись, источник, префикс, папка кэша, переключатель и донор
// (один донор либо список пар «поле запроса → донор»).
const ROUTE_TABLE = [
  ["compile-emblem-plates", "Плашка эмблемы", "emblem", "emblem-donor", "emblem-donor", rust.rustEmblemPlatesEnabled, HW1_DONOR],
  /* Звезда без движения — на плашке, звезда с движением — на сушилке (скелет из четырёх костей): движку идут оба донора. */
  ["compile-star-model", "Звезда", "star", "star-donor", SHARED_CACHE, rust.rustStarModelEnabled, [["donor", HW1_DONOR], ["motionDonor", DRYER_DONOR]]],
  ["compile-sky-rainbow", "Радуга", "sky", "sky-donor", SHARED_CACHE, rust.rustSkyRainbowEnabled, SKY_DONOR],
  ["compile-sky-flyer", "Летающий дирижабль", "sky-flyer", "sky-flyer-donor", SHARED_CACHE, rust.rustSkyFlyerEnabled, DRYER_DONOR],
  ["compile-mega-mall-overlay", "Мегамолл", "mega-mall", "mega-mall-donor", SHARED_CACHE, rust.rustMegaMallEnabled, MEGA_MALL_DONOR],
  ["compile-climb-markers", "Залазы", "climb", "climb-donor", SHARED_CACHE, rust.rustClimbEnabled, [["donor", HW1_DONOR], ["emissiveDonor", GLOW_DONOR]]],
  /* Знаки зон каптов, расписание, МСЛ, формы зон и надпись Vinewood: новые шейдеры и листы движок собирает на каркасе донора (18.11.2026). */
  ["compile-sign-models", "Знаки", "sign", "sign-donor", SHARED_CACHE, rust.rustSignModelsEnabled, GLOW_DONOR],
];

const routeEntry = ([command, label, source, ...rest]) => {
  const [prefix, cacheDir, enabled, donorCell] = rest;
  const donorPart = Array.isArray(donorCell)
    ? { donors: sealed(donorCell.map(([field, donor]) => sealed({ field, donor }))) }
    : { donor: donorCell };
  return [command, sealed(Object.assign({ label, source }, { prefix, cacheDir, enabled }, donorPart))];
};

export const GAME_DONOR_ROUTES = sealed(Object.fromEntries(ROUTE_TABLE.map(routeEntry)));

// Хвосты кодов отказа; код = «<префикс маршрута>-<хвост>».
const REFUSAL_TAILS = [["switchedOff", "off"], ["noGame", "no-game"], ["enhanced", "enhanced"], ["unreadable", "unreadable"]];

export const donorRefusals = (prefix) => {
  const codes = {};
  for (const [name, tail] of REFUSAL_TAILS) codes[name] = `${prefix}-${tail}`;
  return sealed(codes);
};

// Поля набора читаются по одному и по порядку списка; для полей с запасным значением
// запасное берётся, когда поле не задано (undefined) — заданное поле читается дважды.
const readSettings = (bag, names, fallbacks) => names.map(
  (name) => (name in fallbacks && bag[name] === undefined ? fallbacks[name] : bag[name]),
);

const sha256Of = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const editionIs = (name) => (game) => game.edition === name;
const infoLine = (source, message, detail) => ({ level: "info", source, message, detail });
const refusalOf = (codes, code, reason) => Object.assign({ refusal: codes[code] }, { reason });
const mkdirp = (dir) => fs.mkdir(dir, { recursive: true });

// Файл кэша годится, если читается, совпадает по длине и по SHA-256.
const cacheHoldsDonor = async (donor, file) => fs.readFile(file)
  .then((bytes) => bytes.length === donor.bytes && sha256Of(bytes) === donor.sha256)
  .catch(() => false);

// Просит движок положить файл донора в кэш; null — получилось, иначе причина сбоя чтения.
const fillCache = async (file, donor, read, gameRoot) => {
  await mkdirp(path.dirname(file));
  return Promise.resolve()
    .then(() => {
      const request = { gameRoot, entry: `${donor.archive}:/${donor.entry}`, output: file };
      return read(request);
    })
    .then(() => null, (error) => `архив не прочитан: ${error?.message || error}`);
};

// Первый непустой ответ из цепочки шагов; каждый шаг начинается после ответа предыдущего.
const firstAnswer = async (steps) => {
  for (const step of steps) {
    const answer = await step();
    if (answer) return answer;
  }
  return undefined;
};

// Вызов шага; исключение при подготовке шага становится отказом промиса, а не броском.
const deferred = async (step) => step();

const FIND_NAMES = ["stateDir", "read", "enabled", "prefix", "cacheDir", "donor", "env", "discover"];
const FIND_DEFAULTS = { env: process.env, discover: discoverGames };
const NO_INSTALL = [
  ["enhanced", "установка Enhanced: донор в формате gen9, путь донора для legacy"],
  ["noGame", "установка GTA V не найдена"],
];
const noInstall = (games, deny) => {
  const [why, reason] = NO_INSTALL[games.some(editionIs("Enhanced")) ? 0 : 1];
  return deny(why, reason);
};

export const findGameDonor = async (request) => {
  const settings = readSettings(request, FIND_NAMES, FIND_DEFAULTS);
  const [stateDir, read, enabled, prefix] = settings;
  const [cacheDir, donor, env, discover] = settings.slice(4);
  const deny = refusalOf.bind(null, donorRefusals(prefix));
  let install;
  let file;

  return firstAnswer([
    () => !enabled(env) && deny("switchedOff", "выключатель выключен"),
    async () => {
      const games = await discover();
      install = games.find(editionIs("Legacy"));
      return install ? null : noInstall(games, deny);
    },
    async () => {
      file = path.join(...[stateDir, cacheDir, donor.file]);
      return (await cacheHoldsDonor(donor, file)) && { path: file };
    },
    async () => {
      const failure = await fillCache(file, donor, read, install.path);
      return failure && deny("unreadable", failure);
    },
    async () => ((await cacheHoldsDonor(donor, file))
      ? { path: file }
      : deny("unreadable", "байты донора не совпали с SHA-256: игра изменилась")),
  ]);
};

// Чтение архива через движок: сначала ключи от provision, затем сам вызов.
const archiveReader = (provision, call, stateDir, context) => async (request) => {
  const support = await provision({ stateDir });
  const payload = { ...request, keys: support.directory };
  return call("read-archive-file", payload, context);
};

const routeFields = ({ enabled, prefix, cacheDir }) => ({ enabled, prefix, cacheDir });

// Один донор: ответ поиска вместе с полем запроса, куда ляжет путь; сбой поиска — отказ «unreadable».
const lookupDonor = async (item, shared) => {
  const { read } = shared;
  const found = await deferred(() => findGameDonor({
    ...shared.base,
    ...routeFields(shared.route),
    donor: item.donor,
    read,
  })).catch((error) => refusalOf(shared.codes, "unreadable", `сбой поиска донора: ${error?.message || error}`));
  return { found, field: item.field };
};

// Пути доноров по порядку; первый отказ прерывает обход и возвращается как есть.
const gatherPaths = async (pairs, shared) => {
  const fields = {};
  let refused = null;
  for (const item of pairs) {
    const hit = await lookupDonor(item, shared);
    refused = hit.found.refusal ? hit.found : null;
    if (refused) break;
    fields[hit.field] = hit.found.path;
  }
  return { fields, refused };
};

const noteSkippedDonor = (log, route, found) => log(
  infoLine(route.source, `${route.label}: донор не взят, сборка на хосте (${found.refusal})`, found.reason || ""),
);

/* Отмена человеком: ошибка отмены или снятый сигнал контекста. Хосту после неё работать не нужно. */
const cancelledByPerson = (error, context) => error?.name === "AbortError" || error?.code === "CANCELLED" || context?.signal?.aborted === true;

/* Хост берёт папку вывода только пустой. Движок, упавший посреди записи (антивирус, диск), оставляет в ней свои файлы, и откат на хост
   отказывал бы словами «папка не пуста». Папка, которая до движка была пустой или отсутствовала, чистится от его файлов перед хостом;
   чужое содержимое не трогается: такую папку хост всё равно не примет, и это решает он. */
const outputIsFresh = (output) => (typeof output === "string"
  ? fs.readdir(output).then((names) => names.length === 0, (error) => error?.code === "ENOENT")
  : Promise.resolve(false));
const clearEngineLeftovers = (output) => fs.readdir(output)
  .then((names) => Promise.all(names.map((name) => fs.rm(path.join(output, name), { recursive: true, force: true }))))
  .catch(() => undefined);

// Запрос с путями доноров ложится рядом с исходным запросом.
const donorRequestPath = (requestFile) => path.join(path.dirname(requestFile), REQUEST_WITH_DONOR);
const writeDonorRequest = (requestFile, fields) => fs.readFile(requestFile, "utf8")
  .then(JSON.parse)
  .then((original) => fs.writeFile(donorRequestPath(requestFile), JSON.stringify(Object.assign({}, original, fields))))
  .then(() => donorRequestPath(requestFile));

const COMPILE_NAMES = ["routes", "stateDir", "context", "call", "provision", "log", "env", "discover", "donor", "donors"];
const COMPILE_DEFAULTS = { routes: GAME_DONOR_ROUTES, context: null, log: null, env: process.env };

export const compileWithGameDonor = async (command, input, options = {}) => {
  const settings = readSettings(options, COMPILE_NAMES, COMPILE_DEFAULTS);
  const [routes, stateDir, context, call] = settings;
  const [provision, log, env, discover] = settings.slice(4);
  const [donor, donors] = settings.slice(8);
  function toHost() {
    return call(command, input, context);
  }
  const route = routes[command];

  const hostOnly = !route || !input?.input;
  if (hostOnly) return toHost();

  let pairs = donors ?? route.donors;
  pairs ??= [{ donor: donor ?? route.donor, field: "donor" }];
  const shared = {
    codes: donorRefusals(route.prefix),
    base: { stateDir, env, discover },
    route,
    read: archiveReader(provision, call, stateDir, context),
  };
  const outcome = await gatherPaths(pairs, shared);
  if (!outcome.refused) {
    const hostInput = (withDonors) => ({ ...input, input: withDonors });
    const fresh = await outputIsFresh(input.output);
    return writeDonorRequest(input.input, outcome.fields)
      .then((withDonors) => call(command, hostInput(withDonors), context))
      .catch(async (error) => {
        /* Отмена человеком — не отказ движка: хосту она не передаётся. */
        if (cancelledByPerson(error, context)) throw error;
        /* Движок с донорами не собрал («пока на хосте», другой шейдер, второй лист картинки): хосту идёт исходный запрос,
           без полей доноров — файл с ними хост не читает. Отказ самого хоста помечается, чтобы обёртки выше не звали его второй раз. */
        log?.(infoLine(route.source, `${route.label}: движок не собрал с донорами, сборка на хосте`, error?.message || String(error)));
        if (fresh) await clearEngineLeftovers(input.output);
        return toHost().catch((hostError) => {
          if (hostError && typeof hostError === "object") hostError.hostTried = true;
          throw hostError;
        });
      });
  }

  const quiet = outcome.refused.refusal === shared.codes.switchedOff || !log;
  if (!quiet) {
    noteSkippedDonor(log, route, outcome.refused);
  }
  return toHost();
};

export const compileClimbMarkers = async (command, input, options = {}) => {
  const hostFallback = (error) => {
    /* Хост уже звался с исходным запросом и отказал сам: второй раз его не зовём. */
    if (error?.hostTried) throw error;
    /* Отмена человеком — не отказ движка: `compileWithGameDonor` бросает её как есть, и хост после неё не работает (18.11.2026). */
    if (cancelledByPerson(error, options.context)) throw error;
    options.log?.(infoLine("climb", "Залазы: движок не собрал с донорами, сборка на хосте", error?.message || String(error)));
    return options.call(command, input, options.context ?? null);
  };
  return compileWithGameDonor(command, input, options).catch(hostFallback);
};
