import {
  DEFAULT_ATLAS,
  HEAVY_TILE_BYTES,
  MAP_DETAIL_LEVELS,
  MAP_TILE_SIDE_LIMIT,
  MAP_ZOOM_PRESETS,
  MAP_ZOOM_RANGE,
  atlasSize,
  mapZoomView,
  upscaleFactorFor,
} from "@modovik/vector-map";
import Button from "../../ui/Button.jsx";
import ChoiceTile from "../../ui/ChoiceTile.jsx";
import Slider from "../../ui/Slider.jsx";
import Switch from "../../ui/Switch.jsx";
import { workshopFallbackMediaBySlot } from "../../../workshop-visuals.js";
import { DetailChoice } from "./world-map/MapChoicePictures.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { mapText } from "./world-map/map-copy.js";

/*
 * Панели «про игру»: то, как карта ведёт себя в самой GTA V — как далеко открывается, насколько чёткая при приближении и
 * размытие за ней. Штатные контуры и мини-карту человек не выбирает: у изменённой карты контуры уходят сами (13.10), а
 * мини-карта в углу экрана идёт в её цветах (`pauseMapPlan`, `radarPlan`; раздела «Мини-карта в углу экрана» в панели
 * нет с 22.10 по ТЗ владельца). Моря вокруг карты тоже не выбирают (22.10): остаётся только выключатель размытия, по
 * умолчанию выключенный. Вид карты выбирается страницей «Вид карты» (`world-map/MapLookPage.jsx`; до 10.10 — листом
 * поверх кадра).
 */

/*
 * Кадр карты при открытии.
 *
 * Экран 16:9, в нём — карта в том масштабе, с которым она откроется по Esc.
 * Картинка — вся карта штата (та же, что на странице раздела, либо подложка
 * редактора), рамка — оценка: точный кадр зависит от разрешения и безопасной
 * зоны игры, поэтому подпись так и говорит. Игра центрирует карту на игроке;
 * здесь центр — середина штата, иначе «весь штат» было бы не показать.
 */
function MapZoomPreview({ zoom, image, backdrop, atlas }) {
  useTr();
  const view = mapZoomView(zoom);
  const size = atlasSize(atlas || DEFAULT_ATLAS);
  /* Высота карты в долях высоты кадра. */
  const height = (size.height / view.height) * 100;
  const width = (size.width / view.width) * 100;
  return (
    <figure className="wmc-zoom-preview">
      <div className="wmc-zoom-screen" style={{ background: backdrop }}>
        <img
          src={image}
          alt=""
          draggable="false"
          style={{
            width: `${width}%`,
            height: `${height}%`,
            left: `${(100 - width) / 2}%`,
            top: `${(100 - height) / 2}%`,
          }}
        />
      </div>
      <figcaption className="wmc-hint">
        {tr("Примерный кадр: так карта откроется по Esc. Игра ставит в центр вас, а не середину штата.")}
      </figcaption>
    </figure>
  );
}

/* Мегабайты видеопамяти целыми: оценка, а не счёт до байта. */
const megabytes = (bytes) => Math.max(1, Math.round(bytes / (1024 * 1024)));

/*
 * Вес карты в игре (13.10, 17.10). Два числа: сколько карта займёт целиком и
 * сколько весит одна плитка карты паузы — игра подгружает её целиком, когда
 * плитка входит в кадр при прокрутке, и лаг «листаешь карту — фризы» растёт
 * именно с ней (штатная — 1 МБ, 4096 DXT5 у паков — 16–21). Игру мы не
 * запускаем, поэтому про подтормаживание сказано «может». Предупреждение —
 * когда плитка тяжелее той, что пишет «Очень чётко» (`HEAVY_TILE_BYTES`), или
 * карта целиком тяжелее 160 МБ; кнопка «Поставить «Чётко»» меняет только
 * чёткость.
 */
function MapWeight({ weight, detail, onDetail, live = null }) {
  useTr();
  const lighter = Number(weight.byDetail?.[4]) < weight.bytes;
  const heavyTile = Number(weight.tile) >= HEAVY_TILE_BYTES;
  return (
    <>
      {live && <LiveMapNote live={live} weight={weight} />}
      <small className="wmc-hint wmc-weight">
        {mapText("В игре карта займёт около {size} МБ видеопамяти (штатная — {stock} МБ).", {
          size: megabytes(weight.bytes),
          stock: megabytes(weight.stock),
        })}
        {weight.tile > 0 &&
          ` ${mapText("При прокрутке игра подгружает плитку целиком: {tile} МБ (штатная — {stockTile} МБ).", {
            tile: megabytes(weight.tile),
            stockTile: megabytes(weight.stockTile || 0),
          })}`}
        {weight.assumed ? ` ${tr("Оценка по штатным плиткам игры: игра ещё не прочитана.")}` : ""}
      </small>
      {(weight.heavy || heavyTile) && (
        <div className="wmc-weight-warning" role="note">
          <small className="wmc-hint">{tr("На слабых видеокартах карта в игре может подтормаживать при движении и приближении.")}</small>
          {lighter && detail !== 4 && (
            <Button size="sm" variant="secondary" onClick={() => onDetail?.(4)}>
              {tr("Поставить «Чёткую»")}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/*
 * Что лежит в игре сейчас (17.10, `apps/desktop/src/world-map-live.js`):
 * редактор показывает штатную карту, а лагать может то, что стоит в архиве, —
 * чужой атлас 4096 без мипов, несжатые плитки или наша прошлая «Очень чётко»
 * в DXT5. Тяжёлая плитка — названа причина фризов при прокрутке и что
 * «Применить» поставит вместо неё.
 */
function LiveMapNote({ live, weight }) {
  useTr();
  const pause = live.pause || {};
  if (!pause.tiles) return null;
  const facts = mapText("Сейчас в игре: карта {size} МБ, плитка {side}² {format}{mips} — {tile} МБ.", {
    size: megabytes(live.bytes || 0),
    side: pause.side || 0,
    format: pause.format || "?",
    mips: pause.mipmaps ? "" : `, ${tr("без мипов")}`,
    tile: megabytes(pause.tile || 0),
  });
  if (!live.heavy)
    return <small className="wmc-hint wmc-live-map">{facts}</small>;
  return (
    <div className="wmc-weight-warning wmc-live-map" role="note">
      <small className="wmc-hint">
        {facts}{" "}
        {mapText("Такая плитка в {times} раз тяжелее штатной, а игра подгружает её целиком, когда она входит в кадр, — отсюда пролаги при прокрутке карты. «Применить» поставит вашу карту: плитка {ours} МБ.", {
          times: Math.max(2, Math.round((pause.tile || 0) / (1024 * 1024))),
          ours: megabytes(weight.tile || 0),
        })}
      </small>
    </div>
  );
}

/*
 * Подпись под каждой ступенью чёткости: что она стоит в игре — вся карта и
 * одна плитка (`byDetail`, `tileByDetail`). Плитки паузы с 17.10 — BC1 с
 * запечённым морем, вдвое легче прежних, но «Очень чётко» всё равно в
 * десять раз тяжелее штатной плитки.
 */
function detailCost(weight, level) {
  if (!weight?.byDetail?.[level]) return "";
  return mapText("{size} МБ, плитка {tile} МБ", {
    size: megabytes(weight.byDetail[level]),
    tile: megabytes(weight.tileByDetail?.[level] || 0),
  });
}



/**
 * Карта в игре: отдаление при открытии и чёткость при приближении.
 *
 * @param {object} props
 * @param {object} props.config проект карты
 * @param {number} props.tileSide сторона плитки карты паузы у игрока (0 — не
 *   прочитана)
 * @param {boolean} props.vectorLayer оставит ли игра свой векторный слой
 * @param {object|null} props.weight вес карты в видеопамяти (`worldMapVideoWeight`):
 *   оценка под выбором чёткости; тяжёлая карта предупреждает и предлагает «Чётко»
 * @param {object|null} props.live что лежит в игре сейчас (`world-map-live.js`)
 * @param {string|null} props.previewImage подложка редактора одной картинкой
 * @param {"all"|"zoom"|"detail"|"blur"} [props.part] какую часть показать:
 *   отдаление и чёткость живут в «Зуме карты», размытие за картой — отдельным разделом
 */
export function MapInGamePanel({
  config,
  tileSide = 0,
  vectorLayer = true,
  previewImage = null,
  weight = null,
  live = null,
  atlas = null,
  onZoom,
  onDetail,
  onPauseMap = null,
  part = "all",
}) {
  useTr();
  const show = (name) => part === "all" || part === name;
  const zoom = config.zoom;
  const detail = config.export.detail;
  const side = tileSide || 1024;
  const factor = upscaleFactorFor(side, detail, MAP_TILE_SIDE_LIMIT);
  const preset = MAP_ZOOM_PRESETS.find(
    (item) => item.distance === zoom.distance,
  );
  const image =
    previewImage || workshopFallbackMediaBySlot["large-map"]?.[0] || "";
  const pauseMap = config.pauseMap;
  /* Кадр при открытии показывается на том море, что будет в игре. */
  const seaBackdrop = config.base.backdropColor;
  /* Выбор чёткости — и в «Отдалении и чёткости», и своей страницей колонки
     «Карта» (`part="detail"`, бета 15.10: строка уводила в другой инструмент,
     и вернуться назад было нечем). */
  const detailBlock = (
    <>
      {/* Якорь строки «Чёткость карты» колонки «Карта» (15.10): переход
              оттуда прокручивает сюда и коротко подсвечивает выбор. */}
          <div className="wmc-anchor" data-map-anchor="detail">
            <DetailChoice
              label={tr("Чёткость при приближении")}
              value={detail}
              levels={MAP_DETAIL_LEVELS}
              costs={weight ? MAP_DETAIL_LEVELS.map((level) => detailCost(weight, level.value)) : null}
              onChange={onDetail}
            />
            <small className="wmc-hint">
              {factor > 1
                ? mapText("Плитка карты — {big} точек вместо {side}: дороги и подписи остаются резкими при приближении. Запись в игру дольше на {time}.", {
                    big: side * factor,
                    side,
                    time: factor > 2 ? tr("полминуты") : tr("несколько секунд"),
                  })
                : tileSide && detail > 1
                  ? mapText("Плитки вашей карты уже {side} точек — крупнее редактор их не делает.", { side })
                  : mapText("Плитка карты — {side} точек, как в игре: при сильном приближении она мылится.", { side })}
            </small>
            {detail > 1 && <small className="wmc-hint">{tr("Вся чёткость видна при качестве текстур «Высокое» или «Очень высокое» в настройках графики игры: на «Обычном» игра показывает карту мягче.")}</small>}
            {detail >= 6 && (
              <small className="wmc-hint">
                {tr("«Очень чёткая» — самая резкая карта. Если при прокрутке карты в игре проседают кадры, поставьте «Чёткую»: подгрузка вдвое легче.")}
              </small>
            )}
            {weight && <MapWeight weight={weight} detail={detail} onDetail={onDetail} live={live} />}
          </div>
    </>
  );
  return (
    <>
      {part === "detail" && detailBlock}
      {show("zoom") && (
        <>
          <div
            className="wmc-zoom-presets ui-choice-grid"
            role="radiogroup"
            aria-label={tr("Отдаление карты при открытии")}
          >
            {MAP_ZOOM_PRESETS.map((item) => (
              <ChoiceTile
                key={item.id}
                role="radio"
                aria-checked={item.distance === zoom.distance}
                selected={item.distance === zoom.distance}
                title={tr(item.label)}
                description={tr(item.hint)}
                onClick={() => onZoom({ distance: item.distance })}
              />
            ))}
          </div>
          <Slider
            label={tr("Отдаление")}
            value={zoom.distance}
            min={MAP_ZOOM_RANGE.min}
            max={MAP_ZOOM_RANGE.max}
            step={MAP_ZOOM_RANGE.step}
            format={(value) => `×${Number(value).toFixed(1).replace(".", ",")}`}
            onChange={(distance) => onZoom({ distance })}
          />
          {image && (
            <MapZoomPreview
              zoom={zoom}
              image={image}
              backdrop={seaBackdrop}
              atlas={atlas}
            />
          )}
          <small className="wmc-hint">
            {preset?.id === "game"
              ? tr("Карта открывается как в игре. Отдалите её — и штат будет виден целиком сразу, без прокрутки колесом.")
              : tr("Карта откроется дальше, и колесом её можно будет отдалить до этого же вида. Приближение остаётся штатным.")}
          </small>
          {detailBlock}
          {!vectorLayer && (
            <small className="wmc-hint">
              {tr("Вы изменили карту, поэтому при установке Astral выключит штатный векторный слой карты паузы: иначе при приближении игра рисует поверх вашей карты свою, и ваша «пропадает». Мини-карта в углу экрана пойдёт в цветах вашей карты.")}
            </small>
          )}
        </>
      )}
      {/* Размытие игры за картой (15.10): слой эффекта паузы в animpostfx.ymt игрока — `apps/desktop/src/pause-menu-blur.js`.
          С 22.10 это единственная настройка «вокруг карты» (море убрано), и по умолчанию размытие выключено. */}
      {show("blur") && (
        <>
          <label className="ui-field wmc-switch-line">
            <span>{tr("Размытие за картой")}</span>
            <Switch
              checked={pauseMap.blur !== "off"}
              label={tr("Размытие за картой")}
              onChange={(on) =>
                onPauseMap?.(
                  { blur: on ? "game" : "off" },
                  on ? tr("Размытие за картой включено") : tr("Размытие за картой выключено"),
                  "pauseMap.blur",
                )
              }
            />
          </label>
          <small className="wmc-hint">
            {pauseMap.blur === "off"
              ? tr("Пока открыта карта, за ней видна чёткая игра. Приглушённый цвет фона паузы остаётся как в игре.")
              : tr("Как в игре: пока открыта карта, игра за ней размыта.")}
          </small>
        </>
      )}
    </>
  );
}
