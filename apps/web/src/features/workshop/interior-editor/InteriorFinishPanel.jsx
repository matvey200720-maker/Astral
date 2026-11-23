/*
 * Панель отделки: чем покрашено помещение.
 *
 * Сам список поверхностей приходит из кадра, а не из реестра, и это главное
 * про эту панель. Состав магазина лежит в файлах Rockstar: пока модель не
 * приехала из установленной игры, никто — ни редактор, ни контракт — не знает,
 * сколько у него стен, есть ли потолок и чем застелен пол. Поэтому панель
 * ничего не обещает заранее: пусто, пока помещение едет, и ровно то, что в нём
 * нашлось, когда приехало.
 *
 * Поверхности сгруппированы по деталям помещения — «Зал: стены, пол и
 * потолок», «Стеллажи», «Прилавок», — потому что так их разложила сама игра, и
 * человек, который ищет полку, ищет её среди стеллажей.
 *
 * Выбирают поверхность двумя способами, и второй важнее первого: строкой в
 * списке и щелчком по ней прямо в кадре. Список называет её так, как сумел
 * опознать («Пол», «Стены», имя текстуры из игры), а щелчок не требует
 * опознания вовсе — ткнул в ту стену, которую видишь.
 *
 * Текстуру берут либо из самого помещения (это настоящие текстуры Rockstar,
 * уже приехавшие в кадр), либо свою картинку с диска. Список чужих текстур
 * поэтому не выдуман: в нём ровно то, что игра положила в этот магазин.
 */

import { useMemo, useRef } from "react";
import {
  ArrowCounterClockwise,
  ImageSquare,
  Upload,
} from "../../../components/ui/icons.jsx";
import Button from "../../../components/ui/Button.jsx";
import { INTERIOR_BULK_ROLES, interiorRoleLabel } from "./interior-finish.js";
import { tr, useTr } from "../../../locales/ui.js";
import ColorInput from "../../../components/ui/ColorInput.jsx";

/* Пустая краска: чтобы не проверять на null в каждой строке разметки. */
const NO_PAINT = Object.freeze({ color: "", texture: "" });

/* Цвет пипетки, когда поверхность ещё не крашена: её собственный цвет из игры.
   Белый у текстурированной поверхности — не «белая стена», а «текстура как
   есть», и открывать пипетку надо именно на нём. */
const paintColour = (surface, paint) =>
  paint.color || surface.baseColor || "#ffffff";

/** Как подписан выбор текстуры в строке поверхности. */
function textureNote(paint, surfaces, brought) {
  if (!paint.texture) return tr("как в игре");
  if (paint.texture === "flat") return tr("без текстуры");
  if (paint.texture.startsWith("room:")) {
    const source = surfaces.find((item) => item.id === paint.texture.slice(5));
    return source ? `текстура: ${source.label}` : tr("текстура помещения");
  }
  const own = brought.find((item) => item.reference === paint.texture);
  return own ? `картинка: ${own.name}` : tr("своя картинка");
}

export default function InteriorFinishPanel({
  surfaces = [],
  finish = [],
  selectedId = "",
  brought = [],
  error = "",
  onSelect,
  onPaint,
  onPaintRole,
  onImport,
  onClear,
}) {
  useTr();
  const fileInput = useRef(null);

  const painted = useMemo(
    () => new Map(finish.map((item) => [item.surfaceId, item])),
    [finish],
  );

  /* Детали помещения в том порядке, в каком их вернул кадр: он уже разложил
     поверхности по ролям, и переставлять их здесь значило бы спорить с тем,
     кто их видел. */
  const groups = useMemo(() => {
    const bySource = new Map();
    for (const surface of surfaces) {
      const group = bySource.get(surface.sourceId) || {
        id: surface.sourceId,
        label: surface.sourceLabel,
        items: [],
      };
      group.items.push(surface);
      bySource.set(surface.sourceId, group);
    }
    return [...bySource.values()];
  }, [surfaces]);

  /* Чем можно покрасить: все текстуры, приехавшие в это помещение из игры.
     Одна и та же текстура попадает сюда один раз — по картинке-образцу. */
  const palette = useMemo(() => {
    const seen = new Set();
    return surfaces.filter((surface) => {
      if (!surface.hasTexture) return false;
      const key = surface.texture || surface.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [surfaces]);

  /*
   * Пол, стены и потолок — тремя ползунками.
   *
   * Игра разложила каждую из них на несколько деталей: пол зала и пол
   * подсобки, стена за прилавком и стена у входа. Ползунок роли красит их
   * разом, а список ниже остаётся для точечных правок — «эту полку в другой
   * цвет». Строки нет там, где роли не нашлось: обещать покраску потолка в
   * помещении без потолка незачем.
   */
  const roleRows = useMemo(
    () =>
      INTERIOR_BULK_ROLES.map((role) => {
        const items = surfaces.filter((surface) => surface.role === role);
        const colours = new Set(
          items.map(
            (surface) => (painted.get(surface.id) || NO_PAINT).color || "",
          ),
        );
        const single = colours.size === 1 ? [...colours][0] : "";
        return {
          role,
          label: interiorRoleLabel(role),
          count: items.length,
          painted: items.some((surface) => painted.get(surface.id)?.color),
          /* Общий цвет — только когда он и правда общий: разные цвета в роли
             показывать одним значением значит соврать про две из трёх стен. */
          colour: single || items[0]?.baseColor || "#ffffff",
          mixed: colours.size > 1,
        };
      }).filter((row) => row.count > 0),
    [surfaces, painted],
  );

  const selected = surfaces.find((item) => item.id === selectedId) || null;
  const paint = (selected && painted.get(selected.id)) || NO_PAINT;

  if (!surfaces.length)
    return (
      <section className="ui-panel interior-finish">
        <h3>{tr("Отделка")}</h3>
        <p className="interior-note">
          {tr("Помещение ещё собирается в кадре — как соберётся, здесь появятся его стены, пол и полки. Без кадра (нет WebGL) красить нечего: краску кладут на то, что видно.")}
        </p>
      </section>
    );

  return (
    <section className="ui-panel interior-finish">
      <h3>Отделка · {finish.length}/64</h3>
      <p className="interior-note">
        {tr("Щёлкните по стене, полу или полке прямо в кадре — или выберите поверхность в списке. Отделка видна в предпросмотре и сохраняется в проекте; в устанавливаемый пакет она пока не входит.")}
      </p>

      {onPaintRole && roleRows.length ? (
        <div className="interior-role-rows">
          {roleRows.map((row) => (
            <label className="interior-field interior-role-row" key={row.role}>
              <span>
                <b>{row.label}</b>
                <small>
                  {row.count === 1
                    ? tr("одна поверхность")
                    : `${row.count} поверхностей`}
                  {row.mixed ? tr(" · цвета разные") : ""}
                </small>
              </span>
              <ColorInput
                className="ui-color-chip"
                aria-label={`Цвет: ${row.label}`}
                value={row.colour}
                onChange={(event) =>
                  onPaintRole(row.role, { color: event.target.value })
                }
              />
              <Button
                variant="ghost"
                size="sm"
                icon={<ArrowCounterClockwise />}
                aria-label={`Снять цвет: ${row.label}`}
                title={tr("Вернуть как в игре")}
                disabled={!row.painted}
                onClick={() => onPaintRole(row.role, { color: "" })}
              />
            </label>
          ))}
        </div>
      ) : null}

      <div className="interior-surface-list">
        {groups.map((group) => (
          <div className="interior-surface-group" key={group.id}>
            <b>{group.label}</b>
            {group.items.map((surface) => {
              const own = painted.get(surface.id) || NO_PAINT;
              return (
                <button
                  type="button"
                  key={surface.id}
                  className={selectedId === surface.id ? "is-active" : ""}
                  aria-pressed={selectedId === surface.id}
                  title={surface.texture || surface.id}
                  onClick={() =>
                    onSelect?.(selectedId === surface.id ? "" : surface.id)
                  }
                >
                  <i style={{ background: paintColour(surface, own) }} />
                  <span>
                    <b>{surface.label}</b>
                    <small>
                      {own.color || own.texture
                        ? textureNote(own, surfaces, brought)
                        : tr("как в игре")}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {selected ? (
        <div className="interior-surface-edit">
          <header>
            <b>{selected.label}</b>
            <small>{selected.sourceLabel}</small>
          </header>

          <label className="interior-field">
            <span>{tr("Цвет")}</span>
            <ColorInput
              className="ui-color-chip"
              aria-label={`Цвет поверхности «${selected.label}»`}
              value={paintColour(selected, paint)}
              onChange={(event) =>
                onPaint?.(selected.id, { color: event.target.value })
              }
            />
          </label>

          <div className="interior-finish-actions">
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowCounterClockwise />}
              disabled={!paint.color && !paint.texture}
              onClick={() => onPaint?.(selected.id, { color: "", texture: "" })}
            >
              {tr("Как в игре")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<ImageSquare />}
              disabled={paint.texture === "flat"}
              onClick={() => onPaint?.(selected.id, { texture: "flat" })}
            >
              {tr("Без текстуры")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Upload />}
              onClick={() => fileInput.current?.click()}
            >
              {tr("Своя картинка")}
            </Button>
            {/* Диалог выбора файла открывается кнопкой: своё поле ввода файла
                браузер рисует по-своему в каждой сборке, и вписать его в ряд
                кнопок нельзя. */}
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onImport?.(selected.id, file);
              }}
            />
          </div>

          {error ? <p className="interior-note is-blocked">{error}</p> : null}

          {brought.length ? (
            <div
              className="interior-texture-grid"
              role="group"
              aria-label={tr("Свои картинки")}
            >
              {brought.map((item) => (
                <button
                  type="button"
                  key={item.reference}
                  className={
                    paint.texture === item.reference ? "is-active" : ""
                  }
                  title={item.name}
                  onClick={() =>
                    onPaint?.(selected.id, { texture: item.reference })
                  }
                >
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          ) : null}

          <h3>{tr("Текстуры этого помещения")}</h3>
          <div
            className="interior-texture-grid"
            role="group"
            aria-label={tr("Текстуры помещения")}
          >
            {palette.map((item) => {
              const reference = `room:${item.id}`;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={paint.texture === reference ? "is-active" : ""}
                  title={item.texture || item.label}
                  aria-label={`Текстура «${item.texture || item.label}»`}
                  onClick={() => onPaint?.(selected.id, { texture: reference })}
                >
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt="" />
                  ) : (
                    <span>{item.texture || item.label}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {finish.length ? (
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowCounterClockwise />}
          onClick={() => onClear?.()}
        >
          {tr("Снять всю отделку")}
        </Button>
      ) : null}
    </section>
  );
}
