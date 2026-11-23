import { useState } from "react";
import Button from "../../../components/ui/Button.jsx";
import Select from "../../../components/ui/Select.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import { SCREEN_FORM_CHOICES, resolveScreenView } from "./game-screen-view.js";

/*
 * Строка «Экран игры» рядом со сценой каждого редактора HUD (ТЗ H1, 14.11.2026): человек всегда видит, под какой экран
 * показан предпросмотр и откуда это известно.
 *
 *   Экран игры: 1920×1080, формат 4:3 (растянут), безопасная зона 3          изменить
 *   Экран игры неизвестен: показано для 16:9                                  изменить
 *
 * «Безопасная зона N» — сырое значение настройки 212 профиля игрока (нет профиля — «по умолчанию»). Источники — в подсказке:
 * «из settings.xml», «Авто: по разрешению», «нет файла — по умолчанию». «Изменить» открывает выбор формы из девяти:
 * он меняет только предпросмотр (у мини-карты — форму окна, под которую человек двигает рамку).
 *
 * @param {object} props
 * @param {object} props.info `describeGameScreen(...)` — экран игры в одном виде.
 * @param {string|null} [props.chosen] Форма, выбранная вручную («4:3»), или `null` — как в игре.
 * @param {Function} [props.onChange] `(имяФормы | null) => void`; `null` — вернуться к экрану игры.
 * @param {"game"|"monitor"|"none"|null} [props.zoomBasis] От чего посчитано «В размер игры» (`gameZoomBasis`); `null` — строка молчит.
 * @param {boolean} [props.ofWork] Показана форма РАБОТЫ (мини-карта): расхождение с игрой называется прямо — «Работа показана
 *   под формой X, а в игре Y», — а не «Показано для X».
 */
export default function GameScreenLine({
  info,
  chosen = null,
  onChange = null,
  zoomBasis = null,
  ofWork = false,
  className = "",
}) {
  useTr();
  const [editing, setEditing] = useState(false);
  const view = resolveScreenView({ info, chosen });
  const known = Boolean(info?.known);

  const sourceOf = (group, key) => {
    if (group === "aspect")
      return (
        {
          settings: tr("из settings.xml"),
          project: tr("указано вами"),
          "auto-resolution": tr("Авто: по разрешению"),
          default: tr("нет файла — по умолчанию"),
          unknown: tr("не узнать"),
        }[key] || tr("не узнать")
      );
    return (
      {
        profile: tr("из профиля игрока (настройка 212)"),
        default: tr("по умолчанию"),
        unknown: tr("не узнать"),
      }[key] || tr("не узнать")
    );
  };

  let text;
  if (!known) {
    text = trFill(
      info?.reason === "enhanced"
        ? "Экран игры Enhanced не читается: показано для {0}"
        : "Экран игры неизвестен: показано для {0}",
      view.name,
    );
  } else {
    /* Прежний ответ главного процесса отдавал размер зоны (0,97), новый — шаг настройки (3): это одно и то же число. */
    const step =
      info.safeZoneStep ??
      (info.safeZone ? Math.round((1 - info.safeZone) * 100) : null);
    const base = info.resolution
      ? trFill("Экран игры: {0}, формат {1}", info.resolution, info.form)
      : trFill("Экран игры: формат {0}", info.form);
    const zone =
      step === null
        ? tr("безопасная зона по умолчанию")
        : trFill("безопасная зона {0}", step);
    text = `${info.stretched ? `${base} ${tr("(растянут)")}` : base}, ${zone}`;
  }
  const differs = known && view.source === "chosen" && !view.matchesGame;
  /* Источники называются и у неизвестного экрана: «нет файла — по умолчанию» или «не узнать» (Enhanced). */
  const title = trFill(
    "Формат: {0}. Безопасная зона: {1}.",
    sourceOf("aspect", info?.sources?.aspect ?? "default"),
    sourceOf("inset", info?.sources?.inset ?? "unknown"),
  );
  const basis =
    zoomBasis === "game"
      ? trFill(
          "Увеличение в игре считано от разрешения игры {0}",
          info?.resolution || String(info?.width ?? ""),
        )
      : zoomBasis === "monitor"
        ? tr(
            "Увеличение в игре считано от монитора, разрешение игры неизвестно",
          )
        : "";

  const options = [
    ...(known ? [["game", tr("Как в игре")]] : []),
    ...SCREEN_FORM_CHOICES.map((form) => [form.name, form.name]),
  ];
  const picked =
    view.source === "chosen" ? view.name : known ? "game" : view.name;

  return (
    <div
      className={`gs-line${known ? "" : " is-warning"}${className ? ` ${className}` : ""}`}
      data-game-screen
      data-known={known ? "true" : "false"}
      data-form={view.name}
    >
      <p className="gs-line-text" title={title}>
        {text}
        {differs
          ? ` · ${
              ofWork
                ? trFill(
                    "Работа показана под формой {0}, а в игре {1}",
                    view.name,
                    view.game?.name ?? info.form,
                  )
                : trFill("Показано для {0}", view.name)
            }`
          : ""}
      </p>
      {onChange ? (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={editing}
          aria-label={tr("Изменить форму экрана")}
          onClick={() => setEditing((open) => !open)}
        >
          {tr("изменить")}
        </Button>
      ) : null}
      {basis ? <p className="gs-line-basis">{basis}</p> : null}
      {onChange && editing ? (
        <div className="gs-line-pick">
          <Select
            label={tr("Форма экрана")}
            value={picked}
            options={options}
            onChange={(value) => {
              setEditing(false);
              onChange(value === "game" ? null : value);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
