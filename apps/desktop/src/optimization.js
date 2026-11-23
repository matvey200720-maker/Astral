import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import {
  analyzeGameSettingsPreset,
  applyGameSettingsPreset,
  parseGtaSettings,
} from "./game-settings.js";
import {
  classifyHardware,
  hardwareSummary,
  normalizeHardwarePayload,
} from "./optimization-hardware.js";
import {
  gameRefreshCheck,
  hardwareLossChecks,
} from "./optimization-losses.js";
import { normalizeProbe, PROBE_COMMAND } from "./optimization-probe.js";

const execFileDefault = promisify(execFileCallback);
const PLAN_TTL_MS = 5 * 60 * 1000;
const OPERATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POWER_GUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GTA_EXECUTABLES = new Set([
  "gta5.exe",
  "gta5_enhanced.exe",
  "playgtav.exe",
]);

/* Пять запросов CIM — видеокарты, процессоры, машина, корпус, батарея — в одном
   запуске powershell.exe. Строка лежит здесь, а не внутри `inspect`, потому что
   её читает кэш опроса, живущий рядом с адаптером. */
const HARDWARE_COMMAND =
  "$ErrorActionPreference='Stop'; $system=Get-CimInstance Win32_ComputerSystem | Select-Object -First 1; $battery=Get-CimInstance Win32_Battery | Select-Object -First 1; [pscustomobject]@{ gpus=@(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name=$_.Name; driverVersion=$_.DriverVersion; driverDate=if ($_.DriverDate) { $_.DriverDate.ToUniversalTime().ToString('o') } else { $null }; adapterRam=$_.AdapterRAM; videoProcessor=$_.VideoProcessor } }); cpus=@(Get-CimInstance Win32_Processor | ForEach-Object { [pscustomobject]@{ name=$_.Name; cores=$_.NumberOfCores; logicalProcessors=$_.NumberOfLogicalProcessors; maxClockMhz=$_.MaxClockSpeed } }); system=[pscustomobject]@{ manufacturer=$system.Manufacturer; model=$system.Model; pcSystemType=$system.PCSystemType }; chassisTypes=@((Get-CimInstance Win32_SystemEnclosure | ForEach-Object { $_.ChassisTypes })); battery=if ($battery) { [pscustomobject]@{ status=$battery.BatteryStatus; chargePercent=$battery.EstimatedChargeRemaining } } else { $null } } | ConvertTo-Json -Depth 5 -Compress";

const REGISTRY = Object.freeze({
  gameDvr: {
    key: "HKCU\\System\\GameConfigStore",
    name: "GameDVR_Enabled",
  },
  appCapture: {
    key: "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR",
    name: "AppCaptureEnabled",
  },
  vbs: {
    key: "HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity",
    name: "Enabled",
  },
  hags: {
    key: "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers",
    name: "HwSchMode",
  },
  gpuPreference: {
    key: "HKCU\\SOFTWARE\\Microsoft\\DirectX\\UserGpuPreferences",
  },
});

const PROFILE_CHECKS = Object.freeze({
  "windows-safe": ["power", "gpu-preference", "gamebar"],
  "gta-performance": ["graphics"],
  "world-lite": ["population"],
  "all-safe": ["power", "gpu-preference", "gamebar", "graphics", "population"],
});

function boundedString(value, max = 512) {
  return String(value || "").slice(0, max);
}

function parseRegistryValue(stdout, key, name) {
  const line = String(stdout || "")
    .split(/\r?\n/)
    .find((value) => value.trim().toLowerCase().startsWith(name.toLowerCase()));
  if (!line)
    return { key, name, exists: false, type: "REG_DWORD", value: null };
  const match = line.trim().match(/\s+(REG_[A-Z0-9_]+)\s+(.+)$/i);
  if (!match)
    return { key, name, exists: false, type: "REG_DWORD", value: null };
  const [, type, raw] = match;
  const value = /^0x[0-9a-f]+$/i.test(raw)
    ? Number.parseInt(raw.slice(2), 16)
    : /^-?\d+$/.test(raw)
      ? Number(raw)
      : raw;
  return { key, name, exists: true, type: type.toUpperCase(), value };
}

function parsePowerSchemes(stdout) {
  const schemes = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const match = line.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+\((.+?)\)\s*(\*)?/i,
    );
    if (!match) continue;
    schemes.push({
      guid: match[1].toLowerCase(),
      name: match[2].trim(),
      active: Boolean(match[3]),
    });
  }
  return schemes;
}

function normalizeIntegerList(stdout) {
  try {
    const parsed = JSON.parse(String(stdout || ""));
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(Number.isInteger);
  } catch {
    return [];
  }
}

function isPerformanceScheme(scheme) {
  return (
    [
      "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
      "e9a42b02-d5df-448d-aa00-03f14749eb61",
    ].includes(scheme?.guid) ||
    /high performance|ultimate performance|высокая производительность|максимальная производительность/i.test(
      scheme?.name || "",
    )
  );
}

function driverAgeDays(driverDate, now = Date.now()) {
  const parsed = Date.parse(driverDate || "");
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / 86_400_000));
}

async function sha256File(file) {
  const value = await fs.readFile(file);
  return createHash("sha256").update(value).digest("hex");
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

async function appendJournal(directory, entry) {
  await fs.mkdir(directory, { recursive: true });
  await fs.appendFile(
    path.join(directory, "journal.jsonl"),
    `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    "utf8",
  );
}

function safeTokenEqual(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function registryValueMatches(actual, expected) {
  if (!expected) return true;
  if (Boolean(actual?.exists) !== Boolean(expected.exists)) return false;
  return !expected.exists || String(actual?.value) === String(expected.value);
}

function graphicsPreferenceIsHigh(value) {
  return /(?:^|;)\s*GpuPreference\s*=\s*2\s*;/i.test(
    String(value?.value || ""),
  );
}

function gameExecutablePath(game) {
  if (!game?.path || !game?.executable) return null;
  const root = path.resolve(String(game.path));
  const executable = path.resolve(root, String(game.executable));
  const insideRoot =
    executable === root || executable.startsWith(`${root}${path.sep}`);
  if (
    !insideRoot ||
    !GTA_EXECUTABLES.has(path.basename(executable).toLowerCase())
  ) {
    return null;
  }
  return executable;
}

async function resolveDependency(value) {
  return typeof value === "function" ? value() : value;
}

function rememberBounded(map, key, value, limit = 100) {
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}

export function createWindowsOptimizationAdapter({
  execFile = execFileDefault,
  platform = process.platform,
} = {}) {
  const run = async (file, args) => {
    const result = await execFile(file, args, {
      windowsHide: true,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 512 * 1024,
    });
    return String(result?.stdout || "");
  };

  const queryRegistry = async ({ key, name }) => {
    try {
      return parseRegistryValue(
        await run("reg.exe", ["query", key, "/v", name]),
        key,
        name,
      );
    } catch {
      return { key, name, exists: false, type: "REG_DWORD", value: null };
    }
  };

  /* Опрос оборудования — самая долгая часть разбора: отдельный запуск
     powershell.exe с пятью запросами CIM, на холодную под секунду. Ответ
     между разборами не меняется — видеокарту в работающей машине не переставят,
     — поэтому он и живёт здесь несколько минут. Схемы питания, реестр и
     DeviceGuard не кэшируются никогда: именно их apply и меняет, и повторный
     разбор должен видеть новое состояние. Заряд батареи в кэш попадает вместе с
     остальным, но на проверки он не влияет — из него берут только сам факт, что
     батарея есть, то есть что это ноутбук. */
  const HARDWARE_TTL_MS = 5 * 60_000;
  let hardwareCache = null;
  let lossCache = null;

  const inspectHardware = async () => {
    if (hardwareCache && Date.now() - hardwareCache.at < HARDWARE_TTL_MS) {
      return hardwareCache.value;
    }
    const value = normalizeHardwarePayload(
      await run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        HARDWARE_COMMAND,
      ]).catch(() => ""),
    );
    /* Пустой разбор не запоминаем: powershell мог не запуститься вовсе, и
       «оборудование не определено» закрепилось бы на пять минут. */
    if (Object.keys(value).length) hardwareCache = { at: Date.now(), value };
    return value;
  };

  /*
   * Опрос потерь кадров — частота экрана, частота памяти, диск игры, файл
   * подкачки. Отдельно от `inspectHardware`, потому что отвечает на другой
   * вопрос и живёт своим сроком; кэш общий по смыслу: три с половиной секунды
   * powershell на каждый разбор — это заметно, а между разборами эти числа
   * не меняются.
   */
  const inspectLosses = async () => {
    if (platform !== "win32") return null;
    if (lossCache && Date.now() - lossCache.at < HARDWARE_TTL_MS)
      return lossCache.value;
    const raw = await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      PROBE_COMMAND,
    ]).catch(() => "");
    if (!raw) return null;
    try {
      const value = normalizeProbe(JSON.parse(raw));
      lossCache = { at: Date.now(), value };
      return value;
    } catch {
      /* Опрос не удался — проверок потерь просто не будет; остальной разбор
         от этого не страдает. */
      return null;
    }
  };

  const listPowerSchemes = async () => {
    try {
      return parsePowerSchemes(await run("powercfg.exe", ["/list"]));
    } catch {
      return [];
    }
  };

  const validateGameExecutable = (value) => {
    const raw = String(value || "");
    if (
      !path.isAbsolute(raw) ||
      !GTA_EXECUTABLES.has(path.basename(raw).toLowerCase())
    ) {
      throw new Error("Некорректный путь исполняемого файла GTA V.");
    }
    return path.resolve(raw);
  };

  const inspectGraphicsPreference = async (executable) => {
    if (platform !== "win32") return null;
    const name = validateGameExecutable(executable);
    return queryRegistry({ ...REGISTRY.gpuPreference, name });
  };

  const inspect = async () => {
    if (platform !== "win32") {
      return {
        supported: false,
        platform,
        powerSchemes: [],
        gameDvr: null,
        appCapture: null,
        vbs: null,
        hags: null,
        securityServicesRunning: [],
        gpus: [],
        cpus: [],
        system: {},
        chassisTypes: [],
        battery: null,
        memory: {
          totalBytes: os.totalmem(),
          freeBytes: os.freemem(),
        },
      };
    }
    const deviceGuardCommand =
      "$ErrorActionPreference='Stop'; @((Get-CimInstance -Namespace 'root\\Microsoft\\Windows\\DeviceGuard' -ClassName Win32_DeviceGuard).SecurityServicesRunning) | ConvertTo-Json -Compress";
    const [
      powerSchemes,
      gameDvr,
      appCapture,
      vbs,
      hags,
      hardware,
      deviceGuardResult,
    ] = await Promise.all([
      listPowerSchemes(),
      queryRegistry(REGISTRY.gameDvr),
      queryRegistry(REGISTRY.appCapture),
      queryRegistry(REGISTRY.vbs),
      queryRegistry(REGISTRY.hags),
      inspectHardware(),
      run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        deviceGuardCommand,
      ]).catch(() => ""),
    ]);
    return {
      supported: true,
      platform,
      powerSchemes,
      gameDvr,
      appCapture,
      vbs,
      hags,
      securityServicesRunning: normalizeIntegerList(deviceGuardResult),
      gpus: hardware.gpus || [],
      cpus: hardware.cpus || [],
      system: hardware.system || {},
      chassisTypes: hardware.chassisTypes || [],
      battery: hardware.battery || null,
      memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    };
  };

  const setPowerScheme = async (guid) => {
    const normalized = String(guid || "").toLowerCase();
    if (!POWER_GUID.test(normalized))
      throw new Error("Некорректный GUID схемы питания.");
    const available = await listPowerSchemes();
    if (!available.some((scheme) => scheme.guid === normalized)) {
      throw new Error("Выбранная схема питания больше не доступна.");
    }
    await run("powercfg.exe", ["/setactive", normalized]);
  };

  const setGameDvrEnabled = async (enabled) => {
    const value = enabled ? "1" : "0";
    for (const item of [REGISTRY.gameDvr, REGISTRY.appCapture]) {
      await run("reg.exe", [
        "add",
        item.key,
        "/v",
        item.name,
        "/t",
        "REG_DWORD",
        "/d",
        value,
        "/f",
      ]);
    }
  };

  const setGraphicsPreference = async (executable, highPerformance) => {
    const name = validateGameExecutable(executable);
    await run("reg.exe", [
      "add",
      REGISTRY.gpuPreference.key,
      "/v",
      name,
      "/t",
      "REG_SZ",
      "/d",
      highPerformance ? "GpuPreference=2;" : "GpuPreference=1;",
      "/f",
    ]);
  };

  const restoreGraphicsPreference = async (item) => {
    if (!item?.name) return;
    const name = validateGameExecutable(item.name);
    if (!item.exists) {
      await run("reg.exe", [
        "delete",
        REGISTRY.gpuPreference.key,
        "/v",
        name,
        "/f",
      ]).catch(() => "");
      return;
    }
    await run("reg.exe", [
      "add",
      REGISTRY.gpuPreference.key,
      "/v",
      name,
      "/t",
      item.type || "REG_SZ",
      "/d",
      String(item.value),
      "/f",
    ]);
  };

  const restoreRegistry = async (item) => {
    if (!item?.key || !item?.name) return;
    if (!item.exists) {
      await run("reg.exe", ["delete", item.key, "/v", item.name, "/f"]).catch(
        () => "",
      );
      return;
    }
    await run("reg.exe", [
      "add",
      item.key,
      "/v",
      item.name,
      "/t",
      item.type || "REG_DWORD",
      "/d",
      String(item.value),
      "/f",
    ]);
  };

  /* Железо одно, без схем питания, реестра и DeviceGuard: страница «Графика»
     подбирает по нему пресет и не должна ждать полного разбора. Тот же кэш
     опроса, что у `inspect`, — второй запуск powershell не нужен. */
  const readHardware = async () => ({
    ...(platform === "win32" ? await inspectHardware() : {}),
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
  });

  return {
    inspect,
    readHardware,
    inspectLosses,
    inspectGraphicsPreference,
    setPowerScheme,
    setGameDvrEnabled,
    setGraphicsPreference,
    restoreGraphicsPreference,
    restoreRegistry,
  };
}

function windowsChecks(snapshot, now, context = {}) {
  if (!snapshot.supported) {
    return [
      {
        id: "windows-platform",
        group: "windows",
        title: "Системная оптимизация доступна только в Windows",
        detail: `Текущая платформа: ${snapshot.platform}.`,
        status: "unsupported",
        severity: "notice",
        actionable: false,
      },
    ];
  }
  const activePower = snapshot.powerSchemes?.find((scheme) => scheme.active);
  const targetPower = snapshot.powerSchemes?.find(isPerformanceScheme);
  const powerReady = isPerformanceScheme(activePower);
  const hardware = context.hardware || classifyHardware(snapshot);
  const captureValues = [snapshot.gameDvr, snapshot.appCapture].filter(
    (item) => item?.exists,
  );
  const captureEnabled = captureValues.length
    ? captureValues.some((item) => Number(item.value) !== 0)
    : null;
  const gpu = hardware.primaryGpu || snapshot.gpus?.[0] || null;
  const cpu = hardware.primaryCpu || snapshot.cpus?.[0] || null;
  const ageDays = driverAgeDays(gpu?.driverDate, now);
  const hvciConfigured =
    snapshot.vbs?.exists && Number(snapshot.vbs.value) === 1;
  const hvciRunning = snapshot.securityServicesRunning?.includes(2);
  const hagsMode = snapshot.hags?.exists ? Number(snapshot.hags.value) : null;
  const graphicsPreference = context.graphicsPreference || null;
  const highPerformanceGpu = graphicsPreferenceIsHigh(graphicsPreference);
  const hardwareTitle = `${
    hardware.formFactor === "laptop"
      ? "Ноутбук"
      : hardware.formFactor === "desktop"
        ? "Компьютер"
        : "Устройство"
  }: ${hardware.recommendedProfile.label}`;
  return [
    {
      id: "hardware",
      group: "windows",
      title: hardwareTitle,
      detail: `${cpu?.name || "CPU не определён"} · ${gpu?.name || "GPU не определена"} · ${hardware.memoryGb || "?"} ГБ RAM. ${hardware.recommendedProfile.reason}`,
      status: "advisory",
      severity: "notice",
      actionable: false,
      evidence: hardware,
      effect: "персональный профиль",
    },
    {
      id: "power",
      group: "windows",
      title: powerReady
        ? "Схема питания уже настроена для игры"
        : "Схема питания может ограничивать производительность",
      detail: activePower
        ? `Активна «${activePower.name}».${targetPower && !powerReady ? ` Доступна «${targetPower.name}».` : ""}${hardware.isLaptop && !powerReady ? " Для игры подключите ноутбук к питанию." : ""}`
        : "Windows не вернула активную схему питания.",
      status: powerReady ? "healthy" : targetPower ? "recommended" : "advisory",
      severity: powerReady ? "healthy" : "important",
      actionable: Boolean(targetPower && !powerReady),
      evidence: { active: activePower || null, target: targetPower || null },
      effect: targetPower && !powerReady ? "снимает лимит схемы питания" : null,
    },
    {
      id: "gpu-preference",
      group: "windows",
      title: hardware.supportsHighPerformancePreference
        ? highPerformanceGpu
          ? "GTA V закреплена за высокопроизводительной GPU"
          : `${gpu?.vendor === "nvidia" ? "NVIDIA" : gpu?.vendor === "amd" ? "AMD" : "Дискретная GPU"}: выбрать режим высокой производительности`
        : hardware.discreteGpuCount
          ? "Дискретная GPU определена"
          : "Отдельная высокопроизводительная GPU не найдена",
      detail: hardware.supportsHighPerformancePreference
        ? highPerformanceGpu
          ? "Windows уже направляет GTA V на высокопроизводительный графический адаптер."
          : context.gameExecutable
            ? "Будет изменено только системное предпочтение GPU для найденного GTA V executable; глобальный профиль драйвера не затрагивается."
            : "Выберите найденную установку GTA V, чтобы закрепить её за дискретной GPU."
        : hardware.discreteGpuCount
          ? "На системе нет подтверждённой гибридной графики, поэтому принудительный выбор адаптера не требуется."
          : "Astral не обещает дискретную производительность на встроенной графике и рекомендует профиль «Максимум FPS».",
      status: hardware.supportsHighPerformancePreference
        ? highPerformanceGpu
          ? "healthy"
          : context.gameExecutable
            ? "recommended"
            : "blocked"
        : "advisory",
      severity:
        hardware.supportsHighPerformancePreference && !highPerformanceGpu
          ? "important"
          : "notice",
      actionable: Boolean(
        hardware.supportsHighPerformancePreference &&
        context.gameExecutable &&
        !highPerformanceGpu,
      ),
      evidence: { before: graphicsPreference },
      effect:
        hardware.supportsHighPerformancePreference && !highPerformanceGpu
          ? "приоритет дискретной GPU"
          : null,
    },
    {
      id: "driver",
      group: "windows",
      title:
        ageDays != null && ageDays > 180
          ? "Драйвер видеокарты давно не обновлялся"
          : "Драйвер видеокарты проверен",
      detail: gpu
        ? `${gpu.name || "GPU"}: ${gpu.driverVersion || "версия неизвестна"}${ageDays == null ? "" : `, возраст около ${ageDays} дн.`}`
        : "Windows не вернула сведения о видеокарте.",
      status: ageDays != null && ageDays > 180 ? "recommended" : "advisory",
      severity: ageDays != null && ageDays > 180 ? "important" : "notice",
      actionable: false,
      evidence: gpu,
    },
    {
      id: "gamebar",
      group: "windows",
      title:
        captureEnabled === true
          ? "Фоновая запись Xbox Game Bar включена"
          : captureEnabled === false
            ? "Фоновая запись Xbox Game Bar выключена"
            : "Состояние фоновой записи не определено",
      detail:
        captureEnabled === true
          ? "Windows может кодировать и копировать кадры во время игры. Изменение касается только фоновой записи."
          : "Astral не удаляет Xbox-компоненты и не отключает Game Mode.",
      status:
        captureEnabled === true
          ? "recommended"
          : captureEnabled === false
            ? "healthy"
            : "advisory",
      severity: captureEnabled === true ? "notice" : "healthy",
      actionable: captureEnabled === true,
      requiresConfirmation: true,
      evidence: {
        gameDvr: snapshot.gameDvr,
        appCapture: snapshot.appCapture,
      },
      effect: captureEnabled === true ? "убирает фоновую запись" : null,
    },
    {
      id: "vbs",
      group: "windows",
      title: hvciRunning
        ? "Целостность памяти (HVCI) запущена"
        : hvciConfigured
          ? "HVCI настроена; runtime-состояние не подтверждено"
          : "HVCI не требует действия",
      detail:
        hvciRunning || hvciConfigured
          ? "Это реальная защита Windows. Astral показывает состояние, но не отключает её в безопасном профиле."
          : "Astral не изменяет VBS, HVCI, Defender или Firewall автоматически.",
      status: hvciRunning || hvciConfigured ? "expert" : "healthy",
      severity: hvciRunning || hvciConfigured ? "notice" : "healthy",
      actionable: false,
      evidence: {
        configured: snapshot.vbs,
        securityServicesRunning: snapshot.securityServicesRunning,
      },
      effect: hvciRunning || hvciConfigured ? "экспертный выбор" : null,
    },
    {
      id: "hags",
      group: "windows",
      title: "Аппаратное планирование GPU проверено",
      detail:
        hagsMode == null
          ? "Windows использует системное значение по умолчанию."
          : `Значение HwSchMode: ${hagsMode}. Оно зависит от GPU и драйвера, поэтому Astral не переключает его вслепую.`,
      status: "advisory",
      severity: "notice",
      actionable: false,
      evidence: snapshot.hags,
    },
  ];
}

/* Единственная проверка, которую Astral придумывает сам, а не вычитывает из
   системы: выбранная установка не нашлась. Без неё разбор выглядел бы
   законченным и удачным, хотя половина его вкладок ничего применить не может. */
function missingInstallCheck(targetId) {
  return {
    id: "install-missing",
    group: "gta",
    title: "Выбранная установка GTA V не найдена",
    detail:
      "Папку игры переместили, переименовали или она лежит на неподключённом диске. Проверки Windows выше выполнены полностью и применяются как обычно; настройки игры и мира вернутся, когда установка найдётся снова — запустите поиск игры в настройках.",
    status: "blocked",
    severity: "important",
    actionable: false,
    evidence: { targetId: boundedString(targetId, 200) },
  };
}

/*
 * Частота из `settings.xml` нужна снаружи — рядом с данными экрана, которых у
 * этой функции нет. Она возвращается вместе с проверками, чтобы файл читался
 * один раз: он лежит в «Документах», и второе чтение ради одного числа было
 * бы лишним обращением к диску на каждом разборе.
 */
async function gtaChecks(settingsFile, hardware) {
  let gameRefreshHz = null;
  try {
    const xml = await fs.readFile(settingsFile, "utf8");
    gameRefreshHz = Number(parseGtaSettings(xml).RefreshRate) || null;
  } catch {
    /* Нет файла или он в незнакомом виде — об этом скажут проверки ниже. */
  }
  try {
    const graphicsPresetId =
      hardware?.recommendedProfile?.id === "competitive"
        ? "astral-competitive-safe"
        : "astral-graphics-performance-safe";
    const [graphicsAnalysis, populationAnalysis] = await Promise.all([
      analyzeGameSettingsPreset({ id: graphicsPresetId }, settingsFile),
      analyzeGameSettingsPreset({ id: "astral-world-lite-safe" }, settingsFile),
    ]);
    const saving = Math.max(0, Number(graphicsAnalysis.estimatedSavingMb || 0));
    const graphicsActionable = graphicsAnalysis.changedCount > 0;
    const populationActionable = populationAnalysis.changedCount > 0;
    return {
      gameRefreshHz,
      checks: [
      {
        id: "graphics",
        group: "gta",
        title: graphicsActionable
          ? `Для этого компьютера выбран профиль «${hardware?.recommendedProfile?.label || "Максимум FPS"}»`
          : `Профиль «${hardware?.recommendedProfile?.label || "Максимум FPS"}» уже применён`,
        detail: `Тени, трава, сглаживание и постобработка настраиваются по найденным CPU/GPU. Оценка VRAM: сейчас ${graphicsAnalysis.currentEstimatedMb} МБ, профиль ${graphicsAnalysis.targetEstimatedMb} МБ. Разрешение и герцовка сохраняются.`,
        status: graphicsActionable ? "recommended" : "healthy",
        severity: graphicsActionable ? "notice" : "healthy",
        actionable: graphicsActionable,
        evidence: graphicsAnalysis,
        effect:
          graphicsActionable && saving > 0 ? `около −${saving} МБ VRAM` : null,
      },
      {
        id: "population",
        group: "world",
        title: populationActionable
          ? "Облегчённая плотность мира доступна"
          : "Плотность мира уже облегчена",
        detail:
          "Профиль уменьшает дальность и разнообразие населения через settings.xml, не удаляя игровые архивы и mission props.",
        status: populationActionable ? "recommended" : "healthy",
        severity: populationActionable ? "notice" : "healthy",
        actionable: populationActionable,
        evidence: populationAnalysis,
        effect: populationActionable ? "меньше объектов в кадре" : null,
      },
      {
        id: "world-clutter",
        group: "world",
        title: "Удаление декора требует точного build-профиля",
        detail:
          "Полки, мусор, царапины и интерьерные props не будут удаляться эвристически. Для этой версии нет подписанного visual-only overlay.",
        status: "unsupported",
        severity: "notice",
        actionable: false,
      },
      ],
    };
  } catch (error) {
    return {
      gameRefreshHz,
      checks: [
      {
        id: "graphics",
        group: "gta",
        title: "settings.xml пока недоступен",
        detail: boundedString(
          error?.message || "Не удалось прочитать настройки.",
        ),
        status: "blocked",
        severity: "important",
        actionable: false,
      },
      {
        id: "population",
        group: "world",
        title: "Оптимизация плотности мира недоступна",
        detail: "Сначала запустите GTA V и завершите создание settings.xml.",
        status: "blocked",
        severity: "important",
        actionable: false,
      },
      {
        id: "world-clutter",
        group: "world",
        title: "Visual-only overlay не установлен",
        detail:
          "Непроверенные удаления игровых объектов заблокированы безопасным профилем.",
        status: "unsupported",
        severity: "notice",
        actionable: false,
      },
      ],
    };
  }
}

export function createOptimizationService({
  stateDir,
  settingsFile,
  windows = createWindowsOptimizationAdapter(),
  resolveGame = async () => null,
  gameProcessRunning = async () => false,
  emitProgress = () => {},
  now = () => Date.now(),
} = {}) {
  const scans = new Map();
  const plans = new Map();
  let mutationActive = false;

  const exclusiveMutation = async (operation) => {
    if (mutationActive) {
      throw new Error("Другая операция оптимизации ещё выполняется.");
    }
    mutationActive = true;
    try {
      return await operation();
    } finally {
      mutationActive = false;
    }
  };

  const resolvedStateDir = async () =>
    path.resolve(await resolveDependency(stateDir));
  const resolvedSettingsFile = async () =>
    path.resolve(await resolveDependency(settingsFile));

  const analyze = async (input = {}) => {
    const targetId = boundedString(input.targetId, 200);
    /* Диагностика переживает ненайденную игру, а не умирает вместе с ней.
       Схема питания, Game Bar, VBS, целостность памяти и возраст драйвера про
       игру ничего не знают, а настройки GTA лежат в «Документах», а не в
       установке. Без найденной игры теряется ровно одна проверка — выбор GPU
       для конкретного exe, — и она уже умеет об этом сказать сама: `blocked`
       и «Выберите найденную установку GTA V». Пока `resolveGame` бросал,
       устаревший targetId (переехавшая папка, неподключённый диск, чужой
       профиль) забирал с собой весь разбор Windows. Запись остаётся строгой:
       apply и rollback по-прежнему требуют настоящую установку. */
    /* Поиск установки и опрос Windows друг о друге ничего не знают, но стояли
       в очереди: сначала диск, потом powershell. Вместе они идут за время
       второго. */
    const [game, windowsSnapshot] = await Promise.all([
      targetId ? resolveGame(targetId).catch(() => null) : null,
      windows.inspect(),
    ]);
    const gameExecutable = gameExecutablePath(game);
    const hardwareProfile = classifyHardware(windowsSnapshot);
    const [gta, graphicsPreference, losses] = await Promise.all([
      resolvedSettingsFile().then((file) => gtaChecks(file, hardwareProfile)),
      gameExecutable && windows.inspectGraphicsPreference
        ? windows.inspectGraphicsPreference(gameExecutable).catch(() => null)
        : null,
      windows.inspectLosses ? windows.inspectLosses().catch(() => null) : null,
    ]);
    const scanId = randomUUID();
    const createdAt = new Date(now()).toISOString();
    /* Установка выбрана, но не найдена. Разбор Windows от этого не страдает и
       показывается целиком — ради этого `resolveGame` выше и не бросает. А вот
       обещать настройки игры и мира переключателем нельзя: `plan` по graphics
       и population откажет («Сначала выберите найденную установку GTA V»), и
       человек упёрся бы в отказ уже после того, как выбрал и подтвердил.
       Поэтому пропажу называем отдельной проверкой, а зависящие от игры
       снимаем с действия — счётчик на закладке и «оптимизировать всё» тогда
       перестают предлагать то, чего не будет. */
    const installMissing = Boolean(targetId) && !game;
    const gtaChecksList = gta.checks;
    const gameRefreshLoss = gameRefreshCheck(losses, gta.gameRefreshHz);
    const checks = [
      ...windowsChecks(windowsSnapshot, now(), {
        hardware: hardwareProfile,
        gameExecutable,
        graphicsPreference,
      }),
      /* Потери, которые не чинятся галочкой: частота экрана, частота памяти,
         диск игры, файл подкачки. Ничего не переключают — называют число и
         место, где это чинят. Разбор без них выглядел бы законченным, показав
         три галочки на проценты и промолчав про вдвое урезанный потолок
         кадров. */
      ...hardwareLossChecks(losses, game?.path || ""),
      /* Частота в игре сводит два источника сразу — экран из опроса и
         `settings.xml` игры, — поэтому стоит здесь, а не внутри одного из них. */
      ...(gameRefreshLoss ? [gameRefreshLoss] : []),
      ...(installMissing
        ? [
            missingInstallCheck(targetId),
            ...gtaChecksList.map((check) => ({ ...check, actionable: false })),
          ]
        : gtaChecksList),
    ];
    const scan = {
      scanId,
      targetId,
      createdAt,
      hardware: {
        platform: windowsSnapshot.platform,
        memory: windowsSnapshot.memory,
        ...hardwareProfile,
      },
      game: game
        ? {
            id: boundedString(game.id, 200),
            edition: boundedString(game.edition, 80),
            buildId: boundedString(game.buildId, 100),
          }
        : null,
      checks,
      supportedProfiles: Object.keys(PROFILE_CHECKS),
      _windowsSnapshot: windowsSnapshot,
      _gameExecutable: gameExecutable,
    };
    rememberBounded(scans, scanId, scan);
    return {
      ...scan,
      _windowsSnapshot: undefined,
      _gameExecutable: undefined,
    };
  };

  const plan = async (input = {}) => {
    const scan = scans.get(String(input.scanId || ""));
    if (!scan)
      throw new Error("Сканирование устарело. Запустите проверку заново.");
    if (now() - Date.parse(scan.createdAt) > PLAN_TTL_MS) {
      scans.delete(scan.scanId);
      throw new Error("Сканирование устарело. Запустите проверку заново.");
    }
    const profileId = boundedString(input.profileId, 80);
    const allowedChecks = PROFILE_CHECKS[profileId];
    if (!allowedChecks) throw new Error("Неизвестный профиль оптимизации.");
    const requested = Array.isArray(input.selectedCheckIds)
      ? input.selectedCheckIds.map((id) => boundedString(id, 80)).slice(0, 20)
      : allowedChecks;
    const selected = scan.checks.filter(
      (check) =>
        requested.includes(check.id) &&
        allowedChecks.includes(check.id) &&
        check.actionable,
    );
    if (
      selected.some((check) => ["graphics", "population"].includes(check.id)) &&
      !scan.game
    ) {
      throw new Error("Сначала выберите найденную установку GTA V.");
    }
    const actions = [];
    const power = selected.find((check) => check.id === "power");
    if (power) {
      actions.push({
        id: "power-plan",
        kind: "power-plan",
        title: "Переключить схему питания",
        risk: "safe",
        targetGuid: power.evidence.target.guid,
        before: power.evidence.active,
      });
    }
    const gpuPreference = selected.find(
      (check) => check.id === "gpu-preference",
    );
    if (gpuPreference && scan._gameExecutable) {
      actions.push({
        id: "gpu-preference",
        kind: "gpu-preference",
        title: "Закрепить GTA V за высокопроизводительной GPU",
        risk: "safe",
        executable: scan._gameExecutable,
        before: gpuPreference.evidence.before,
      });
    }
    const gamebar = selected.find((check) => check.id === "gamebar");
    if (gamebar) {
      actions.push({
        id: "game-dvr",
        kind: "game-dvr",
        title: "Отключить фоновую запись Game Bar",
        risk: "opt-in",
        before: gamebar.evidence,
      });
    }
    const graphicsSelected = selected.some((check) => check.id === "graphics");
    const populationSelected = selected.some(
      (check) => check.id === "population",
    );
    if (graphicsSelected || populationSelected) {
      const graphicsCheck = selected.find((check) => check.id === "graphics");
      const adaptiveGraphicsPreset =
        graphicsCheck?.evidence?.id || "astral-graphics-performance-safe";
      actions.push({
        id: "gta-settings",
        kind: "gta-settings",
        title:
          graphicsSelected && populationSelected
            ? "Облегчить графику и плотность мира GTA V"
            : graphicsSelected
              ? "Применить производительный профиль GTA V"
              : "Уменьшить плотность мира GTA V",
        risk: "safe",
        presetId:
          graphicsSelected && populationSelected
            ? adaptiveGraphicsPreset === "astral-competitive-safe"
              ? "astral-competitive-world-safe"
              : "astral-performance-safe"
            : graphicsSelected
              ? adaptiveGraphicsPreset
              : "astral-world-lite-safe",
      });
    }
    if (!actions.length) {
      throw new Error("Для выбранных проверок изменения не требуются.");
    }
    const planId = randomUUID();
    const confirmationToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now() + PLAN_TTL_MS).toISOString();
    const result = {
      planId,
      scanId: scan.scanId,
      targetId: scan.targetId,
      profileId,
      createdAt: new Date(now()).toISOString(),
      expiresAt,
      confirmationToken,
      actions,
      risks: [...new Set(actions.map((action) => action.risk))],
      rebootRequired: false,
    };
    rememberBounded(plans, planId, { ...result, scan });
    return result;
  };

  const operationPath = async (operationId) => {
    if (!OPERATION_ID.test(String(operationId || ""))) {
      throw new Error("Некорректный идентификатор операции.");
    }
    return path.join(await resolvedStateDir(), "operations", operationId);
  };

  const persistManifest = async (directory, manifest) =>
    atomicJson(path.join(directory, "operation.json"), manifest);

  const rollbackAction = async (action, directory) => {
    if (action.kind === "gta-settings") {
      const backup = path.join(directory, "settings.before.xml");
      await fs.copyFile(backup, await resolvedSettingsFile());
      return;
    }
    if (action.kind === "power-plan" && action.before?.guid) {
      await windows.setPowerScheme(action.before.guid);
      return;
    }
    if (action.kind === "gpu-preference") {
      await windows.restoreGraphicsPreference(action.before);
      return;
    }
    if (action.kind === "game-dvr") {
      await windows.restoreRegistry(action.before?.gameDvr);
      await windows.restoreRegistry(action.before?.appCapture);
    }
  };

  const applyOperation = async (input = {}) => {
    const savedPlan = plans.get(String(input.planId || ""));
    if (!savedPlan || now() > Date.parse(savedPlan.expiresAt)) {
      throw new Error("План устарел. Постройте его заново.");
    }
    if (!safeTokenEqual(input.confirmationToken, savedPlan.confirmationToken)) {
      throw new Error("Подтверждение не соответствует плану.");
    }
    const gameActions = savedPlan.actions.some(
      (action) => action.kind === "gta-settings",
    );
    /* Установку ищем только ради тех действий, которым она нужна. Схема
       питания и Game Bar — общесистемные: требовать под них найденную GTA V
       значило показать человеку ровно те исправления, которые разбор для него
       и открыл, и отказать в них на последнем шаге. Проверка «закройте GTA V»
       не ослабевает: она и раньше срабатывала только при gameActions. */
    const game =
      gameActions && savedPlan.targetId
        ? await resolveGame(savedPlan.targetId)
        : null;
    if (gameActions && game && (await gameProcessRunning(game))) {
      throw new Error("Закройте GTA V перед изменением settings.xml.");
    }
    const operationId = randomUUID();
    const directory = await operationPath(operationId);
    await fs.mkdir(directory, { recursive: true });
    const manifest = {
      format: "astral-optimization-operation",
      version: 1,
      operationId,
      targetId: savedPlan.targetId,
      profileId: savedPlan.profileId,
      createdAt: new Date(now()).toISOString(),
      status: "applying",
      actions: savedPlan.actions,
      appliedActionIds: [],
    };
    await persistManifest(directory, manifest);
    await appendJournal(directory, { phase: "start", status: "applying" });
    const appliedActions = [];
    try {
      for (let index = 0; index < savedPlan.actions.length; index += 1) {
        const action = savedPlan.actions[index];
        emitProgress({
          operationId,
          phase: "apply",
          actionId: action.id,
          progress: Math.round(
            (index / Math.max(1, savedPlan.actions.length)) * 90,
          ),
          message: action.title,
        });
        await appendJournal(directory, {
          phase: "apply",
          actionId: action.id,
          status: "started",
        });
        appliedActions.push(action);
        if (action.kind === "power-plan") {
          await windows.setPowerScheme(action.targetGuid);
          const readback = await windows.inspect();
          if (
            !readback.powerSchemes.some(
              (scheme) => scheme.active && scheme.guid === action.targetGuid,
            )
          ) {
            throw new Error("Windows не подтвердила смену схемы питания.");
          }
        } else if (action.kind === "gpu-preference") {
          await windows.setGraphicsPreference(action.executable, true);
          const readback = await windows.inspectGraphicsPreference(
            action.executable,
          );
          if (!graphicsPreferenceIsHigh(readback)) {
            throw new Error(
              "Windows не подтвердила выбор высокопроизводительной GPU.",
            );
          }
        } else if (action.kind === "game-dvr") {
          await windows.setGameDvrEnabled(false);
          const readback = await windows.inspect();
          const captureValues = [readback.gameDvr, readback.appCapture].filter(
            (item) => item?.exists,
          );
          if (
            captureValues.length !== 2 ||
            captureValues.some((item) => Number(item.value) !== 0)
          ) {
            throw new Error(
              "Windows не подтвердила отключение фоновой записи.",
            );
          }
        } else if (action.kind === "gta-settings") {
          const file = await resolvedSettingsFile();
          await fs.copyFile(file, path.join(directory, "settings.before.xml"));
          action.beforeHash = await sha256File(file);
          await applyGameSettingsPreset(
            { id: action.presetId },
            file,
            await resolvedStateDir(),
          );
          action.afterHash = await sha256File(file);
          if (action.afterHash === action.beforeHash) {
            throw new Error("Профиль GTA V не изменил settings.xml.");
          }
        }
        manifest.appliedActionIds.push(action.id);
        await persistManifest(directory, manifest);
        await appendJournal(directory, {
          phase: "apply",
          actionId: action.id,
          status: "complete",
        });
      }
      manifest.status = "active";
      manifest.completedAt = new Date(now()).toISOString();
      await persistManifest(directory, manifest);
      await appendJournal(directory, { phase: "complete", status: "active" });
      emitProgress({
        operationId,
        phase: "complete",
        progress: 100,
        message: "Оптимизация применена",
      });
      plans.delete(savedPlan.planId);
      return { operationId, status: "active", actions: manifest.actions };
    } catch (error) {
      for (const action of [...appliedActions].reverse()) {
        await rollbackAction(action, directory).catch(() => {});
      }
      manifest.status = "failed";
      manifest.error = boundedString(error?.message || error, 500);
      await persistManifest(directory, manifest).catch(() => {});
      await appendJournal(directory, {
        phase: "failed",
        status: "failed",
        error: manifest.error,
      }).catch(() => {});
      throw error;
    }
  };

  const rollbackOperation = async (input = {}) => {
    const operationId = String(input.operationId || "");
    const directory = await operationPath(operationId);
    const manifest = JSON.parse(
      await fs.readFile(path.join(directory, "operation.json"), "utf8"),
    );
    if (manifest.status === "rolled-back") {
      return { operationId, status: "rolled-back", idempotent: true };
    }
    const gameAction = manifest.actions.some(
      (action) => action.kind === "gta-settings",
    );
    /* Та же причина, что и в apply: откат общесистемной правки не должен
       упираться в пропавшую установку. Откатывать нужно тем более — иначе
       исчезнувшая игра запирает человека в изменённом состоянии. */
    const game =
      gameAction && manifest.targetId
        ? await resolveGame(manifest.targetId)
        : null;
    if (gameAction && game && (await gameProcessRunning(game))) {
      throw new Error("Закройте GTA V перед откатом оптимизации.");
    }
    await appendJournal(directory, { phase: "rollback", status: "started" });
    const applied = new Set(manifest.appliedActionIds || []);
    for (const action of [...manifest.actions].reverse()) {
      if (!applied.has(action.id)) continue;
      emitProgress({
        operationId,
        phase: "rollback",
        actionId: action.id,
        progress: 50,
        message: `Откат: ${action.title}`,
      });
      await rollbackAction(action, directory);
    }
    const windowsReadback = await windows.inspect();
    for (const action of manifest.actions) {
      if (!applied.has(action.id)) continue;
      if (
        action.kind === "power-plan" &&
        action.before?.guid &&
        !windowsReadback.powerSchemes.some(
          (scheme) => scheme.active && scheme.guid === action.before.guid,
        )
      ) {
        throw new Error("Windows не подтвердила откат схемы питания.");
      }
      if (
        action.kind === "game-dvr" &&
        (!registryValueMatches(
          windowsReadback.gameDvr,
          action.before?.gameDvr,
        ) ||
          !registryValueMatches(
            windowsReadback.appCapture,
            action.before?.appCapture,
          ))
      ) {
        throw new Error(
          "Windows не подтвердила восстановление фоновой записи.",
        );
      }
      if (
        action.kind === "gpu-preference" &&
        !registryValueMatches(
          await windows.inspectGraphicsPreference(action.executable),
          action.before,
        )
      ) {
        throw new Error(
          "Windows не подтвердила откат предпочтения графического адаптера.",
        );
      }
      if (
        action.kind === "gta-settings" &&
        action.beforeHash &&
        (await sha256File(await resolvedSettingsFile())) !== action.beforeHash
      ) {
        throw new Error("Не удалось подтвердить точный откат settings.xml.");
      }
    }
    manifest.status = "rolled-back";
    manifest.rolledBackAt = new Date(now()).toISOString();
    await persistManifest(directory, manifest);
    await appendJournal(directory, {
      phase: "rollback",
      status: "rolled-back",
    });
    emitProgress({
      operationId,
      phase: "rollback-complete",
      progress: 100,
      message: "Исходные настройки восстановлены",
    });
    return { operationId, status: "rolled-back" };
  };

  const history = async () => {
    const root = path.join(await resolvedStateDir(), "operations");
    const entries = await fs
      .readdir(root, { withFileTypes: true })
      .catch(() => []);
    const records = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !OPERATION_ID.test(entry.name)) continue;
      try {
        const record = JSON.parse(
          await fs.readFile(
            path.join(root, entry.name, "operation.json"),
            "utf8",
          ),
        );
        records.push({
          operationId: record.operationId,
          profileId: record.profileId,
          targetId: record.targetId,
          status: record.status,
          createdAt: record.createdAt,
          completedAt: record.completedAt,
          rolledBackAt: record.rolledBackAt,
          actionCount: record.actions?.length || 0,
        });
      } catch {}
    }
    return records
      .sort((left, right) =>
        String(right.createdAt).localeCompare(String(left.createdAt)),
      )
      .slice(0, 20);
  };

  const apply = (input) => exclusiveMutation(() => applyOperation(input));
  const rollback = (input) => exclusiveMutation(() => rollbackOperation(input));

  /* Железо для окна: видеокарты, ОЗУ, потоки — или `null`, если не прочитано
     (не Windows, powershell не запустился). Без разбора и без снимка: ничего
     не запоминается и ничего не пишется. */
  const hardware = async () => {
    try {
      return hardwareSummary(
        windows.readHardware
          ? await windows.readHardware()
          : await windows.inspect(),
      );
    } catch {
      return null;
    }
  };

  return { analyze, plan, apply, rollback, history, hardware };
}

export { driverAgeDays, parsePowerSchemes, parseRegistryValue };
