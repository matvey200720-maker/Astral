/*
 * Правая колонка редактора растительности.
 *
 * Три разговора вместо одной простыни ползунков: какой это покров, как растёт
 * трава и как её треплет ветер. Человек приходит сюда с одной задачей —
 * «сделать степь», «загустить газон», «пусть качается», — и остальные две в
 * этот момент только мешают искать.
 *
 * Величины подписаны так, как их видит глаз: травинок на квадратный метр,
 * сантиметры роста, метры дальности. Проценты остались там, где процент и есть
 * смысл, — разброс и сила ветра.
 */

import { ArrowCounterClockwise, Info } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Slider from "../../../ui/Slider.jsx";
import {
  VEGETATION_COVERS,
  VEGETATION_RANGES,
  coverById,
  grassCount,
  grassIsCapped,
  windCompass,
} from "./vegetation-model.js";
import { GROUND_ASSETS } from "./vegetation-textures.js";
import ColorField from "../../../ui/ColorField.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

const range = (key) => VEGETATION_RANGES[key];


function CoverPanel({ cover, grass, assets, onCover, onGrass }) {
  useTr();
  const chosen = coverById(cover.kind);
  /* В списке стоит только та земля, которая в самом деле нашлась в игре.
     Названия несуществующих текстур — это обещание, которого редактор не
     сдержит: нажатие ничего не изменит, и человек решит, что сломан он. */
  const found = GROUND_ASSETS.filter((entry) =>
    assets.some((item) => item.id === entry.id),
  );

  return (
    <>
      <SegmentedControl
        className="veg-covers"
        label={tr("Тип покрытия")}
        size="sm"
        value={cover.kind}
        onChange={(kind) => onCover(kind)}
        options={VEGETATION_COVERS.map((entry) => ({
          value: entry.id,
          label: tr(entry.label),
        }))}
      />
      <p className="veg-hint">{tr(chosen.hint)}</p>

      {found.length > 0 && (
        <div className="ui-panel veg-grounds">
          <h3>{tr("Земля из игры")}</h3>
          <div className="veg-ground-grid">
            <button
              type="button"
              className={cover.groundId ? "" : "is-active"}
              aria-pressed={!cover.groundId}
              onClick={() => onCover(cover.kind, { groundId: "" })}
            >
              {tr("По покрову")}
            </button>
            {found.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === cover.groundId ? "is-active" : ""}
                aria-pressed={entry.id === cover.groundId}
                onClick={() => onCover(cover.kind, { groundId: entry.id })}
              >
                {tr(entry.label)}
              </button>
            ))}
          </div>
        </div>
      )}

      <ColorField
        className="veg-colour"
        label={tr("Цвет травы")}
        hint={tr("тон, а не яркость: свет даёт солнце")}
        value={grass.colour}
        onChange={(colour) => onGrass({ colour })}
      />
      <Slider
        label={tr("Разброс цвета")}
        hint={tr("ноль — крашеный газон, сто — настоящая поляна")}
        value={grass.colourSpread}
        {...range("colourSpread")}
        unit=" %"
        onChange={(colourSpread) => onGrass({ colourSpread })}
      />
    </>
  );
}

function GrassPanel({ grass, onGrass }) {
  useTr();
  const drawn = grassCount(grass);
  const capped = grassIsCapped(grass);
  return (
    <>
      <Slider
        label={tr("Плотность")}
        hint={tr("{count} пучков в кадре").replace(
          "{count}",
          drawn.toLocaleString("ru-RU"),
        )}
        value={grass.density}
        {...range("density")}
        unit={tr(" пучк./м²")}
        onChange={(density) => onGrass({ density })}
      />
      {capped && (
        <p className="veg-hint is-warning">
          {tr("Уперлись в потолок пучков. Дальше густить бессмысленно: окно нарисует ровно столько же, а в игре плотность считается по своим правилам. Убавьте дальность, если нужно гуще вблизи.")}
        </p>
      )}
      <Slider
        label={tr("Высота")}
        hint={tr("газон — пятнадцать, степь — шестьдесят")}
        value={grass.height}
        {...range("height")}
        unit={tr(" см")}
        onChange={(height) => onGrass({ height })}
      />
      <Slider
        label={tr("Разброс")}
        hint={tr("насколько травинки не похожи друг на друга")}
        value={grass.spread}
        {...range("spread")}
        unit=" %"
        onChange={(spread) => onGrass({ spread })}
      />
      <Slider
        label={tr("Дальность прорисовки")}
        hint={tr("дальше этого круга остаётся голая земля")}
        value={grass.distance}
        {...range("distance")}
        unit={tr(" м")}
        onChange={(distance) => onGrass({ distance })}
      />
    </>
  );
}

function WindPanel({ wind, onWind }) {
  useTr();
  return (
    <>
      <Slider
        label={tr("Сила ветра")}
        hint={tr("насколько далеко заваливается верхушка")}
        value={wind.strength}
        {...range("windStrength")}
        unit=" %"
        onChange={(strength) => onWind({ strength })}
      />
      <Slider
        label={tr("Скорость ветра")}
        hint={tr("сто процентов — штатный ветер игры")}
        value={wind.speed}
        {...range("windSpeed")}
        unit=" %"
        disabled={wind.strength === 0}
        onChange={(speed) => onWind({ speed })}
      />
      {/* Румб, а не «сила по X и по Z»: человек смотрит на поле, а не на оси
          сцены, и проверяет он не число, а куда легла волна. */}
      <Slider
        label={tr("Направление ветра")}
        hint={tr("{dir} — волна идёт по полю от него").replace(
          "{dir}",
          windCompass(wind.direction),
        )}
        value={wind.direction}
        {...range("windDirection")}
        unit="°"
        disabled={wind.strength === 0}
        onChange={(direction) => onWind({ direction })}
      />
      <p className="veg-hint">
        {wind.strength === 0
          ? tr("Ветер выключен — окно перестаёт рисовать кадры и не отнимает их у игры.")
          : tr("Ветер считается в вершинном шейдере: плотность на нём не сказывается.")}
      </p>
    </>
  );
}

export default function VegetationInspector({
  tab,
  name,
  onName,
  onReset,
  cover,
  grass,
  wind,
  assets,
  onCover,
  onGrass,
  onWind,
  installSupported = false,
}) {
  useTr();
  return (
    <div className="veg-inspector-body">
      {/* Имя стоит над вкладками: оно у проекта одно, и именно с ним он ложится
          в файл мастерской. */}
      <div className="veg-inspector-head">
        <label className="veg-name">
          <span>{tr("Название")}</span>
          <input
            value={name}
            maxLength={80}
            onChange={(event) => onName(event.target.value)}
            aria-label={tr("Название растительности")}
          />
        </label>
        {onReset && (
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowCounterClockwise />}
            onClick={onReset}
          >
            {tr("Сбросить раздел")}
          </Button>
        )}
      </div>

      {/*
        Установка стоит первой, но только там, где она настоящая.

        В приложении за кнопкой полный контур: правки ложатся на таблицу
        `plantInfos` из `procedural.meta` САМОГО игрока, наземные записи едут
        множителем от штатных чисел покрова, перед записью снимается backup
        update.rpf. Кнопка гаснет, пока в игру ехать нечему: покров, цвет и
        дальность живут только в окне, и проект, где сдвинуты лишь они,
        «встал» бы молча и не поменял в игре ничего.

        В браузере кнопки нет и не будет: доступа к архивам GTA V у него нет.
      */}
      {/* Кнопка установки живёт в полосе редактора, там же, где «Применить»
          у мини-карты. Здесь остаётся объяснение, почему в браузере её нет. */}
      {!installSupported && (
        <p className="veg-notice" role="note">
          <Info weight="bold" />
          <span>
            {tr("Установка в игру работает в приложении Astral: браузер не имеет доступа к файлам GTA V. Настройка сохраняется в проект мастерской.")}
          </span>
        </p>
      )}

      {/*
        Что в игру не уезжает — сказано там же, где на неё нажимают, а не в
        сноске под кадром: человек читает эту колонку, когда двигает ползунки.
      */}
      <p className="veg-notice is-quiet" role="note">
        <Info weight="bold" />
        <span>
          {tr("В игру уезжают густота, рост, разброс и ветер — множителем ко всей траве карты. Покров, цвет и дальность остаются в окне: покров — это модели внутри архивов, цвет у каждой из 269 записей травы свой, а дальности в игре нет полем — трава гаснет по LOD и качеству травы.")}
        </span>
      </p>

      {tab === "cover" && (
        <CoverPanel
          cover={cover}
          grass={grass}
          assets={assets}
          onCover={onCover}
          onGrass={onGrass}
        />
      )}
      {tab === "grass" && <GrassPanel grass={grass} onGrass={onGrass} />}
      {tab === "wind" && <WindPanel wind={wind} onWind={onWind} />}
    </div>
  );
}
