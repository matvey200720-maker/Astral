/*
 * Проводка регулятора диска к режиму скорости установки (20.11.2026, `packages/install-engine/disk-governor.js`, `docs/DISK-GOVERNOR-2011.md`).
 *
 * Режим задаёт `storage-manager.js: SPEED_MODES`: обычный — потолки записи и чтения по диску, отдых после операции; «Быстрая установка» — ничего из этого. Регулятор идёт за режимом:
 *   — обычный: датчик занятости включён, потолки режима — это «обычная скорость» (доля 1); пока диск занят больше цели, регулятор опускает долю, и потолки для движка, сборок и копий
 *     уходят вниз тем же путём, каким их ставит режим (`apply.write`, `apply.read`); отдых после больших операций растёт (`apply.rest`);
 *   — «Быстрая установка»: регулятор выключен, потолки режима (их нет) возвращены сразу, посреди идущей работы тоже.
 * Выключатель `ASTRAL_DISK_GOVERNOR` (`1`/`on` — включено, `0`/`off` — выключено; без слова решает канал): по образцу `install-move-channel.js` в альфе включён, в бете и релизе
 * выключен до приёмки на трёх носителях. Аварийное выключение — то же слово `off`, а на ходу — `emergencyDisable()`: доля 1, датчик остановлен, потолки режима на месте.
 * Сбой датчика или регулятора установку не трогает: режим работает как до регулятора.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GOVERNOR_ENV,
  GUARD_ENV,
  diskGovernor,
  governorSwitch,
} from "@modovik/install-engine/disk-governor.js";
import { createDiskSensor } from "@modovik/install-engine/disk-sensor.js";
import { diskPerformance, diskPerformanceAvailable } from "@modovik/native-rs";

/** Канал, где регулятор включён по умолчанию. */
export const DISK_GOVERNOR_CHANNEL = "alpha";

/** Ставит умолчание канала, если выключатель не задан. Отдаёт поставленное слово или `null`, если ничего не менял. */
export function applyDiskGovernorDefault({ channel, env = process.env } = {}) {
  if (channel !== DISK_GOVERNOR_CHANNEL) return null;
  if (String(env[GOVERNOR_ENV] ?? "").trim() !== "") return null;
  env[GOVERNOR_ENV] = "1";
  return "1";
}

/** Файл аварийного выключения без переменных окружения: тестер кладёт `%LOCALAPPDATA%\Astral\disk-governor.off` — регулятор не включается (проверяется при старте и при каждой смене режима скорости). */
export const EMERGENCY_FILE = "disk-governor.off";
export function emergencyFlagSet(env = process.env) {
  const root = env?.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  try {
    return fs.existsSync(path.join(root, "Astral", EMERGENCY_FILE));
  } catch {
    return false;
  }
}

export const diskGovernorEnabled = (env = process.env) =>
  governorSwitch(env?.[GOVERNOR_ENV]) === true && !emergencyFlagSet(env);

/*
 * Мягкий сторож «Быстрой установки» (`ASTRAL_DISK_GUARD`, 20.11.2026): отдельный выключатель, пусто — решает канал (`applyDiskGuardDefault`). Аварийный файл `disk-governor.off` выключает и его.
 * Решение владельца: «быстро, но диск не в сотку»; пока замеры цены не приняты (`docs/DISK-GOVERNOR-2011.md`, раздел 6.9), по умолчанию не включён нигде.
 */
export const DISK_GUARD_ALPHA_DEFAULT = false;
export function applyDiskGuardDefault({ channel, env = process.env } = {}) {
  if (!DISK_GUARD_ALPHA_DEFAULT || channel !== DISK_GOVERNOR_CHANNEL)
    return null;
  if (String(env[GUARD_ENV] ?? "").trim() !== "") return null;
  env[GUARD_ENV] = "1";
  return "1";
}
export const diskGuardEnabled = (env = process.env) =>
  governorSwitch(env?.[GUARD_ENV]) === true && !emergencyFlagSet(env);

/*
 * Выученные скорости между запусками (20.11.2026): регулятор помнит по каждому диску скорость, при которой активное время ≈ цели, и отдаёт её потолками при запуске следующей команды.
 * Диск опознаётся по серийному номеру тома (`stat.dev` у Node на Windows — он), а не по букве: буква переезжает, том остаётся. Выученное устаревает за 30 дней. Файл
 * `%LOCALAPPDATA%\Astral\disk-governor.json`; стенд называет свой словом `ASTRAL_DISK_GOVERNOR_LEARNED=<файл>`, чтобы замеры не писали в настоящий.
 */
export const LEARNED_ENV = "ASTRAL_DISK_GOVERNOR_LEARNED";
const LEARNED_SAVE_DELAY_MS = 5000;
export const LEARNED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function learnedFilePath(env = process.env) {
  const named = String(env?.[LEARNED_ENV] ?? "").trim();
  if (named) return path.resolve(named);
  const root = env?.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(root, "Astral", "disk-governor.json");
}

/** Серийный номер тома буквы `letter` (строкой) или `null`. */
export function volumeSerialOf(letter) {
  try {
    return fs.statSync(`${letter}:/`).dev.toString(16);
  } catch {
    return null;
  }
}

/** Прочитать выученное для букв `letters`: `[{ letters: [буква], write, read }]`; нет файла, битый файл, устаревшее — пусто. */
export function readLearned({
  file,
  letters,
  volumeKeyOf = volumeSerialOf,
  now = Date.now(),
}) {
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const out = [];
  for (const letter of letters) {
    const key = volumeKeyOf(letter);
    const item = key ? data?.volumes?.[key] : null;
    if (!item || !(now - Number(item.at) <= LEARNED_TTL_MS)) continue;
    if (Number(item.write) > 0 || Number(item.read) > 0)
      out.push({
        letters: [letter],
        write: Number(item.write) || 0,
        read: Number(item.read) || 0,
      });
  }
  return out;
}

/** Дописать выученное (`governor.learnedSnapshot()`) в файл, не трогая записи других томов; запись через временный файл. Отказ записи — тихо. */
export function writeLearned({
  file,
  snapshot,
  volumeKeyOf = volumeSerialOf,
  now = Date.now(),
}) {
  try {
    let data = { schema: 1, volumes: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.volumes)
        data = { schema: 1, volumes: parsed.volumes };
    } catch {
      /* файла нет или он битый — начинаем заново */
    }
    for (const [key, item] of Object.entries(data.volumes))
      if (!(now - Number(item?.at) <= LEARNED_TTL_MS)) delete data.volumes[key];
    for (const entry of snapshot) {
      for (const letter of entry.letters) {
        const key = volumeKeyOf(letter);
        if (key)
          data.volumes[key] = {
            write: entry.write,
            read: entry.read,
            at: now,
            name: entry.name,
          };
      }
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const stage = `${file}.${process.pid}.stage`;
    fs.writeFileSync(stage, JSON.stringify(data));
    fs.renameSync(stage, file);
    return true;
  } catch {
    return false;
  }
}

/* Откуда берётся датчик: настоящий выбирает `createDiskSensor`; стендам и тестам — подменить. */
let sensorFactory = createDiskSensor;
export function setDiskSensorFactoryForTests(factory = null) {
  sensorFactory = factory || createDiskSensor;
}

/* Состояние проводки — своё у каждого регулятора (в тестах их несколько). */
const states = new WeakMap();
const stateOf = (governor) => {
  let state = states.get(governor);
  if (!state) {
    state = {
      learnedWired: false,
      sensorAttached: false,
      unsubscribe: null,
      last: { write: null, read: null, rest: null },
      current: null,
    };
    states.set(governor, state);
  }
  return state;
};

/* Буквы томов мест, куда идёт работа: по ним родной датчик знает, чьи счётчики читать. */
const volumeLetters = (places) => [
  ...new Set(
    (places || [])
      .map((place) =>
        /^([A-Za-z]):/.exec(String(place ?? ""))?.[1]?.toUpperCase(),
      )
      .filter(Boolean),
  ),
];

/* Потолок в целых МБ/с; `0` — потолка нет. */
const whole = (value) =>
  Number(value) > 0 ? Math.max(1, Math.floor(Number(value))) : 0;

/**
 * Следует за режимом. `active` — обычный режим (`true`) или «Быстрая» (`false`); `places` — места, куда пишет установка (по ним выбираются диски); `base` — `{ writeMbps, readMbps }` обычного
 * режима; `apply` — `{ write(mbps), read(mbps), rest(factor) }`: то, чем режим ставит потолки писателям (в `storage-manager.js` это `pushWriteLimit`, `setNativeReadLimit`).
 * Возвращает `{ following }` — идёт ли регулятор за этим режимом.
 */
export function followInstallMode({
  active,
  places = [],
  base = {},
  apply,
  env = process.env,
  governor = diskGovernor(),
  makeSensor = (options) => sensorFactory(options),
  learned = {},
} = {}) {
  const state = stateOf(governor);
  const enabled = diskGovernorEnabled(env);
  state.current = { places, base, apply };

  const push = (limits, rest) => {
    const write = whole(limits.writeMbps);
    const read = whole(limits.readMbps);
    const factor = Math.round(rest * 100) / 100;
    /* Лишний раз потолки не ставим: каждая постановка будит копию, процессы сборки и резидентный движок. */
    if (write !== state.last.write) apply.write?.(write);
    if (read !== state.last.read) apply.read?.(read);
    if (factor !== state.last.rest) apply.rest?.(factor);
    if (
      write !== state.last.write ||
      read !== state.last.read ||
      factor !== state.last.rest
    )
      governor.note?.({ kind: "limits", write, read, rest: factor });
    state.last = { write, read, rest: factor };
  };

  const settle = () => {
    const current = state.current;
    if (!current) return;
    if (!governor.isActive())
      return push(
        { writeMbps: current.base.writeMbps, readMbps: current.base.readMbps },
        1,
      );
    const limits = governor.limits(current.base, current.places);
    push(limits, governor.restFactor(current.places));
  };

  /* Регулятор не ведёт: потолки режима режим уже поставил сам (он зовёт нас после них), нам остаётся вернуть обычный отдых и забыть, что ставили. */
  const standDown = () => {
    governor.setActive(false);
    if (state.last.rest !== null && state.last.rest !== 1) apply.rest?.(1);
    state.last = { write: null, read: null, rest: null };
    return { following: false };
  };

  /* «Быстрая установка»: обычный регулятор не ведёт, но мягкий сторож (отдельный выключатель) следит за сотлой занятостью; без него — как раньше, потолков нет. */
  const wanted = active ? enabled : diskGuardEnabled(env);
  if (!wanted) return standDown();

  if (!state.sensorAttached) {
    /* Родной датчик — функция модуля Rust, если модуль её знает; иначе запасной (постоянный PowerShell): `disk-sensor.js`. */
    const sensor = makeSensor({
      onFailure: () => governor.sensorFailed(),
      native: diskPerformanceAvailable ? { diskPerformance } : null,
      volumes: () => volumeLetters(state.current?.places),
    });
    if (!sensor) return standDown();
    governor.attach(sensor);
    state.sensorAttached = true;
    state.unsubscribe = governor.subscribe(settle);
    governor.enable();
  }
  /* Выученное в прошлых запусках — до первого же `settle`: потолки для первой команды движка берутся из него. */
  if (!state.learnedWired) {
    state.learnedWired = true;
    const file = learned.file ?? learnedFilePath(env);
    const volumeKeyOf = learned.volumeKeyOf ?? volumeSerialOf;
    const clock = learned.now === undefined ? Date.now : () => learned.now;
    try {
      governor.seedLearned(
        readLearned({
          file,
          letters: volumeLetters(places),
          volumeKeyOf,
          now: clock(),
        }),
      );
    } catch {
      /* выученное — добавка: без него регулятор начинает с прежних потолков */
    }
    const save = () =>
      writeLearned({
        file,
        snapshot: governor.learnedSnapshot(),
        volumeKeyOf,
        now: clock(),
      });
    let timer = null;
    const schedule =
      learned.schedule ??
      ((work) => {
        const handle = setTimeout(work, LEARNED_SAVE_DELAY_MS);
        handle.unref?.();
        return handle;
      });
    governor.onLearned(() => {
      if (timer) return;
      timer = schedule(() => {
        timer = null;
        save();
      });
    });
    if (learned.exitHook !== false)
      process.once("exit", () => governor.learnedSnapshot().length && save());
    state.saveLearned = save;
  }
  if (active) governor.setActive(true);
  else governor.setGuard(true);
  settle();
  return { following: true, guard: !active };
}

/** Аварийное выключение на ходу: регулятор снят, датчик остановлен, потолки режима и обычный отдых возвращены. */
export function emergencyDisable(
  reason = "аварийно",
  { governor = diskGovernor() } = {},
) {
  governor.disable(reason);
  const state = stateOf(governor);
  const current = state.current;
  if (!current) return;
  current.apply.write?.(whole(current.base.writeMbps));
  current.apply.read?.(whole(current.base.readMbps));
  current.apply.rest?.(1);
  state.last = { write: null, read: null, rest: null };
}
