/*
 * Слой значков поверх кадра игры.
 *
 * Рисуется внутри общего двумерного окна (`hud-preview`): окно держит кадр,
 * его геометрию и безопасную зону, а сюда приходит готовая система координат
 * экрана. Радар встаёт в свой угол этой зоны, а внутри радара лежит кусок
 * настоящей карты игры с расставленными значками и проложенным маршрутом.
 *
 * Всё, что зависит от настроек, считается в `useMemo` и пересчитывается только
 * при их изменении. Кадрового цикла здесь нет и быть не должно: то, что живёт,
 * живёт CSS-анимациями, и React о них не знает вовсе — кадровый цикл ради
 * пульсации одного значка перерисовывал бы весь слой шестьдесят раз в секунду.
 *
 * Цена у этих анимаций разная, и путать их нельзя. Мигание значка и пульсация
 * шевронов двигают прозрачность — это композитор браузера, слой уже
 * растрирован. А течение пунктира двигает `stroke-dashoffset`, то есть саму
 * геометрию штриха: путь маршрута перерисовывается каждый кадр на главном
 * потоке. Поэтому течение выключено в штатном наборе и включается только
 * вместе с пунктиром: в покое кадр обязан стоять на нуле.
 *
 * Курс — единственное, что входит в раскладку и меняется протяжкой. Так и
 * задумано: прижать значок к настоящему краю радара можно только после
 * поворота, а не до него. Цена — десяток точек и пять узлов маршрута на кадр,
 * то есть меньше, чем стоит сама перерисовка этих же значков, которая при
 * повороте всё равно обязана произойти.
 *
 * Подложка — один элемент `img` на весь радар. Кусок карты выбирается сдвигом
 * и растяжением этого элемента, а не перерисовкой картинки: плитки игры
 * читаются один раз на открытие редактора, и ни одна правка цвета не должна
 * приводить к повторному чтению архивов или перезаливке текстуры.
 */

import { useMemo } from "react";
import { readableInk } from "./blips-model.js";
import BlipArt from "./BlipArt.jsx";
import { BLIP_POINT_PATH, ROUTE_ARROW_PATH } from "./blips-art.js";
import {
  RADAR_COVER,
  RADAR_MAGNIFY,
  blipScene,
  fieldAligned,
  fieldBox,
  fieldFrame,
  northMark,
  placeScene,
  radarPlacement,
  radarTurn,
  radarView,
  routeArrowSize,
  routeArrows,
  routePath,
} from "./blips-scene.js";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { fill, northLabel } from "./blips-lang.js";

const percent = (value) => `${(value * 100).toFixed(4)}%`;
const px = (value) => `${value.toFixed(2)}px`;

/**
 * @param {object} props
 * @param {object} props.geometry Геометрия от окна: `design` и `layer`.
 * @param {object} props.project Настройки значков и маршрута.
 * @param {object|null} props.field Подложка карты (`hud-map-field`).
 * @param {number} props.metres Ширина куска карты в метрах мира.
 * @param {boolean} props.magnified Лупа: радар и значки растут вместе.
 * @param {string[]} props.hidden Типы, убранные со сцены.
 * @param {string} props.place Место, на котором стоит сцена.
 * @param {number} props.heading Курс в градусах: на сколько повёрнута карта.
 * @param {number} [props.inset] Безопасная зона игрока (`describeGameScreen().inset`); без неё — отступ игры по умолчанию.
 */
export default function BlipsRadar({
  geometry,
  project,
  field = null,
  metres = 1600,
  magnified = false,
  hidden = [],
  place = undefined,
  heading = 0,
  inset = undefined,
}) {
  useTr();
  const language = useUiLanguage();
  const { design, layer } = geometry;
  /* Лупа увеличивает и радар, и значки, и маршрут — одним множителем. Растянуть
     только радар значило бы соврать про читаемость: значки на нём стали бы
     мельче относительно карты, а в игре они такими не станут. */
  const magnify = magnified ? RADAR_MAGNIFY : 1;
  /* Пиксель экрана 1080p в пикселях окна. Всё, что человек задаёт в пикселях
     игры, проходит через этот множитель — иначе значок в 24 пикселя будет
     двадцатью четырьмя пикселями окна, а не игры. */
  const scale = layer.scale || 1;
  const scene = blipScene(place);

  const radar = useMemo(
    () => radarPlacement({ design, magnify, inset }),
    [design, magnify, inset],
  );
  /* Кусок карты берётся квадратом по диагонали радара: повёрнутый радар свои
     углы иначе не накрывает. Метров на пиксель при этом не меняется — квадрат
     и шире, и «видит» ровно во столько же раз больше. */
  const view = useMemo(
    () =>
      radarView({
        centre: scene.centre,
        metres: metres * RADAR_COVER,
        aspect: 1,
      }),
    [scene, metres],
  );
  const turn = useMemo(() => radarTurn({ heading }), [heading]);
  const aligned = useMemo(() => fieldAligned(field), [field]);
  const backdrop = useMemo(
    () => (aligned ? fieldFrame(view) : null),
    [aligned, view],
  );
  const box = useMemo(() => fieldBox(), []);
  const placed = useMemo(
    () =>
      placeScene({
        blips: scene.blips,
        kinds: project.kinds,
        view,
        radar,
        hidden,
        magnify,
        turn,
      }),
    [scene, project.kinds, view, radar, hidden, magnify, turn],
  );
  const path = useMemo(
    () => routePath(scene.route, view, turn),
    [scene, view, turn],
  );
  /* Размер шеврона считает сцена: по нему же она разводит шевроны вдоль линии,
     и второй расчёт того же размера здесь означал бы, что нарисованное и
     расставленное — про разные стрелки. */
  const arrowArt = useMemo(
    () => routeArrowSize({ width: project.route.width, magnify }),
    [project.route.width, magnify],
  );
  const arrows = useMemo(
    () =>
      project.route.visible && project.route.arrows
        ? routeArrows({
            points: scene.route,
            view,
            radar,
            turn,
            arrow: arrowArt,
          })
        : [],
    [
      scene,
      view,
      radar,
      turn,
      arrowArt,
      project.route.visible,
      project.route.arrows,
    ],
  );
  const north = useMemo(() => northMark({ heading }), [heading]);

  const route = project.route;
  const routeWidth = route.width * magnify * scale;
  const casing = route.casing * magnify * scale;
  /* Свечение — размытая копия той же линии. Радиус считается от толщины: у
     тонкой линии широкий ореол читается как туман, а не как свечение. */
  const glow = (route.glow / 100) * route.width * 2.2 * magnify * scale;
  const dash = route.dashLength * magnify * scale;
  const arrowSize = arrowArt * scale;
  /* Цвет шеврона считается от цвета линии той же формулой, что и силуэт внутри
     значка: шеврон цвета линии на линии не виден вовсе. */
  const arrowInk = readableInk(route.color);

  return (
    <div
      className="blips-radar"
      role="img"
      aria-label={fill(tr("Радар: {n} значков на карте"), { n: placed.length })}
      style={{
        left: percent(radar.left),
        top: percent(radar.top),
        width: percent(radar.widthFraction),
        height: percent(radar.heightFraction),
      }}
    >
      {/* Крутится только подложка: положение значков и маршрута уже посчитано
          в координатах экрана, и второй поворот увёл бы их с карты. */}
      <div
        className="blips-radar-turn"
        style={{
          ...box,
          transform: `rotate(${-heading}deg)`,
          /* Обещание браузеру двигать этот слой — только пока его двигают.
             Постоянное обещание держит промотированный слой под картинкой
             атласа, растянутой до нескольких сотен процентов стороны квадрата,
             то есть десятки мегабайт текстуры композитора, — и держит их даже
             тогда, когда курс равен нулю и подложка неподвижна. */
          willChange: heading ? "transform" : undefined,
        }}
      >
        {field?.url ? (
          <img
            className={`blips-radar-field${aligned ? "" : " is-loose"}`}
            src={field.url}
            alt=""
            draggable="false"
            style={backdrop || undefined}
          />
        ) : null}
      </div>

      {/* Куда север. На повёрнутом радаре это единственное, по чему видно, что
          карта не просто съехала, — и в игре такая метка есть. Место считает
          сцена по настоящим сторонам радара: квадратом по его высоте буква
          уезжала с обода на середину карты, потому что обод прямоугольника —
          эллипс, а не окружность. Сама буква остаётся прямой при любом курсе:
          перевёрнутая «С» на южном читалась бы как другая буква. */}
      <i
        className="blips-radar-north"
        aria-hidden="true"
        style={{ left: percent(north.x), top: percent(north.y) }}
      >
        {northLabel(language)}
      </i>

      {route.visible && path ? (
        <svg
          className="blips-route"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/*
            Толщина задана в пикселях экрана, а не в единицах viewBox: коробка
            0…1 растянута на радар неравномерно (он шире, чем выше), и обычная
            линия стала бы в нём разной толщины на поворотах. `non-scaling-stroke`
            снимает это растяжение со штриха и оставляет его только у геометрии.
          */}
          {casing > 0 ? (
            /* Кант идёт ПОД линией и шире её на две обводки: жёлтая линия по
               жёлто-песочной карте Лос-Сантоса без него пропадает целиком, и
               свечение её не спасает — оно того же цвета, что и она. */
            <path
              className="blips-route-casing"
              d={path}
              fill="none"
              stroke={route.casingColor}
              strokeWidth={routeWidth + casing * 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <path
            className={`blips-route-line${route.dash && route.flow ? " is-flowing" : ""}`}
            d={path}
            fill="none"
            stroke={route.color}
            strokeWidth={routeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            strokeDasharray={
              route.dash
                ? `${dash.toFixed(2)} ${(dash * 0.8).toFixed(2)}`
                : undefined
            }
            style={{
              /* Ореол светит только с самой линии, а не со всей картинки: на
                 всём слое он размывал бы и тёмный кант, и линия превращалась
                 бы в жёлтую кляксу вместо линии с кантом. */
              ...(glow > 0.1
                ? {
                    filter: `drop-shadow(0 0 ${glow.toFixed(2)}px ${route.glowColor}) drop-shadow(0 0 ${(glow * 2).toFixed(2)}px ${route.glowColor})`,
                  }
                : null),
              ...(route.dash && route.flow
                ? { "--blips-flow-step": px(dash * 1.8) }
                : null),
            }}
          />
        </svg>
      ) : null}

      {/* Шевроны стоят отдельными значками, а не маркерами внутри маршрута:
          коробка маршрута растянута неравномерно, и маркер вышел бы скошенным.
          Задержка у каждого своя — так набор читается как бегущий по линии, а
          не как мигающая гирлянда. */}
      {arrows.map((arrow, index) => (
        <svg
          key={arrow.id}
          className={`blips-route-arrow${route.flow ? " is-flowing" : ""}`}
          viewBox="0 0 100 100"
          aria-hidden="true"
          style={{
            left: percent(arrow.x),
            top: percent(arrow.y),
            width: px(arrowSize),
            height: px(arrowSize),
            transform: `translate(-50%, -50%) rotate(${arrow.angle.toFixed(2)}deg)`,
            animationDelay: `${(-index * 0.16).toFixed(2)}s`,
          }}
        >
          <path d={ROUTE_ARROW_PATH} fill={arrowInk} />
        </svg>
      ))}

      {placed.map((blip) => {
        const style = project.kinds[blip.kind];
        const size = blip.size * scale;
        const point = Math.max(5, size * 0.34);
        return (
          <span
            key={blip.id}
            /* Форма именем класса не выдаётся: её видно в самом рисунке, а
               правил под неё в листе нет и не было — класс, за которым ничего
               не стоит, читается как забытая ветка вёрстки. Прижатый к рамке
               значок помечается: тень под ним своя, общая уходит вниз-вправо и
               от рамки не отделяет. */
            className={`blips-blip${blip.outside ? " is-edge" : ""}${style.blink ? " is-blinking" : ""}`}
            style={{
              left: percent(blip.x),
              top: percent(blip.y),
              width: px(size),
              height: px(size),
              zIndex: blip.order + 1,
              /* Подложечная тень — то, чем значок держится на пёстрой карте.
                 Она идёт от размера значка, а не постоянным числом: у мелкого
                 значка тень в шесть пикселей читается как грязь под ним. */
              "--blips-shadow": `${px(size * 0.06)} ${px(Math.max(1, size * 0.16))}`,
            }}
          >
            {/* Обводка идёт в тех же пикселях окна, что и размер: она задана
                пикселями макета, а значок здесь нарисован пикселями окна, и
                без перевода кант застывал постоянной величиной экрана. */}
            <BlipArt style={style} size={size} outline={blip.outline * scale} />
            {/* Прижатый значок остаётся собой, а куда за краем лежит его точка,
                показывает отдельная стрелка: подменять значок треугольником
                значило бы потерять, что именно там — заправка или задание. */}
            {blip.outside && blip.bearing !== null ? (
              <svg
                className="blips-blip-point"
                viewBox="0 0 100 100"
                aria-hidden="true"
                style={{
                  width: px(point),
                  height: px(point),
                  transform: `translate(-50%, -50%) rotate(${(blip.bearing + 90).toFixed(2)}deg) translateY(${px(-(size / 2 + point * 0.62))})`,
                }}
              >
                <path
                  d={BLIP_POINT_PATH}
                  fill={style.color}
                  stroke={style.outlineColor}
                  strokeWidth="16"
                  strokeLinejoin="round"
                  paintOrder="stroke"
                />
              </svg>
            ) : null}
            {blip.labelled ? (
              <b
                className={blip.labelAbove ? "is-above" : ""}
                style={{
                  fontSize: px(blip.font * scale),
                  /* Ширина ровно та, что отведена раскладкой: подпись, вышедшая
                     за отведённое, налезла бы на соседнюю или на рамку радара —
                     а так она обрезается многоточием там же, где кончается её
                     место. */
                  maxWidth: px(blip.labelWidth * scale),
                  [blip.labelAbove ? "bottom" : "top"]:
                    `${(100 + blip.labelGap * 100).toFixed(2)}%`,
                  transform: `translateX(calc(-50% + ${px(blip.labelShift * scale)}))`,
                }}
              >
                {tr(blip.label)}
              </b>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
