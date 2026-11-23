const LAPTOP_CHASSIS_TYPES = new Set([
  8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32,
]);

const bounded = (value, max = 160) => String(value || "").slice(0, max);

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function gpuVendor(name) {
  if (/nvidia|geforce|quadro/i.test(name)) return "nvidia";
  if (/amd|ati|radeon/i.test(name)) return "amd";
  if (/intel|iris|uhd|arc/i.test(name)) return "intel";
  return "unknown";
}

function gpuKind(name, vendor) {
  if (
    vendor === "nvidia" ||
    /\brx\s*\d|radeon\s+pro|intel\s+arc\s+[a-z]?\d/i.test(name)
  ) {
    return "discrete";
  }
  if (/intel|iris|uhd|vega|radeon\s+graphics/i.test(name)) {
    return "integrated";
  }
  return "unknown";
}

/*
 * Тянет ли эта видеокарта GTA V без самого агрессивного профиля.
 *
 * Раньше класс машины решался по объёму ОЗУ: без 24 ГБ компьютер получал
 * «Максимум FPS» — профиль, который ставит в ноль текстуры и анизотропию.
 * Игровой ноутбук с RTX 3070 Ti и 16 ГБ попадал туда же, куда и встроенная
 * графика, и терял картинку без выгоды: 16 ГБ ОЗУ для игры 2015 года —
 * двойной запас, а кадры делает GPU.
 *
 * Пороги взяты по игре, а не по году выпуска: GTA V Legacy на 1080p держит
 * высокие настройки на GTX 1060 и всём, что выше; на 1050 и 1030 — уже нет.
 * Неузнанное имя ничего не решает: гадать о чужой машине хуже, чем признать,
 * что модель не разобрана.
 */
export function gpuHandlesHighSettings(name) {
  const text = String(name || "");

  /* NVIDIA: четырёхзначные — поколение и класс (3070 → 30 и 70),
     трёхзначные — старые серии (970 → 9 и 70). */
  const nvidia = /\b(RTX|GTX)\s*(\d{3,4})/i.exec(text);
  if (nvidia) {
    /* Любая RTX тянет игру 2015 года на 1080p с запасом. */
    if (/rtx/i.test(nvidia[1])) return true;
    return Number(nvidia[2].slice(-2)) >= 60;
  }

  /* AMD: RX 6700 — четырёхзначные серии 5000+, RX 580 — трёхзначные. */
  const amd = /\bRX\s*(\d{3,4})/i.exec(text);
  if (amd) {
    const digits = amd[1];
    if (digits.length === 4) return Number(digits.slice(-3)) >= 500;
    return Number(digits.slice(-2)) >= 70;
  }

  /* Intel Arc: A580 и выше. */
  const arc = /\bArc\s*A(\d{3})/i.exec(text);
  if (arc) return Number(arc[1]) >= 500;

  return false;
}

function normalizeGpu(value = {}) {
  const name = bounded(value.name ?? value.Name);
  const vendor = gpuVendor(name);
  return {
    name,
    vendor,
    kind: gpuKind(name, vendor),
    driverVersion: bounded(value.driverVersion ?? value.DriverVersion, 80),
    driverDate:
      (value.driverDate ?? value.DriverDate)
        ? bounded(value.driverDate ?? value.DriverDate, 80)
        : null,
    adapterRamBytes: finiteNumber(value.adapterRam ?? value.AdapterRAM),
    videoProcessor: bounded(value.videoProcessor ?? value.VideoProcessor, 120),
  };
}

function normalizeCpu(value = {}) {
  return {
    name: bounded(value.name ?? value.Name),
    cores: finiteNumber(value.cores ?? value.NumberOfCores),
    logicalProcessors: finiteNumber(
      value.logicalProcessors ?? value.NumberOfLogicalProcessors,
    ),
    maxClockMhz: finiteNumber(value.maxClockMhz ?? value.MaxClockSpeed),
  };
}

function normalizeParsedHardware(parsed) {
  if (!parsed || typeof parsed !== "object") return {};
  const looksLikeLegacyGpu =
    !Array.isArray(parsed) &&
    !("gpus" in parsed) &&
    ("name" in parsed || "driverVersion" in parsed);
  if (Array.isArray(parsed) || looksLikeLegacyGpu) {
    return { gpus: asArray(parsed).map(normalizeGpu) };
  }
  const system = parsed.system || {};
  const battery = parsed.battery || null;
  return {
    gpus: asArray(parsed.gpus)
      .map(normalizeGpu)
      .filter((gpu) => gpu.name),
    cpus: asArray(parsed.cpus)
      .map(normalizeCpu)
      .filter((cpu) => cpu.name),
    system: {
      manufacturer: bounded(system.manufacturer ?? system.Manufacturer, 120),
      model: bounded(system.model ?? system.Model, 120),
      pcSystemType: finiteNumber(system.pcSystemType ?? system.PCSystemType),
    },
    chassisTypes: asArray(parsed.chassisTypes)
      .map(Number)
      .filter(Number.isInteger),
    battery: battery
      ? {
          status: finiteNumber(battery.status ?? battery.BatteryStatus),
          chargePercent: finiteNumber(
            battery.chargePercent ?? battery.EstimatedChargeRemaining,
          ),
        }
      : null,
  };
}

export function normalizeHardwarePayload(stdout) {
  if (!String(stdout || "").trim()) return {};
  try {
    return normalizeParsedHardware(JSON.parse(stdout));
  } catch {
    return {};
  }
}

export function classifyHardware(snapshot = {}) {
  const gpus = asArray(snapshot.gpus)
    .map(normalizeGpu)
    .filter((gpu) => gpu.name);
  const cpus = asArray(snapshot.cpus)
    .map(normalizeCpu)
    .filter((cpu) => cpu.name);
  const chassisTypes = asArray(snapshot.chassisTypes)
    .map(Number)
    .filter(Number.isInteger);
  const pcSystemType = finiteNumber(snapshot.system?.pcSystemType);
  const isLaptop = Boolean(
    snapshot.battery ||
    pcSystemType === 2 ||
    chassisTypes.some((type) => LAPTOP_CHASSIS_TYPES.has(type)),
  );
  const formFactor = isLaptop
    ? "laptop"
    : pcSystemType || snapshot.system?.manufacturer || snapshot.system?.model
      ? "desktop"
      : "unknown";
  const discreteGpus = gpus.filter((gpu) => gpu.kind === "discrete");
  const integratedGpus = gpus.filter((gpu) => gpu.kind === "integrated");
  const primaryGpu = discreteGpus[0] || gpus[0] || null;
  const primaryCpu = cpus[0] || null;
  const totalMemoryBytes = finiteNumber(snapshot.memory?.totalBytes) || 0;
  const memoryGb = Math.round((totalMemoryBytes / 1024 ** 3) * 10) / 10;
  const threads = primaryCpu?.logicalProcessors || 0;
  const integratedOnly = Boolean(gpus.length && !discreteGpus.length);
  /*
   * Класс машины решает видеокарта, а не объём ОЗУ.
   *
   * ОЗУ и потоки остаются снизу — как признак того, что машине тяжело вообще,
   * а не как мера графического запаса: восемь гигабайт при RTX — это мало
   * памяти, а не слабая графика.
   */
  const capableGpu = discreteGpus.some((gpu) =>
    gpuHandlesHighSettings(gpu.name),
  );
  const tier =
    integratedOnly ||
    (memoryGb > 0 && memoryGb < 12) ||
    (threads > 0 && threads < 6)
      ? "entry"
      : capableGpu
        ? "high"
        : "balanced";
  const recommendedProfile =
    tier === "high"
      ? {
          id: "competitive",
          label: "Сбалансированный FPS",
          reason: `${primaryGpu?.name || "Дискретная видеокарта"} держит GTA V без тяжёлых эффектов, но с чёткими текстурами: обнулять их значило бы отдать картинку ни за что.`,
        }
      : {
          id: "maximum-fps",
          label: "Максимум FPS",
          reason: integratedOnly
            ? "Основная графика встроенная — рекомендованы минимальные тени, трава и постобработка."
            : isLaptop
              ? "Для ноутбука приоритетны дискретная GPU, питание от сети и минимальные тяжёлые эффекты."
              : "Профиль снижает самые тяжёлые эффекты, не меняя разрешение и герцовку.",
        };
  return {
    formFactor,
    isLaptop,
    tier,
    memoryGb,
    gpus,
    cpus,
    primaryGpu,
    primaryCpu,
    discreteGpuCount: discreteGpus.length,
    integratedGpuCount: integratedGpus.length,
    hybridGraphics: Boolean(discreteGpus.length && integratedGpus.length),
    supportsHighPerformancePreference: Boolean(
      discreteGpus.length && (integratedGpus.length || isLaptop),
    ),
    battery: snapshot.battery || null,
    system: snapshot.system || {},
    recommendedProfile,
  };
}

/*
 * Железо для окна — коротко и без лишнего.
 *
 * Страница «Графика» подбирает пресет (`recommendPreset`) по трём вещам:
 * видеокартам, ОЗУ и потокам процессора. Остальное из разбора (драйверы,
 * корпус, батарея, схемы питания) ей не нужно и через границу окна не идёт.
 * Видеокарты отдаются списком, основной первой: окну решать, какая из
 * узнанных сильнее, а у ноутбука с двумя картами это не всегда первая.
 *
 * Ничего не прочитано — `null`, а не пустая оболочка с нулями: нулевое ОЗУ
 * превратилось бы на экране в «0 ГБ» и в потолок «не выше Слабых».
 */
export function hardwareSummary(snapshot = {}) {
  const hardware = classifyHardware(snapshot);
  const names = [
    hardware.primaryGpu?.name,
    ...hardware.gpus.map((gpu) => gpu.name),
  ].filter(Boolean);
  const gpus = [...new Set(names)].map((name) => ({ name }));
  const threads = hardware.primaryCpu?.logicalProcessors || null;
  if (!gpus.length && !hardware.memoryGb && !threads) return null;
  return {
    gpus,
    memoryGb: hardware.memoryGb || null,
    cpu: hardware.primaryCpu
      ? {
          name: hardware.primaryCpu.name,
          cores: hardware.primaryCpu.cores,
          threads,
        }
      : null,
    isLaptop: hardware.isLaptop,
  };
}

export const hardwareInternals = Object.freeze({
  gpuKind,
  gpuVendor,
  laptopChassisTypes: [...LAPTOP_CHASSIS_TYPES],
});
