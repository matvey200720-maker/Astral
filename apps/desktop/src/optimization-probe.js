/*
 * Опрос железа, который отвечает на вопрос «где теряются кадры».
 *
 * Раздел оптимизации давно умеет то, что можно переключить: схему питания,
 * предпочтение видеокарты, фоновую запись Xbox. Но самые дорогие потери кадров
 * переключателем не чинятся, и именно поэтому о них никто не знает:
 *
 *   • экран на 144 Гц, а Windows выдаёт 60 — это ровно вдвое меньше кадров,
 *     сколько бы их ни рисовала игра;
 *   • память с профилем 5600, работающая на 5200, — GTA V упирается в
 *     задержку памяти, и это проценты кадров на ровном месте;
 *   • игра на жёстком диске — подгрузка мира рывками, которую не лечит ни один
 *     ползунок графики;
 *   • десять гигабайт свободного места и выключенный файл подкачки — вылеты,
 *     которые человек считает багом игры.
 *
 * Astral не может нажать за человека в UEFI и не станет менять разрешение
 * экрана вслепую. Но назвать потерю числом и показать, где именно её чинят, —
 * может, и это честнее, чем молчать о ней, показывая рядом три галочки на
 * пару процентов.
 *
 * Запрос один и тот же на все проверки: PowerShell поднимается около секунды,
 * и пять отдельных запусков стоили бы пяти секунд на каждый разбор.
 */

/*
 * Классы намеренно опрошены каждый в своём try: на сборках без модуля Storage
 * нет `MSFT_Partition`, на виртуалках — `WmiMonitorListedSupportedSourceModes`,
 * и один отсутствующий класс не имеет права уносить с собой весь опрос.
 */
export const PROBE_COMMAND = [
  "$ErrorActionPreference='SilentlyContinue';",
  "$memory=@(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [pscustomobject]@{ capacity=$_.Capacity; rated=$_.Speed; configured=$_.ConfiguredClockSpeed } });",
  "$modes=@(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorListedSupportedSourceModes | ForEach-Object { $rates=@($_.MonitorSourceModes | ForEach-Object { [math]::Round($_.VerticalRefreshRateNumerator / [math]::Max(1,$_.VerticalRefreshRateDenominator)) }); [pscustomobject]@{ instance=$_.InstanceName; rates=$rates } });",
  "$controllers=@(Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentRefreshRate } | ForEach-Object { [pscustomobject]@{ name=$_.Name; current=$_.CurrentRefreshRate; width=$_.CurrentHorizontalResolution; height=$_.CurrentVerticalResolution } });",
  "$parts=@(Get-CimInstance -Namespace root/Microsoft/Windows/Storage -ClassName MSFT_Partition | Where-Object { $_.DriveLetter } | ForEach-Object { [pscustomobject]@{ letter=[string]$_.DriveLetter; disk=$_.DiskNumber } });",
  "$disks=@(Get-CimInstance -Namespace root/Microsoft/Windows/Storage -ClassName MSFT_PhysicalDisk | ForEach-Object { [pscustomobject]@{ id=$_.DeviceId; media=$_.MediaType; bus=$_.BusType } });",
  "$volumes=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [pscustomobject]@{ letter=$_.DeviceID; free=$_.FreeSpace; size=$_.Size } });",
  "$page=@(Get-CimInstance Win32_PageFileUsage | ForEach-Object { [pscustomobject]@{ name=$_.Name; allocatedMb=$_.AllocatedBaseSize } });",
  "$auto=(Get-CimInstance Win32_ComputerSystem).AutomaticManagedPagefile;",
  "[pscustomobject]@{ memory=$memory; monitors=$modes; controllers=$controllers; partitions=$parts; disks=$disks; volumes=$volumes; pageFiles=$page; automaticPageFile=$auto } | ConvertTo-Json -Depth 5 -Compress",
].join(" ");

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const asArray = (value) =>
  Array.isArray(value)
    ? value
    : value === null || value === undefined
      ? []
      : [value];

/* MediaType в MSFT_PhysicalDisk: 3 — жёсткий диск, 4 — SSD, 5 — SCM.
   Ноль и единица означают «неизвестно», и врать по ним нельзя. */
const MEDIA_HDD = 3;
const MEDIA_SSD = 4;

/**
 * Разбор ответа PowerShell в то, чем пользуются проверки.
 *
 * Всё, чего в ответе не оказалось, становится `null`, а не нулём: ноль здесь
 * читался бы как измеренное значение, и проверка честно сказала бы «памяти
 * 0 МГц» вместо «не знаю».
 */
export function normalizeProbe(payload) {
  const source = payload && typeof payload === "object" ? payload : {};

  const modules = asArray(source.memory)
    .map((item) => ({
      capacityBytes: asNumber(item?.capacity),
      ratedMhz: asNumber(item?.rated),
      configuredMhz: asNumber(item?.configured),
    }))
    .filter((item) => item.ratedMhz || item.configuredMhz);

  /*
   * Планок несколько, и частота у них общая: контроллер памяти один. Берётся
   * минимум настроенной и максимум паспортной — так проверка не промолчит,
   * если одна планка медленнее остальных.
   */
  const configuredMhz = modules.length
    ? Math.min(...modules.map((item) => item.configuredMhz || item.ratedMhz))
    : 0;
  const ratedMhz = modules.length
    ? Math.max(...modules.map((item) => item.ratedMhz || item.configuredMhz))
    : 0;

  const monitorRates = asArray(source.monitors).flatMap((item) =>
    asArray(item?.rates).map(asNumber).filter(Boolean),
  );
  const controllers = asArray(source.controllers)
    .map((item) => ({
      name: String(item?.name || ""),
      currentHz: asNumber(item?.current),
      width: asNumber(item?.width),
      height: asNumber(item?.height),
    }))
    .filter((item) => item.currentHz);

  const diskByNumber = new Map(
    asArray(source.disks).map((item) => [
      String(item?.id ?? ""),
      { media: Number(item?.media), bus: Number(item?.bus) },
    ]),
  );
  const drives = new Map();
  for (const part of asArray(source.partitions)) {
    const letter = String(part?.letter || "")
      .replace(/:/g, "")
      .toUpperCase();
    if (!letter) continue;
    const disk = diskByNumber.get(String(part?.disk ?? ""));
    drives.set(letter, {
      letter,
      media: disk ? disk.media : null,
      bus: disk ? disk.bus : null,
      freeBytes: 0,
      sizeBytes: 0,
    });
  }
  for (const volume of asArray(source.volumes)) {
    const letter = String(volume?.letter || "")
      .replace(/:/g, "")
      .toUpperCase();
    if (!letter) continue;
    const known = drives.get(letter) || {
      letter,
      media: null,
      bus: null,
      freeBytes: 0,
      sizeBytes: 0,
    };
    known.freeBytes = asNumber(volume?.free);
    known.sizeBytes = asNumber(volume?.size);
    drives.set(letter, known);
  }

  const pageFiles = asArray(source.pageFiles)
    .map((item) => ({
      name: String(item?.name || ""),
      allocatedMb: asNumber(item?.allocatedMb),
    }))
    .filter((item) => item.name);

  /*
   * Ответил ли опрос вообще. Разница между «файл подкачки выключен» и
   * «powershell не поднялся» снаружи не видна: в обоих случаях список файлов
   * пуст. Без этого признака пустой ответ на виртуалке превращался бы в
   * уверенное «у вас выключена подкачка» — выдуманную находку, по которой
   * человек пошёл бы чинить то, что не сломано.
   */
  const measured =
    modules.length > 0 ||
    controllers.length > 0 ||
    monitorRates.length > 0 ||
    drives.size > 0 ||
    pageFiles.length > 0 ||
    source.automaticPageFile === true;

  return {
    measured,
    memory: {
      modules,
      ratedMhz: ratedMhz || null,
      configuredMhz: configuredMhz || null,
    },
    display: {
      currentHz: controllers.length
        ? Math.max(...controllers.map((item) => item.currentHz))
        : null,
      maxHz: monitorRates.length ? Math.max(...monitorRates) : null,
      controllers,
    },
    drives: [...drives.values()],
    pageFile: {
      automatic: source.automaticPageFile === true,
      files: pageFiles,
      allocatedMb: pageFiles.reduce((sum, item) => sum + item.allocatedMb, 0),
    },
  };
}

/** Диск, на котором лежит папка игры, — по букве из её пути. */
export function driveOf(probe, gamePath) {
  const letter = String(gamePath || "")
    .slice(0, 1)
    .toUpperCase();
  if (!/[A-Z]/.test(letter)) return null;
  return probe?.drives?.find((item) => item.letter === letter) || null;
}

export const isHardDisk = (drive) => Number(drive?.media) === MEDIA_HDD;
export const isSolidState = (drive) => Number(drive?.media) === MEDIA_SSD;
