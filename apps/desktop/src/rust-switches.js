import fs from "node:fs";
import path from "node:path";

import { PACK_CARRIERS_ID, applyPackCarriers, packCarriersState } from "./pack-carriers-switch.js";

export const RUST_SWITCH_STORE = "rust-switches.json";
export const RUST_SWITCH_CHANNEL = "alpha";

const ENV_PREFIX = "ASTRAL_RUST_";
const ALPHA_ONLY_TEXT = "Переключатели нового движка доступны только в альфа-канале.";

// Таблица групп: строка на группу — её id и выключатели «ИМЯ=ab» (имя без префикса и две цифры:
// «включён у движка по умолчанию» и «включать в альфе»). Ноль во второй цифре — путь ещё не сверен в игре.
// READERS=01 с 20.11.2026 (слово владельца): читатели вкладок мастерской (эффекты попаданий, большая карта, килл-эффекты) на командах движка — выключатель `ASTRAL_RUST_READERS` (`rust-readers.js`, слово `on` — все
// три). В альфе включены (docs/ALPHA-DEFAULTS-2011.md); аварийно — `ASTRAL_RUST_READERS=off` или панель «Новый движок»; в бете и релизе — нет, пока группа не сверена.
// PACK_WEAPON_VOICE=11 с 22.11.2026: голос звукового пака стволам (`pack-weapon-overrides.js`, шаг после установки пака в `installer-ipc.js`) — на JS, команды движка у него нет; до этого шёл только в альфе (`01`), и в релизе пак ставился без голоса стволам. Аварийно — `ASTRAL_RUST_PACK_WEAPON_VOICE=off` или панель.
// LAMP=00 с 18.11.2026: в игре на пути движка у столбов пропадала гирлянда и свечение лампочек (сильный ПК, 30 сцен из 30,
// docs/TEAM-ZONES.md). Причина в движке исправлена 19.11 (a633032e7, в игре проверено), с 20.11.2026 — «01» по слову владельца;
// аварийно — `ASTRAL_RUST_LAMP=off` или панель (docs/ALPHA-DEFAULTS-2011.md).
const GROUP_TABLE = `
  models SHOP_EMBED=11 SPLIT_SHEET=11 GRAFT=11 DECORATE=11 RESTYLE=11 RESTYLE_MODEL=01 SIGN_MODELS=00 PLACEMENTS=11 MANIFEST=11
  sky SKY_RAINBOW=00 SKY_CLIP=00 SKY_FLYER=00 STAR_MODEL=00 STAR_CLIP=00 TIMECYCLE=11
  emblems EMBLEM_PLATES=01 CLIMB=01
  lamps LAMP=01 LAMP_LOD=01 LAMP_STUDIO=01 LAMP_INSPECT=01 LAMP_PLAN=01 LAMP_PATCH=00 LAMP_VERIFY=01 LAMP_STUDIO_INSPECT=01 LAMP_GLASS=01 LAMP_YTYP=01 LAMP_ARCHIVE=00
  sound AWC_INSPECT=01 PACK_WEAPON_VOICE=11
  ypt PTFX_RULES=11 PACK_TEXTURES=01 YPT_INSPECT=01
  interiors INTERIOR_LAYOUT=11 INTERIOR_YTYP=11 INTERIOR_YMAP=01 MLO_MODELS=00 PLACE_TYPES=11
  megamall MEGA_MALL=00
  weapons WEAPONS_META=01
  readers READERS=01
`;

function flagFromWord(word) {
  const [name, marks] = word.split("=");
  const env = ENV_PREFIX + name;
  return { env, defaultOn: marks[0] === "1", alphaDefault: marks[1] === "1" };
}

function groupFromLine(line) {
  const parts = line.trim().split(/\s+/);
  const [id, ...words] = parts;
  const flags = words.map(flagFromWord);
  return { id, flags };
}

export const RUST_SWITCH_GROUPS = Object.freeze(GROUP_TABLE.trim().split("\n").map(groupFromLine));

// Слова по значению; всё, чего нет ни в одном из двух списков, считается незнакомым.
const TRUE_WORDS = "on 1 true yes";
const FALSE_WORDS = "off 0 false no";

function wordMap() {
  const entries = [];
  for (const word of TRUE_WORDS.split(" ")) entries.push([word, true]);
  for (const word of FALSE_WORDS.split(" ")) entries.push([word, false]);
  return new Map(entries);
}

const WORDS = wordMap();

// Незнакомое слово (и пустое) отдаёт умолчание как есть, без приведения к булеву.
export function switchOn(value, defaultOn) {
  const key = String(value ?? "").trim().toLowerCase();
  return WORDS.has(key) ? WORDS.get(key) : defaultOn;
}

function isUnset(value) {
  return /^\s*$/.test(String(value ?? ""));
}

const GROUP_STATE_RULES = [
  { when: (tally) => tally.off === 0, name: "on" },
  { when: (tally) => tally.on === 0, name: "off" },
  { when: () => true, name: "mixed" },
];

export function groupState(group, env = process.env) {
  const verdicts = group.flags.map((flag) => switchOn(env[flag.env], flag.defaultOn));
  const tally = { on: 0, off: 0 };
  for (const verdict of verdicts) tally[verdict ? "on" : "off"] += 1;
  return GROUP_STATE_RULES.find((rule) => rule.when(tally)).name;
}

export function setGroupSwitches(group, on, env = process.env) {
  const word = on ? "on" : "off";
  return group.flags.map((flag) => {
    env[flag.env] = word;
    return flag.env;
  });
}

function forAlphaChannel(channel) {
  return channel === RUST_SWITCH_CHANNEL;
}

// `request.packCarriers` — сохранённый выбор «Дороги и трава вместе на GTA 5 RP» (`true`/`false`/нет); в ответе — слово для строки окна. Это не группа движка: в `groups` её нет.
export function rustSwitchState(request) {
  const { alpha } = request;
  const env = request.env === undefined ? process.env : request.env;
  if (!alpha) return { alpha: false, groups: {} };
  const groups = {};
  for (const group of RUST_SWITCH_GROUPS) groups[group.id] = groupState(group, env);
  return { alpha: true, groups, packCarriers: packCarriersState({ chosen: request.packCarriers, env }) };
}

// Хранилище выбора человека в замыкании на свой файл: его мог править кто угодно, поэтому читаем только
// известные группы со строго булевым значением; запись — через временный файл.
function choiceStore(file) {
  function read() {
    let parsed;
    try {
      const text = fs.readFileSync(file, "utf8");
      parsed = JSON.parse(text);
    } catch {
      return {};
    }
    const groups = parsed?.groups;
    const isPlainData = groups && typeof groups === "object";
    if (!isPlainData) return {};
    /* Выбор «Дороги и трава вместе» лежит в том же файле (`pack-carriers-switch.js`); без его id запись любой группы затирала бы его при перечитывании. */
    const validIds = new Set([...RUST_SWITCH_GROUPS.map((group) => group.id), PACK_CARRIERS_ID]);
    const result = {};
    for (const [id, value] of Object.entries(groups)) {
      if (typeof value === "boolean" && validIds.has(id)) result[id] = value;
    }
    return result;
  }

  function write(choice) {
    const body = `${JSON.stringify({ version: 1, groups: choice }, null, 2)}\n`;
    const staging = `${file}.${process.pid}.tmp`;
    const folder = path.dirname(file);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(staging, body);
    fs.renameSync(staging, file);
  }

  return { read, write };
}

function flagsOf(groups) {
  return groups.flatMap((group) => group.flags.map((flag) => ({ flag, group })));
}

// Правило → проверка окружения → установка — в этом порядке и сразу друг за другом на каждом выключателе
// (окружение может быть прокси/геттером, чьи обращения различимы снаружи).
function applyIfUnset(env, flag, word) {
  if (word === undefined) return null;
  if (!isUnset(env[flag.env])) return null;
  env[flag.env] = word;
  return flag.env;
}

function fillUnsetByRule(env, rule) {
  const touched = flagsOf(RUST_SWITCH_GROUPS).map(({ flag, group }) => applyIfUnset(env, flag, rule(flag, group)));
  return touched.filter((name) => name !== null);
}

export function applyStoredRustSwitches(request) {
  const { file } = request;
  const channel = request.channel;
  const env = request.env === undefined ? process.env : request.env;
  if (!forAlphaChannel(channel)) return [];
  const choice = choiceStore(file).read();
  const stored = (group) => Object.hasOwn(choice, group.id);
  const wordOf = (flag, group) => (stored(group) ? (choice[group.id] ? "on" : "off") : undefined);
  fillUnsetByRule(env, wordOf);
  return RUST_SWITCH_GROUPS.filter(stored).map((group) => group.id);
}

export function applyAlphaDefaults(request) {
  const { channel } = request;
  const env = request.env === undefined ? process.env : request.env;
  if (!forAlphaChannel(channel)) return [];
  const defaultWord = (flag) => (flag.alphaDefault === false ? undefined : "on");
  return fillUnsetByRule(env, defaultWord);
}

// Группы, о которых просит окно: «all» — все, иначе точное совпадение id.
function selectGroups(group) {
  if (group === "all") return RUST_SWITCH_GROUPS;
  return RUST_SWITCH_GROUPS.filter((item) => item.id === group);
}

// Проверки установки в порядке выполнения: первая не прошедшая отдаёт отказ.
function refusalFor(request) {
  const { alpha, on, group } = request;
  if (!alpha) return new Error(ALPHA_ONLY_TEXT);
  if (typeof on !== "boolean") return new TypeError("on must be a boolean.");
  const known = group === PACK_CARRIERS_ID || selectGroups(group).length > 0;
  return known ? null : new TypeError(`Unknown switch group: ${group}`);
}

function ipcState(file, alpha, env) {
  return rustSwitchState({ alpha, env, packCarriers: alpha ? choiceStore(file).read()[PACK_CARRIERS_ID] : undefined });
}

function ipcSet(file, alpha, env, { group, on }) {
  const refusal = refusalFor({ alpha, group, on });
  if (refusal) throw refusal;
  const store = choiceStore(file);
  const choice = store.read();
  // «Дороги и трава вместе»: только выбор в файле, окружение не трогаем — носители читаются при старте, действует после перезапуска (`pack-carriers-switch.js`).
  if (group === PACK_CARRIERS_ID) {
    choice[PACK_CARRIERS_ID] = on;
    store.write(choice);
    return rustSwitchState({ alpha: true, env, packCarriers: on });
  }
  // Окружение меняется раньше записи файла: сбой записи не откатывает выключатели.
  for (const target of selectGroups(group)) {
    setGroupSwitches(target, on, env);
    choice[target.id] = on;
  }
  store.write(choice);
  return rustSwitchState({ alpha: true, env, packCarriers: choice[PACK_CARRIERS_ID] });
}

export function createRustSwitchesIpc(request) {
  const { file, channel } = request;
  const env = request.env === undefined ? process.env : request.env;
  const alpha = forAlphaChannel(channel);
  return {
    state: () => ipcState(file, alpha, env),
    set: (input) => ipcSet(file, alpha, env, input),
  };
}

function stateRoute(ipc, trusted) {
  return (event) => trusted(event, () => ipc.state());
}

function setRoute(ipc, trusted) {
  return (event, input) => trusted(event, () => ipc.set(input));
}

export function registerRustSwitchesIpc(request) {
  const { IPC, handleIpc, trusted, file, channel } = request;
  const env = request.env === undefined ? process.env : request.env;
  const ipc = createRustSwitchesIpc({ file, channel, env });
  const routeTable = [
    [() => IPC.RUST_SWITCHES_STATE, stateRoute(ipc, trusted)],
    [() => IPC.RUST_SWITCHES_SET, setRoute(ipc, trusted)],
  ];
  for (const [channelKey, handler] of routeTable) handleIpc(channelKey(), handler);
  return ipc;
}

export function rustSwitchesForApp(request) {
  const { app, channel } = request;
  const env = request.env === undefined ? process.env : request.env;
  const file = path.join(app.getPath("userData"), RUST_SWITCH_STORE);
  applyStoredRustSwitches({ file, channel, env });
  applyAlphaDefaults({ channel, env });
  // «Дороги и трава вместе на GTA 5 RP»: сохранённый выбор → `ASTRAL_CARRIERS=update2,mpbiker`, если человек не задал переменную сам. Вызов — раньше режима RP (`channels/index.js`): режим читает эту переменную.
  applyPackCarriers({ channel, env, chosen: choiceStore(file).read()[PACK_CARRIERS_ID] });
  return { registerIpc: (wiring) => registerRustSwitchesIpc({ ...wiring, file, channel, env }) };
}
