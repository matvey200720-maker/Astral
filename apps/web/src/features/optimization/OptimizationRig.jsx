import { Cpu, DesktopTower, GraphicsCard, Laptop, Memory } from "../../components/ui/icons.jsx";
import { pluralWord } from "../../plural.js";
import { tr, useTr } from "../../locales/ui.js";

// Слоты: [значок, название]. Названия известны до ответа разбора и переводятся в месте отрисовки.
const IDLE_SLOTS = [
  [DesktopTower, "Компьютер"],
  [Cpu, "Процессор"],
  [GraphicsCard, "Видеокарта"],
  [Memory, "Оперативная память"],
];
const DEVICE_NAMES = { laptop: "Ноутбук", desktop: "Стационарный ПК" };

const num = (v) => Number(v) || 0;
const joined = (parts, sep = " · ") => parts.filter(Boolean).join(sep);

function shortDate(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("ru-RU", { dateStyle: "short" }).format(d);
}

// Четыре слота при известном железе: [значок, название, значение, подробность]; пустая подробность — без узла.
const SLOT_BUILDERS = [
  ({ formFactor, system, battery }) => {
    const { manufacturer, model } = system ?? {};
    const charge = battery?.chargePercent;
    return [
      formFactor === "laptop" ? Laptop : DesktopTower,
      tr(Object.hasOwn(DEVICE_NAMES, formFactor) ? DEVICE_NAMES[formFactor] : "Компьютер"),
      joined([manufacturer, model], " ") || "Windows PC",
      Number.isFinite(charge) ? tr("Батарея {0}%").replace("{0}", charge) : "Windows",
    ];
  },
  ({ primaryCpu }) => {
    const cpu = primaryCpu ?? {};
    const [cores, threads, mhz] = [cpu.cores, cpu.logicalProcessors, cpu.maxClockMhz].map(num);
    return [
      Cpu,
      tr("Процессор"),
      cpu.name || tr("Не определён"),
      joined([
        cores && `${cores} ${pluralWord(cores, [tr("ядро"), tr("ядра"), tr("ядер")])}`,
        threads && tr("{0} потоков").replace("{0}", threads),
        mhz && tr("{0} ГГц").replace("{0}", (mhz / 1000).toFixed(1)),
      ]),
    ];
  },
  // Объём видеопамяти в строку не попадает намеренно: WMI отдаёт его урезанным до 4 ГБ.
  ({ primaryGpu, hybridGraphics, gpus }) => {
    const gpu = primaryGpu ?? {};
    const driver = gpu.driverDate
      ? tr("драйвер от {0}").replace("{0}", shortDate(gpu.driverDate))
      : gpu.driverVersion && tr("драйвер {0}").replace("{0}", gpu.driverVersion);
    const adapters = gpus?.length;
    return [
      GraphicsCard,
      hybridGraphics ? tr("Дискретная графика") : tr("Видеокарта"),
      gpu.name || tr("Не определена"),
      joined([driver, adapters > 1 && tr("{0} адаптера").replace("{0}", adapters)]),
    ];
  },
  ({ memoryGb, memory }) => {
    const free = memory?.freeBytes;
    return [
      Memory,
      tr("Оперативная память"),
      memoryGb ? tr("{0} ГБ").replace("{0}", memoryGb) : tr("Не определена"),
      Number.isFinite(free) && free > 0 ? tr("{0} ГБ свободно").replace("{0}", Math.round((free / 2 ** 30) * 10) / 10) : "",
    ];
  },
];

function Row({ slot: [Icon, name, value = "", detail = ""], index, known }) {
  return (
    <p className="optimization-rig-row" style={{ "--optimization-row": index }}>
      <Icon />
      <span>
        <small>{name}</small>
        {value ? <b title={value}>{value}</b> : <b aria-hidden="true" />}
        {!known ? <em aria-hidden="true" /> : detail ? <em>{detail}</em> : null}
      </span>
    </p>
  );
}

export default function OptimizationRig({ hardware = null }) {
  useTr();
  const known = Boolean(hardware);
  const profile = (known && hardware.recommendedProfile) || {};
  const keySuffix = known ? "live" : "idle";
  const slots = known
    ? SLOT_BUILDERS.map((build) => build(hardware))
    : IDLE_SLOTS.map(([icon, title]) => [icon, tr(title)]);
  let note;
  if (known) {
    note = profile.reason || tr("Профиль подобран по найденному оборудованию.");
  } else {
    note = tr("Оборудование определяется при каждом запуске — по нему подбирается профиль.");
  }
  const rows = slots.map((slot, index) => (
    <Row
      key={`${index}-${keySuffix}`}
      index={index}
      known={known}
      slot={slot}
    />
  ));

  return (
    <section
      className="ui-panel optimization-rig"
      data-known={known ? "yes" : "no"}
    >
      <header>
        <h2>{tr("Ваш компьютер")}</h2>
        {profile.label ? <span className="optimization-rig-profile">{profile.label}</span> : null}
      </header>
      <div className="optimization-rig-list">{rows}</div>
      <small>{note}</small>
    </section>
  );
}
