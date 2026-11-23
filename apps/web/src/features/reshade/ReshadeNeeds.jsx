/*
 * «Что нужно» — средняя карточка полосы под кадром (дизайн 15.11.2026, DLSS 5 «Кино», в коде вернули 16.11 по слову владельца «один в один»):
 * не абзац, а четыре строки с отметкой — видеокарта, драйвер NVIDIA, игра, лаунчер Majestic. Всё читается из того, что уже знает страница
 * (`readReshade`: видеокарта, драйвер, места установки; `useGameEditions`: найденные издания GTA V) — ничего не выдумывается: пока ответа нет,
 * у строки нет отметки, а значение — «Проверяем…».
 */

import { tr } from "../../locales/ui.js";

/*
 * Значки строк и отметок — маленькие инлайновые SVG без зависимостей (решение 16.11.2026: «значки остаются, первый кадр не хуже прежнего»).
 * Рисунки — те же, что у набора Astral (`@astral/glyphs`: видеокарта, молния, геймпад, монитор), канон холста тот же: 24 × 24, штрих 1,5, круглые
 * концы, цвет от текста. Прежде строки брали их из набора через `components/ui/icons.jsx` — на первом кадре страницы это стоило ~250 мс.
 */
const Svg = ({ className, children }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

const GraphicsCard = ({ className }) => (
  <Svg className={className}>
    <polygon points="3 6.75 5.25 4.5 21 4.5 21 12.75 18.75 15 3 15" />
    <circle cx="8.25" cy="9.75" r="2.25" />
    <path d="M14.25 7.5 V12 M17.25 7.5 V12" />
    <path
      d="M4.5 18 H12 V21 H4.5 Z M14.25 18 H19.5 V21 H14.25 Z"
      fill="currentColor"
      stroke="none"
    />
  </Svg>
);
const Lightning = ({ className }) => (
  <Svg className={className}>
    <polygon points="14.25 3 6 13.5 11.25 13.5 9.75 21 18 10.5 12.75 10.5" />
  </Svg>
);
const GameController = ({ className }) => (
  <Svg className={className}>
    <path d="M 6.75 5.25 H 17.25 Q 21 5.25 21 9 V 15.75 Q 21 18.75 18.75 18.75 L 15.75 15.75 H 8.25 L 5.25 18.75 Q 3 18.75 3 15.75 V 9 Q 3 5.25 6.75 5.25 Z" />
    <path d="M 6 10.5 H 10.5 M 8.25 8.25 V 12.75" />
    <circle cx="15.75" cy="10.5" r="2.25" fill="currentColor" stroke="none" />
  </Svg>
);
const Monitor = ({ className }) => (
  <Svg className={className}>
    <rect x="3" y="3" width="18" height="12.75" rx="1.5" />
    <path d="M12 15.75 V20.25 M8.25 20.25 H15.75" />
  </Svg>
);
const Check = ({ className }) => (
  <Svg className={className}>
    <path d="M5 12.5 L9.5 17 L19 7.5" />
  </Svg>
);
const Warning = ({ className }) => (
  <Svg className={className}>
    <path d="M12 4 L21 19.5 H3 Z M12 10 V14 M12 16.8 V16.9" />
  </Svg>
);
const X = ({ className }) => (
  <Svg className={className}>
    <path d="M6 6 L18 18 M18 6 L6 18" />
  </Svg>
);
const Minus = ({ className }) => (
  <Svg className={className}>
    <path d="M5 12 H19" />
  </Svg>
);

const MARKS = {
  ok: Check,
  warn: Warning,
  bad: X,
  none: Minus,
};

/* Видеокарта: RTX — то, что нужно; другая — предупреждение с её именем; ответа ещё нет — «Проверяем…». */
function gpuRow({ state, gpu, dlssCopy }) {
  const label = tr("Видеокарта");
  if (!state)
    return {
      id: "gpu",
      icon: GraphicsCard,
      label,
      value: tr("Проверяем…"),
      tone: "",
    };
  const names = gpu?.names || [];
  const name =
    (gpu?.rtx === true ? names.find((item) => /RTX/i.test(item)) : null) ||
    names[0] ||
    dlssCopy.gpuUnknown;
  return {
    id: "gpu",
    icon: GraphicsCard,
    label,
    value: name,
    tone: gpu?.rtx === true ? "ok" : "warn",
  };
}

/* Драйвер NVIDIA: номер, а у старого — «· старый»; у не-NVIDIA карты драйвера для DLSS 5 нет — прочерк. */
function driverRow({ state, gpu, driverOld }) {
  const label = tr("Драйвер NVIDIA");
  if (!state)
    return {
      id: "driver",
      icon: Lightning,
      label,
      value: tr("Проверяем…"),
      tone: "",
    };
  if (!(gpu?.rtx === true) || !gpu.driver)
    return { id: "driver", icon: Lightning, label, value: "—", tone: "none" };
  const number = gpu.driver.toFixed(2);
  return driverOld
    ? {
        id: "driver",
        icon: Lightning,
        label,
        value: tr("{driver} · старый").replace("{driver}", number),
        tone: "warn",
      }
    : { id: "driver", icon: Lightning, label, value: number, tone: "ok" };
}

/* Игра: Legacy найдена — всё в порядке; одна Enhanced — не проверена (DLSS там встроен в меню графики); игры нет — отказ. */
function gameRow({ editions }) {
  const label = tr("Игра");
  if (!editions.ready)
    return {
      id: "game",
      icon: GameController,
      label,
      value: tr("Проверяем…"),
      tone: "",
    };
  if (editions.legacy)
    return {
      id: "game",
      icon: GameController,
      label,
      value: tr("{edition} · найдена").replace("{edition}", "GTA V Legacy"),
      tone: "ok",
    };
  if (editions.enhanced)
    return {
      id: "game",
      icon: GameController,
      label,
      value: tr("{edition} · найдена").replace("{edition}", "GTA V Enhanced"),
      tone: "warn",
    };
  return {
    id: "game",
    icon: GameController,
    label,
    value: tr("Игра не найдена"),
    tone: "bad",
  };
}

/* Лаунчер Majestic: не найден — прочерк (ReShade ставится и в другие места); найден — включена ли «Поддержка графических модификаций». */
function majesticRow({ state }) {
  const label = tr("Лаунчер Majestic");
  if (!state)
    return {
      id: "majestic",
      icon: Monitor,
      label,
      value: tr("Проверяем…"),
      tone: "",
    };
  const target = (state.targets || []).find((item) => item.id === "majestic");
  if (!target?.available)
    return {
      id: "majestic",
      icon: Monitor,
      label,
      value: tr("Majestic не найден"),
      tone: "none",
    };
  if (target.modSupport === true)
    return {
      id: "majestic",
      icon: Monitor,
      label,
      value: tr("Поддержка модов включена"),
      tone: "ok",
    };
  if (target.modSupport === false)
    return {
      id: "majestic",
      icon: Monitor,
      label,
      value: tr("Поддержка модов выключена"),
      tone: "warn",
    };
  return {
    id: "majestic",
    icon: Monitor,
    label,
    value: tr("Majestic найден"),
    tone: "ok",
  };
}

export function needsRows(input) {
  return [gpuRow(input), driverRow(input), gameRow(input), majesticRow(input)];
}

export default function ReshadeNeeds({ rows, label, children }) {
  return (
    <section
      className="reshade-part reshade-needs"
      data-part="pc"
      aria-label={label}
    >
      <ul className="reshade-needs-list">
        {rows.map(({ id, icon: Icon, label: name, value, tone }) => {
          const Mark = MARKS[tone];
          return (
            <li key={id} data-need={id} data-tone={tone || undefined}>
              <Icon className="reshade-needs-icon" />
              <span className="reshade-needs-text">
                <small>{name}</small>
                <b title={value}>{value}</b>
              </span>
              {Mark ? <Mark className="reshade-needs-mark" /> : null}
            </li>
          );
        })}
      </ul>
      {children}
    </section>
  );
}
