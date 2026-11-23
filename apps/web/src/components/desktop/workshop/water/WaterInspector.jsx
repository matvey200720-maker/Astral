/*
 * Правая колонка редактора воды.
 *
 * Три разговора вместо одной простыни ползунков: какая идёт волна, из чего
 * состоит толща под ней и как эта вода отвечает свету. Человек приходит сюда с
 * одной задачей — «поднять волну», «сделать воду прозрачнее», «убрать блик», —
 * и остальные два раздела в этот момент только мешают искать.
 *
 * Разделение здесь не на глаз, а по адресу правки. «Волна» — это целиком
 * `water.xml`: амплитуда, направление, гашение и уровень квадов. «Оптика» — это
 * целиком модификатор таймцикла, и его настоящие имена показаны прямо в
 * колонке. «Толща» — это то, что не уезжает никуда: цвет каждого водоёма игра
 * держит в `waterheight.dat`, парсера которого в вебе нет. Три вкладки — три
 * разных ответа на вопрос «а что из этого попадёт в игру», и склеивать их в
 * одну простыню значило бы стереть эту разницу.
 *
 * Величины подписаны так, как их зовут в файлах игры: `Amplitude` — числом, а
 * не процентом «силы волны», уровень — метрами, потому что мод «поднять воду»
 * правит метры. Проценты остались там, где процент и есть смысл: множители
 * таймцикла, прозрачность и ширина пены.
 */

import { ArrowCounterClockwise, FileCode, Info } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Slider from "../../../ui/Slider.jsx";
import {
  WATER_PRESETS,
  WATER_RANGES,
  presetById,
  waterTimecycleFields,
  waveCompass,
  windScale,
} from "./water-model.js";
import ColorField from "../../../ui/ColorField.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

const range = (key) => WATER_RANGES[key];


/*
 * То же поле, но без `label` снаружи.
 *
 * Кнопка — тоже размечаемый элемент, и щелчок по кнопке внутри `label` браузер
 * пересылает обратно первой кнопке группы: переключатель срабатывает дважды и
 * ведёт себя как заедающий. Поэтому всё, что внутри не `input`, живёт в
 * обычном блоке с той же сеткой.
 */
function Row({ label, hint, children }) {
  return (
    <div className="ui-field water-field">
      <span className="water-field-copy">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </div>
  );
}

/* Выбор цвета общий (`ui/ColorField`): подпись, образец, hex — как везде. */
function Colour({ label, hint, value, onChange }) {
  return (
    <ColorField
      className="water-colour"
      label={label}
      hint={hint}
      value={value}
      onChange={onChange}
    />
  );
}

/*
 * Волна.
 *
 * Пресет стоит первым и не является «краской»: он раскладывается в конкретные
 * поля квадов, и бассейн отличается от океана не цветом, а нулевой амплитудой,
 * полным гашением и близким дном. Поэтому он и живёт в этой вкладке, а не над
 * вкладками: человек выбирает состояние воды, а дальше правит его теми же
 * числами, что лежат в `water.xml`.
 */
function WavePanel({ presetId, surface, onPreset, onSurface }) {
  useTr();
  const chosen = presetById(presetId);
  const wind = Math.round(windScale({ surface }) * 100);
  const still = surface.amplitude === 0;

  return (
    <>
      <SegmentedControl
        className="water-presets"
        label={tr("Состояние воды")}
        size="sm"
        value={presetId}
        onChange={onPreset}
        options={WATER_PRESETS.map((entry) => ({
          value: entry.id,
          label: tr(entry.label),
          title: tr(entry.hint),
        }))}
      />
      <p className="water-hint">{tr(chosen.hint)}</p>

      {/* Одна ручка на весь ветер. Крутизна волны, шероховатость блика,
          плотность пены на гребнях и скорость бега волн — это одно и то же
          явление, и четыре ползунка под него позволили бы собрать невозможную
          воду: зеркальную гладь с рваной дорожкой солнца. */}
      <Slider
        label={tr("Амплитуда волны")}
        hint={tr("Amplitude в water.xml · ветер {wind} %").replace(
          "{wind}",
          wind,
        )}
        value={surface.amplitude}
        {...range("amplitude")}
        onChange={(amplitude) => onSurface({ amplitude })}
      />
      {/* Румб, а не «X и Y»: в файле лежит нормализованный вектор, но человек
          смотрит на залив, а не на оси, и проверяет он не число, а куда легла
          волна. Пересчёт в XDirection/YDirection — дело модели. */}
      <Slider
        label={tr("Направление волны")}
        hint={tr("волна идёт на {dir}").replace(
          "{dir}",
          waveCompass(surface.direction),
        )}
        value={surface.direction}
        {...range("direction")}
        unit="°"
        disabled={still}
        onChange={(direction) => onSurface({ direction })}
      />
      <Slider
        label={tr("Гашение")}
        hint={tr("fDampening калмингквада: единица — полный штиль в бухте")}
        value={surface.dampening}
        {...range("dampening")}
        disabled={still}
        onChange={(dampening) => onSurface({ dampening })}
      />
      <Slider
        label={tr("Уровень воды")}
        hint={tr("WaterQuad.z: ноль — ванильный океан")}
        value={surface.level}
        {...range("level")}
        unit={tr(" м")}
        onChange={(level) => onSurface({ level })}
      />

      <p className="water-hint">
        {still
          ? tr("Штиль по-настоящему неподвижен: окно перестаёт просить кадры и не отнимает их у игры.")
          : tr("Эти четыре числа и есть правка water.xml — границы квадов не трогаются.")}
      </p>
    </>
  );
}

/*
 * Толща.
 *
 * Единственная вкладка, из которой в игру не уезжает ничего, и это сказано в
 * ней вслух, а не спрятано в общую плашку наверху. Молчать здесь опаснее
 * всего: цвет воды — первое, что человек идёт править, и именно его игра
 * держит там, куда редактор не дотягивается.
 */
function BodyPanel({ body, shore, onBody, onShore }) {
  useTr();
  return (
    <>
      <Colour
        label={tr("Цвет мелководья")}
        hint={tr("бирюза отмели: тон, а не яркость")}
        value={body.shallow}
        onChange={(shallow) => onBody({ shallow })}
      />
      <Colour
        label={tr("Цвет глубины")}
        hint={tr("куда уходит вода за отмелью")}
        value={body.deep}
        onChange={(deep) => onBody({ deep })}
      />
      <Slider
        label={tr("Прозрачность")}
        hint={tr("сто — видно дно, ноль — непроглядная толща")}
        value={body.clarity}
        {...range("clarity")}
        unit=" %"
        onChange={(clarity) => onBody({ clarity })}
      />
      <Slider
        label={tr("Ширина пены")}
        hint={tr("полоса прибоя у кромки берега")}
        value={body.foamWidth}
        {...range("foamWidth")}
        unit=" %"
        onChange={(foamWidth) => onBody({ foamWidth })}
      />
      <Slider
        label={tr("Уклон дна")}
        hint={tr("круче — отмель короче и бирюзы меньше")}
        value={shore.slope}
        {...range("slope")}
        unit=" %"
        onChange={(slope) => onShore({ slope })}
      />

      <p className="water-hint">
        {tr("Толща живёт только в этом окне. Цвет каждого водоёма игра держит в waterheight.dat — двоичной карте на 342 персональных цвета, читать которую редактор не умеет. В water.xml цвета нет вовсе.")}
      </p>
    </>
  );
}

/*
 * Оптика.
 *
 * Имена параметров показаны настоящими и со значениями, которые уедут в файл.
 * Причина простая: модификатор таймцикла с выдуманным полем игра принимает
 * молча и молча же игнорирует — мод выходит пустышкой, и понять это по
 * картинке нельзя. Сверять здесь есть что, поэтому и показано.
 */
function OpticsPanel({ optics, onOptics }) {
  useTr();
  const fields = waterTimecycleFields({ optics });
  return (
    <>
      <Row label={tr("Отражение")} hint={tr("water_reflection: второй проход по сцене")}>
        <SegmentedControl
          label={tr("Отражение")}
          size="sm"
          value={optics.reflection ? "on" : "off"}
          onChange={(value) => onOptics({ reflection: value === "on" })}
          options={[
            { value: "on", label: tr("Есть") },
            { value: "off", label: tr("Нет") },
          ]}
        />
      </Row>
      {/* Сто процентов — «как в игре»: множители таймцикла это единицы, и
          ползунок на сотне не правит ничего. Так и подписано, иначе сотня
          читается как «на полную», а нулём кажется штатное состояние. */}
      <Slider
        label={tr("Блик солнца")}
        hint={tr("water_specular_intensity · сто процентов — как в игре")}
        value={optics.specular}
        {...range("specular")}
        unit=" %"
        onChange={(specular) => onOptics({ specular })}
      />
      <Slider
        label={tr("Пена")}
        hint={tr("water_foam_intensity_mult · плотность белого на гребнях")}
        value={optics.foam}
        {...range("foam")}
        unit=" %"
        onChange={(foam) => onOptics({ foam })}
      />
      <Slider
        label={tr("Высыхание")}
        hint={tr("water_drying_speed_mult · как быстро сохнет мокрое")}
        value={optics.drying}
        {...range("drying")}
        unit=" %"
        onChange={(drying) => onOptics({ drying })}
      />

      <ul className="water-fields" aria-label={tr("Параметры таймцикла")}>
        {fields.map(([field, value]) => (
          <li key={field}>
            <span>{field}</span>
            <b>{value.toFixed(2)}</b>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function WaterInspector({
  tab,
  name,
  onName,
  onReset,
  presetId,
  surface,
  body,
  shore,
  optics,
  onPreset,
  onSurface,
  onBody,
  onShore,
  onOptics,
  onWaterXml,
  onTimecycleXml,
  installSupported = false,
}) {
  useTr();
  return (
    <div className="water-inspector-body">
      {/* Имя стоит над вкладками: оно у проекта одно, и именно с ним он ложится
          в файл мастерской. */}
      <div className="water-inspector-head">
        <label className="water-name">
          <span>{tr("Название")}</span>
          <input
            value={name}
            maxLength={80}
            onChange={(event) => onName(event.target.value)}
            aria-label={tr("Название воды")}
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

        В приложении за кнопкой полный контур: правки ложатся на файлы самого
        игрока, каждый квад сверяется до записи, перед записью снимается backup
        update.rpf. Кнопка гаснет, пока в игру ехать нечему: «Толща» живёт
        только в окне, и установка проекта, где сдвинута лишь она, «встала» бы
        молча и не поменяла в игре ничего.

        В браузере кнопки нет и не будет — есть честная плашка и два файла,
        которые можно унести и положить руками. Кнопка «Установить», которая
        ничего не делает, хуже её отсутствия: по ней судят, что мод встал.
      */}
      {/* Кнопка установки живёт в полосе редактора, рядом с «Отменой», — там
          же, где «Применить» у мини-карты. Здесь остаётся объяснение, почему
          в браузере её нет вовсе. */}
      {!installSupported && (
        <p className="water-notice" role="note">
          <Info weight="bold" />
          <span>
            {tr("Установка в игру работает в приложении Astral: браузер не имеет доступа к файлам GTA V. Здесь можно забрать оба файла ниже и положить их руками — настройка при этом остаётся в проекте мастерской.")}
          </span>
        </p>
      )}

      <div className="water-files">
        <Button
          variant="ghost"
          size="sm"
          icon={<FileCode />}
          onClick={onWaterXml}
        >
          {tr("Забрать water.xml")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<FileCode />}
          onClick={onTimecycleXml}
        >
          {tr("Забрать таймцикл")}
        </Button>
      </div>

      {tab === "wave" && (
        <WavePanel
          presetId={presetId}
          surface={surface}
          onPreset={onPreset}
          onSurface={onSurface}
        />
      )}
      {tab === "body" && (
        <BodyPanel
          body={body}
          shore={shore}
          onBody={onBody}
          onShore={onShore}
        />
      )}
      {tab === "optics" && <OpticsPanel optics={optics} onOptics={onOptics} />}
    </div>
  );
}
