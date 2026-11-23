/*
 * Панель маппинга — настройки взятого инструмента (мастерская «как в
 * Photoshop»): облик места в кадре — как в игре (по умолчанию: штатные
 * здания, ТЗ 10.10.2026), как в моде или свой цвет с яркостью, «так же у
 * всех мест»; список всех мест мода (нажал место — кадр показывает его),
 * эмблема или готовые виды. С ТЗ 22.10.2026 «Облик» — всё это разом: готовые
 * виды → места → цвет выбранного места.
 *
 * Органы — из словаря (`components/ui`): облик — строки выбора (`choice-rows.jsx`), цвет —
 * `ColorField`; ползунка яркости нет (п. 11). Раздел — `ui-panel fx-section`, строки
 * списка — общие строки редакторов перекраски.
 */

import {
  MAPPING_EMBLEM_SIZE,
  MAPPING_FINISH_MODES,
  MAPPING_LOCATIONS,
  findMappingLocation,
  mappingDefaultDecal,
} from "@modovik/climb-contract/recolor/mapping";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import ListGroup, { ListSwatch } from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import Select from "../../../components/ui/Select.jsx";
import ChoiceRows from "../choice-rows.jsx";
import EmblemSection from "../emblem/EmblemSection.jsx";
import FinishField from "../finish/FinishField.jsx";
import SectionHeading from "../section-help.jsx";
import MappingPresets from "./MappingPresets.jsx";
import {
  MAPPING_EMBLEM_OPTIONS,
  MAPPING_SWATCHES,
  mappingFinishOptions,
  mappingLocationColour,
  mappingModeLabel,
  mappingModeOptions,
} from "./mapping-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

/*
 * Что значит облик у места — одной строкой под выбором. Парковка (ТЗ
 * 17.10.2026): своё красит штатную парковку игры — цвет или отделка (узор,
 * картинка, градиент) на бетон, штукатурку и стены; асфальт, разметка,
 * полосы и вывески — как в игре; издалека красится вместе с ней; модель
 * сервера 5RP — шаблоном.
 */
function modeHint(location, mode) {
  if (location.stockEdit) {
    if (mode === "stock")
      return tr("Штатная парковка вашей игры, как без модов: Astral её не трогает. Выберите цвет или отделку — перекрасятся её стены; модель сервера 5RP — в «Шаблонах».");
    if (mode === "colour")
      return tr("Бетон, штукатурка и стены штатной парковки — вашим цветом по светотени листа; асфальт, разметка, полосы и вывески — как в игре. Издалека парковка красится вместе с ней.");
    if (mode === "pattern")
      return tr("Узор — на бетон, штукатурку и стены штатной парковки, детали листа остаются; асфальт, разметка, полосы и вывески — как в игре. Издалека парковка берёт средний цвет узора.");
    if (mode === "image")
      return tr("Своя картинка — на бетон, штукатурку и стены штатной парковки; асфальт, разметка, полосы и вывески — как в игре. Издалека парковка берёт средний цвет картинки.");
    if (mode === "gradient")
      return tr("Градиент — на бетон, штукатурку и стены штатной парковки, по листу; асфальт, разметка, полосы и вывески — как в игре. Издалека парковка берёт средний цвет градиента.");
    return tr("Модель парковки сервера 5RP из шаблона: её ставит сервер, в одиночной игре на этом месте остаётся штатная парковка. Вернуть штатную — «Как в игре».");
  }
  if (mode === "stock")
    return location.stockScene
      ? tr("Здания как в игре. Выберите модели мода или свой цвет.")
      : tr("В одиночной игре этого места нет — его ставит сервер своей моделью, Astral её не трогает.");
  if (mode === "mod") return tr("Серые модели автора мода, как он их сделал.");
  return "";
}

/* Что это за место — для «?» у его имени: описание и район из описи мест, на языке окна (в подсказке их не переведёт сама страница). */
const placeAbout = (location) => `${tr(location.description)}${location.districtLabel ? ` ${tr(location.districtLabel)}.` : ""}`;

/*
 * Место со штатными моделями игры (парковка): облик — общая отделка
 * (`FinishField`: как в игре, свой цвет, узор, картинка, градиент), как у
 * завода; цвет и яркость — под «Свой цвет».
 */
function StockLocationSection({ location, settings, onLocation, onNotice }) {
  useTr();
  const hints = Object.fromEntries(["stock", "mod", "colour", ...MAPPING_FINISH_MODES].map((mode) => [mode, modeHint(location, mode)]));
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={`Место «${location.title}»`}>
      {/* Что это за место — по «?» у его имени (ТЗ 29.10.2026, вечер: абзацев под органами нет). */}
      <SectionHeading title={trFill("Облик места: {0}", tr(location.title))} help={placeAbout(location)} />
      <FinishField
        label={location.title}
        settings={settings}
        modes={mappingFinishOptions(settings.mode)}
        swatches={MAPPING_SWATCHES}
        hints={hints}
        surface="sheet"
        rows
        base="stock"
        studio={{
          id: `mapping:${location.id}`,
          title: `${tr("Места")} · ${location.title}`,
          /* Основа — лист игры у стен штатного места; живой вид — кадр места (вкладка та же) с отделкой из студии. */
          scene: location.stockScene,
          match: (info) => info.group === location.id && info.texture != null,
          path: ["locations", location.id],
        }}
        onNotice={onNotice}
        onChange={(patch, text) => onLocation(location.id, patch, text)}
      >
        {settings.mode === "colour" && (
          <ColorField
            label={tr("Цвет")}
            value={settings.colour}
            swatches={MAPPING_SWATCHES}
            editable
            onChange={(colour) => onLocation(location.id, { colour }, `${location.title}: цвет`)}
          />
        )}
      </FinishField>
    </section>
  );
}

function LocationSection({ location, settings, onLocation, onNotice }) {
  useTr();
  if (location.stockEdit) return <StockLocationSection location={location} settings={settings} onLocation={onLocation} onNotice={onNotice} />;
  const own = settings.mode === "colour";
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={`Место «${location.title}»`}>
      {/* Облик места — три настоящих варианта (здания игры, модели мода, свой цвет), взятый отмечен галкой. Строками, а не сегментом (п. 13
          `design-qa.md`): «Comme dans le jeu · Modèles du mod · Couleur personnalisée» в ряд не вставали. Имя группы говорит, что
          выбирают и где («Облик места: Ферма», критик 31.10.2026), что за место — «?» у него. */}
      <ChoiceRows
        title={trFill("Облик места: {0}", tr(location.title))}
        help={[placeAbout(location), modeHint(location, settings.mode)]}
        label={`Облик места: ${location.title}`}
        /* Свой цвет — со «×» у взятой строки: место снова как в игре (своё — всегда с «×», п. 21). */
        options={mappingModeOptions(location, settings.mode).map((item) =>
          item.value === "colour" ? { ...item, onClear: () => onLocation(location.id, { mode: "stock" }, `${location.title}: ${mappingModeLabel("stock")}`), clearLabel: tr("Как в игре") } : item,
        )}
        value={settings.mode}
        onChange={(mode) => onLocation(location.id, { mode }, `${location.title}: ${mappingModeLabel(mode)}`)}
      />
      {/* Цвет — сразу под строками и только у «Свой цвет», как в поле отделки (критик 30.10.2026, третий круг). */}
      {own && (
        <ColorField
          label={tr("Цвет")}
          value={settings.colour}
          swatches={MAPPING_SWATCHES}
          editable
          onChange={(colour) => onLocation(location.id, { colour }, `${location.title}: цвет`)}
        />
      )}
    </section>
  );
}

/*
 * Нижние строки места (`ActionRows`, пп. 4 и 10 `design-qa.md`): «Этот облик — всем местам» и «Вернуть яркость как в игре». Узор, картинка
 * и градиент красят только штатную парковку — у них строки «всем местам» нет. «Как в игре» у обычного места — сам вариант облика выше, у
 * парковки — строка поля отделки. Ползунка яркости нет (п. 11, владелец: «везде»): значение из шаблона остаётся, вернуть его — строкой.
 */
function CopyAllRows({ location, settings, onLocation, onCopyAll }) {
  useTr();
  const own = settings.mode !== "stock";
  return (
    <ActionRows
      label={tr("Действия с местом")}
      actions={[
        /* Своё (свой цвет, отделка) — назад к игре строкой внизу, как у остальных мест (своё — всегда с «×», п. 21). */
        own && settings.mode !== "mod" && { id: "stock", label: tr("Вернуть как в игре"), onClick: () => onLocation(location.id, { mode: "stock" }, `${location.title}: как в игре`) },
        settings.mode === "colour" && settings.brightness !== 100 && { id: "brightness", label: tr("Вернуть яркость как в игре"), onClick: () => onLocation(location.id, { brightness: 100 }, `${location.title}: яркость как в игре`) },
        own && !(location.stockEdit && MAPPING_FINISH_MODES.includes(settings.mode)) && { id: "copy-all", label: tr("Этот облик — всем местам"), title: tr("Поставить облик этого места остальным местам мода"), onClick: () => onCopyAll(location.id) },
      ]}
    />
  );
}

/*
 * Места мода — строками группы (п. 3 `design-qa.md`): имя, что стоит сейчас, справа — кружок цвета места. Щелчок выбирает место, кадр
 * показывает его.
 */
/* Подпись строки — с прописной, как у строк остальных групп («Как в игре»); в шагах истории облик места строчный. */
const capital = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

function LocationsSection({ project, locationId, onSelect }) {
  useTr();
  return (
    /* Новое место добавляется описанием в scripts/lib/mapping-locations.mjs. */
    <ListGroup title={tr("Места мода")} label={tr("Места")} help={tr("Нажмите место, чтобы увидеть его в кадре и перекрасить.")}>
      {MAPPING_LOCATIONS.map((location) => (
        <NavRow
          key={location.id}
          className={location.id === locationId ? "is-selected" : ""}
          aria-pressed={location.id === locationId}
          title={location.title}
          caption={(project.locations[location.id]?.mode || "stock") === "stock" ? null : capital(mappingModeLabel(project.locations[location.id]?.mode))}
          /* Кружок цвета — только у места со своим цветом: у штатного бежевый кружок ничего не говорил. */
          {...(project.locations[location.id]?.mode === "colour" ? { trailing: <ListSwatch colour={mappingLocationColour(project, location.id)} /> } : {})}
          data-mapping-location={location.id}
          onOpen={() => onSelect(location.id)}
        />
      ))}
    </ListGroup>
  );
}

export default function MappingInspector({
  tool = "look",
  project,
  locationId,
  onSelect,
  onLocation,
  onCopyAll,
  emblems = null,
  onPreset = null,
  onNotice = null,
}) {
  useTr();
  const location = findMappingLocation(locationId) || MAPPING_LOCATIONS[0];
  /* Место эмблемы сменили — она встаёт на место по умолчанию у нового места,
     и кадр показывает его. */
  const moveTo = (id) => {
    emblems?.patch({ location: id, ...mappingDefaultDecal(id), angle: 0 }, "Эмблема: другое место");
    onSelect(id);
  };
  /* «Облик»: места, потом облик выбранного места. «Шаблоны» — своей вкладкой (п. 20 `design-qa.md`): плитки — 3D-снимки сцен, и снимаются они, только когда вкладку открыли. */
  if (tool === "templates") return <div className="fx-inspector recolor-inspector">{onPreset && <MappingPresets project={project} onApply={onPreset} />}</div>;
  if (tool !== "emblem" && tool !== "text")
    return (
      <div className="fx-inspector recolor-inspector">
        <LocationsSection project={project} locationId={location?.id} onSelect={onSelect} />
        {location && (
          <>
            <LocationSection location={location} settings={project.locations[location.id]} onLocation={onLocation} onNotice={onNotice} />
            <CopyAllRows location={location} settings={project.locations[location.id]} onLocation={onLocation} onCopyAll={onCopyAll} />
          </>
        )}
      </div>
    );
  return (
    <div className="fx-inspector recolor-inspector">
      {emblems && MAPPING_EMBLEM_OPTIONS.length > 0 && (
        <EmblemSection
          edit={emblems}
          kind={tool === "text" ? "text" : "image"}
          sizeRange={MAPPING_EMBLEM_SIZE}
          resetLabel={tr("На место по умолчанию")}
          onReset={(item) => emblems.patch({ ...mappingDefaultDecal(item.location), angle: 0 }, "Эмблема: место по умолчанию")}
          intro={
            tool === "text"
              ? tr("Надписи — сколько нужно, каждая со своими словами, шрифтом (можно свой файл шрифта), высотой букв, цветом и прозрачностью. Можно поставить на ферму, базу байкеров или самолёт — на стену, крышу или землю: в игре она встанет плашкой на то же место.")
              : tr("Свои картинки — сколько нужно, каждая на своё место.")
          }
          note={
            tool === "text"
              ? tr("Надпись стоит прямо, как её видят перед поверхностью, с вашим поворотом; ширина — по словам. Надписи едут в код для друга словами.")
              : tr("Эмблема стоит прямо, как её видят перед поверхностью, с вашим поворотом; ширина — по пропорциям. Картинки остаются на этом компьютере: в код для друга они не едут.")
          }
          extra={(item) => <Select label={item.kind === "text" ? tr("Место надписи") : tr("Место эмблемы")} value={item.location} options={MAPPING_EMBLEM_OPTIONS} onChange={moveTo} />}
          onNotice={onNotice}
        />
      )}
    </div>
  );
}
