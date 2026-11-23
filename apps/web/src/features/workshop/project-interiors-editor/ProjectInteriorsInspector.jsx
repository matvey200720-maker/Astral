/*
 * Панель редактора «Интерьеры проектов» — настройки взятого инструмента
 * (мастерская «как в Photoshop»): интерьер, цвет и блеск, шаблоны, источники.
 *
 * Что правится — интерьер, выбранный над кадром. Облик ложится на сам
 * интерьер в одиночной игре: на сервере он остаётся серверным.
 *
 * «Цвет и блеск» (решение владельца 12.10.2026 про интерьеры): у каждой
 * поверхности — «Как в игре» или свой цвет и блеск (как в игре, чистая,
 * глянец, зеркало). Узоров, картинок, «Без текстуры» и уборки вещей нет.
 *
 * Органы — из словаря (`components/ui`): цвет — `ColourEffectField`, выбор
 * — `SegmentedControl`, помещения — `ChoiceRadioGroup`, да/нет — `Switch`.
 *
 * Страницы без абзацев (ТЗ 29.10.2026, вечер; образец — страница вещи «Мастерской арены»): пояснения — по «?» у заголовка раздела
 * (`SectionHeading`) или группы (`ListGroup`), а не текстом под органами; что открыть, добавить или скачать — строками группы
 * (`NavRow`, `ListRow`); убрать, вернуть «как в игре» — карточкой внизу страницы (`ActionRows`), и только когда это можно сделать:
 * погашенных кнопок с оправданием нет. Остались короткие строки состояния («Читаем интерьеры…», ошибки главного процесса).
 */

import { useEffect, useRef, useState } from "react";
import {
  PROJECT_INTERIORS_PRESETS,
  PROJECT_SURFACES,
  PROJECT_SURFACE_LABELS,
  PROJECT_SURFACE_MODES,
  SHOP_SHINES,
  applyProjectInteriorsPreset,
  createProjectInteriors,
  interiorLookIsStock,
  interiorLookOf,
  matchingProjectInteriorsPreset,
  shopShine,
} from "@modovik/climb-contract/recolor/project-interiors";
import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ChoiceRadioGroup from "../../../components/ui/ChoiceRadioGroup.jsx";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Switch from "../../../components/ui/Switch.jsx";
import { ArrowsClockwise, FolderOpen, Plus } from "../../../components/ui/icons.jsx";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import SectionHeading from "../section-help.jsx";
import ShopRoomArt from "../shops-editor/ShopRoomArt.jsx";
import ProjectInteriorsPacks, { packRemoveActions } from "./ProjectInteriorsPacks.jsx";
import { PROJECT_SWATCHES, blockerTexts, completenessText, fill, modelsCountText, projectName, sheetsCountText, surfaceLabel } from "./project-interiors-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* `help` — что нужно знать о разделе: строка или список строк по «?» у заголовка (абзацев под органами нет). */
function Section({ id, title, help = null, children, sectionRef = null, flash = false }) {
  const notes = [].concat(help).filter(Boolean);
  return (
    <section ref={sectionRef} className={`ui-panel fx-section recolor-section${flash ? " is-picked" : ""}`} aria-label={title} data-project-interiors-section={id}>
      {notes.length ? <SectionHeading title={title} help={notes} /> : <h3>{title}</h3>}
      {children}
    </section>
  );
}

/* Строка состояния — «Читаем…», «Выберите интерьер»: не пояснение к органу, а то, что сейчас с экраном. */
function Status({ children }) {
  return (
    <p className="fx-hint" role="status">
      {children}
    </p>
  );
}

/* Откуда кадр: слова про происхождение листов и моделей — по «?» у названия интерьера, а не подписью под кадром. */
const FRAME_ORIGIN = "Модели, листы, прозрачность стёкол, тени-наклейки и палитры — из файлов пака (или вашей папки) и вашей GTA V, как их рисует игра; в облике работы — цвет и блеск стен, пола, потолка и мебели.";

/* Эффекты по развёртке листа — как у зданий: полосе «линия» в метрах на листе нечего мерить. */
const SHEET_EFFECTS = Object.freeze(["solid", "gradient", "rainbow", "shimmer"]);

const SURFACE_HINTS = Object.freeze({
  walls: "Стены интерьера — листами его оболочки.",
  floor: "Пол — листами оболочки интерьера.",
  ceiling: "Потолок — листами оболочки интерьера.",
  furniture: "Мебель и вещи интерьера — листами самих вещей; штатные вещи игры остаются как были.",
});

/* Подсказки эффектов цвета — по «?» раздела поверхности; поле цвета своих подсказок под собой не рисует. */
const EFFECT_HINTS = Object.freeze({
  gradient: "Два цвета плавно переходят друг в друга вдоль выбранного направления.",
  rainbow: "Радуга вдоль направления; сдвиг — с какого цвета она начинается.",
  shimmer: "Оттенки гуляют вокруг цвета, как у перламутра. В игре перелив неподвижный.",
});
const NO_HINTS = Object.freeze({ solid: "", gradient: "", rainbow: "", shimmer: "", line: "" });

/* Подписи из договора — переводом в месте отрисовки (данные модуля собираются на ru). */
const modeOptions = () => PROJECT_SURFACE_MODES.map((mode) => ({ value: mode, label: tr(PROJECT_SURFACE_LABELS[mode]) }));
/* Короткие подписи: четыре сегмента в узкой панели; полное — подсказкой. */
const shineOptions = () => SHOP_SHINES.map((item) => ({ value: item.id, label: tr(item.short), title: tr(item.note) }));

/* Где стоит интерьер на карте — словами. */
const placeText = (unit) => (unit.position ? `${unit.position.join(", ")}` : tr("карты размещения нет"));

/* ------------------------------------------------------------------ *
 * Интерьер
 * ------------------------------------------------------------------ */

function InteriorTool({ side, unit, mlo, onMlo, look, onInstall, onTool, status }) {
  useTr();
  if (!unit) {
    if (status === "loading") return <Status>{tr("Читаем интерьеры…")}</Status>;
    /* Интерьеров нет: куда идти — строкой перехода, а не абзацем (в Astral Desktop без моста источников нет вовсе). */
    return (
      <ListGroup title={tr("Нет интерьеров")} help={tr("Интерьеров пока нет — скачайте пак из каталога Astral или добавьте папку на вкладке «Источники».")} data-project-interiors-section="empty">
        {status !== "web" && onTool && <NavRow icon={<FolderOpen />} title={tr("Источники")} caption={tr("Паки Astral и свои папки")} onOpen={() => onTool("sources")} />}
      </ListGroup>
    );
  }
  const { completeness } = unit;
  const installable = unit.install.offered;
  const installTip = tr("Ставится в одиночную игру как мод. В игре ещё не проверено. Снятие возвращает игру как была.");
  /* Что стоит знать про установку — по «?»: почему интерьер не ставится, какие файлы игры он правит, что на сервере он серверный. */
  const installHelp = [
    installable ? installTip : tr("Этот интерьер не предлагается к установке — только просмотр и покраска в кадре."),
    ...(installable ? [] : blockerTexts(unit)),
    unit.install.overrides.length > 0 ? `${tr("Файлы игры, которые он правит")}: ${unit.install.overrides.join(", ")}${unit.install.overrides.length >= 8 ? "…" : ""}` : "",
    tr("Сам интерьер появляется в одиночной игре. На сервере он остаётся серверным: цвет ложится на него только здесь."),
  ];
  return (
    <>
      <Section id="interior" title={unit.label} help={[tr(FRAME_ORIGIN), tr("Листы кадр берёт из вашей GTA V.")]}>
        <ul className="project-interiors-facts" aria-label={tr("Сведения об интерьере")}>
          <li>
            {tr("Проект")}: <b>{projectName(side)}</b>
          </li>
          {unit.category.length > 0 && (
            <li>
              {tr("Раздел")}: <b>{unit.category.join(" / ")}</b>
            </li>
          )}
          <li>
            {tr("Помещений")}: <b>{unit.mlo.length}</b>
          </li>
          <li>
            {tr("Место на карте")}: <b>{placeText(unit)}</b>
          </li>
          <li>
            {tr("Файлов интерьера")}: <b>{unit.files.models + unit.files.sheets + unit.files.bounds + unit.files.data}</b> · {Math.round(unit.files.bytes / 1048576)} {tr("МБ")}
          </li>
        </ul>
        {unit.mlo.length > 1 && (
          <ChoiceRadioGroup
            label={tr("Помещение интерьера")}
            value={mlo}
            options={unit.mlo.map((item, index) => ({ value: item.hash.toString(16).padStart(8, "0"), title: fill(tr("Помещение {0}"), index + 1), description: fill(tr("комнат: {0}, вещей: {1}"), item.rooms, item.entities) }))}
            onChange={onMlo}
          />
        )}
      </Section>
      <Section id="complete" title={tr("Полнота")}>
        <ul className="project-interiors-facts" aria-label={tr("Полнота")}>
          <li>{completenessText(unit)}</li>
          {completeness.state !== "unknown" && (
            <>
              <li>
                {tr("Вещей в интерьере")}: <b>{completeness.entities}</b>
              </li>
              <li>
                {tr("Штатных, из вашей игры")}: <b>{completeness.vanilla}</b>
              </li>
              <li>
                {tr("Из соседних папок источника")}: <b>{completeness.shared}</b>
              </li>
              {completeness.missingModels > 0 && (
                <li>
                  {tr("Не нашлось")}: <b>{modelsCountText(completeness.missingModels)}</b>
                </li>
              )}
            </>
          )}
        </ul>
      </Section>
      <Section id="install" title={tr("В игру")} help={installHelp}>
        {installable ? (
          <label className="fx-switch" title={installTip}>
            <span>
              <b>{tr("Поставить в игру")}</b>
            </span>
            <Switch checked={look.install} label={tr("Поставить в игру")} onChange={onInstall} />
          </label>
        ) : (
          <ul className="project-interiors-facts" aria-label={tr("В игру")}>
            <li>{tr("Не ставится в игру")}</li>
          </ul>
        )}
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Цвет и блеск
 * ------------------------------------------------------------------ */

function shineHint(surfaceId, shine) {
  const item = shopShine(shine);
  if (item.id === "game") return tr("Блеск и чистота — как в файлах интерьера.");
  if (item.id === "clean") return tr("Пятна, грязь и потёртости листа сглажены, лист чуть светлее — рисунок плитки и досок остаётся.");
  /* Целыми фразами: у пола и поверхности разный род («чистый» — «чистая»). */
  const floor = surfaceId === "floor";
  if (item.id === "gloss") return floor ? tr("Пол чистый и блестит: игра кладёт на него яркий резкий блик.") : tr("Поверхность чистая и блестит: игра кладёт на неё яркий резкий блик.");
  return floor ? tr("Пол как только что вымытый кафель: блик во всю силу, игра отражает в нём зал.") : tr("Поверхность — как только что вымытый кафель: блик во всю силу, игра отражает в ней зал.");
}

function SurfaceSection({ id, settings, sheets, onChange, sectionRef, flash }) {
  useTr();
  const shown = tr(surfaceLabel(id));
  const colour = settings.mode === "colour";
  const effect = normalizeColourEffect(settings.look).mode;
  /* Всё, что раньше стояло абзацами под органами, — по «?» у названия поверхности. */
  const help = [
    tr(SURFACE_HINTS[id]),
    fill(tr("В файлах интерьера: {0}."), sheetsCountText(sheets)),
    colour ? tr("Свой цвет ложится тоном по светотени листа: швы, доски и рельеф остаются.") : "",
    colour && EFFECT_HINTS[effect] ? tr(EFFECT_HINTS[effect]) : "",
    shineHint(id, settings.shine),
  ];
  return (
    <Section id={id} title={shown} help={help} sectionRef={sectionRef} flash={flash}>
      <SegmentedControl label={fill(tr("{0}: цвет"), shown)} size="sm" value={settings.mode} options={modeOptions()} onChange={(mode) => onChange({ mode }, `${surfaceLabel(id)}: ${mode}`)} />
      {colour && (
        <ColourEffectField
          label={tr("Цвет")}
          value={settings.look}
          swatches={PROJECT_SWATCHES}
          modes={SHEET_EFFECTS}
          directionLabels={{ along: tr("Вдоль"), across: tr("Поперёк"), height: tr("Вверх") }}
          hints={NO_HINTS}
          onChange={(look) => onChange({ look }, `${surfaceLabel(id)}: цвет`)}
        />
      )}
      <SegmentedControl label={fill(tr("{0}: блеск"), shown)} className="project-interiors-shine" size="sm" value={settings.shine} options={shineOptions()} onChange={(shine) => onChange({ shine }, `${surfaceLabel(id)}: ${shine}`)} />
    </Section>
  );
}

/*
 * Общий кусок: «Цвет и блеск» берёт и редактор «Интерьеры Majestic RP» (`majestic-interiors-editor/`) — для десяти интерьеров
 * с режимом «цвет» работа у него своя, а поверхности, цвет и блеск те же.
 */
export function SurfacesTool({ work, unit, sceneInfo, focus, onSurface, onSurfacesStandard }) {
  useTr();
  const look = unit ? interiorLookOf(work, unit.id) : null;
  /* Щелчок по стене, полу или мебели в кадре — её раздел подъезжает и подсвечивается. */
  const refs = useRef({});
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    if (!focus?.surface) return undefined;
    refs.current[focus.surface]?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    setFlash(focus.surface);
    const timer = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(timer);
  }, [focus]);
  if (!unit) return <Status>{tr("Выберите интерьер над кадром.")}</Status>;
  if (sceneInfo.state !== "ready") return <Status>{tr("Поверхности появятся, когда соберётся кадр интерьера.")}</Status>;
  const present = PROJECT_SURFACES.filter((surface) => (sceneInfo.surfaces?.[surface.id] || 0) > 0);
  if (!present.length) {
    return <ListGroup plain title={tr("Листов для покраски нет")} help={tr("В файлах этого интерьера нет листов, которые можно перекрасить: оболочка и вещи берут листы у самой игры.")} data-project-interiors-section="no-sheets" />;
  }
  return (
    <>
      {/* Что красится вообще — по «?» над разделами поверхностей. */}
      <ListGroup
        plain
        title={tr("Поверхности")}
        help={tr("Красятся только листы из файлов самого интерьера. Листы штатных вещей игры общие с игрой и остаются как были. В кадре перекрашено ровно то, что перекрасится в игре; блик в кадре — студийный.")}
        data-project-interiors-section="surfaces"
      />
      {present.map((surface) => (
        <SurfaceSection
          key={surface.id}
          id={surface.id}
          settings={look.surfaces[surface.id]}
          sheets={sceneInfo.surfaces[surface.id]}
          sectionRef={(node) => {
            refs.current[surface.id] = node;
          }}
          flash={flash === surface.id}
          onChange={(patch, label) => onSurface(surface.id, patch, label)}
        />
      ))}
      <ActionRows
        label={tr("Как в игре")}
        actions={[!interiorLookIsStock(look) && { id: "standard", label: tr("Как в игре: все поверхности"), onClick: onSurfacesStandard }]}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Шаблоны
 * ------------------------------------------------------------------ */

/* Схема шаблона: у схемы комнаты «мебель» — это стеллажи у дальней стены. */
const artLook = (look) => ({ surfaces: { ...look.surfaces, shelves: look.surfaces.furniture } });

function TemplatesTool({ work, unit, onPreset, onInteriorStandard, onStandard }) {
  useTr();
  if (!unit) return <Status>{tr("Выберите интерьер над кадром.")}</Status>;
  const look = interiorLookOf(work, unit.id);
  const current = matchingProjectInteriorsPreset(work, unit.id);
  return (
    <>
      <PresetShelf title={tr("Готовые облики")} label={tr("Готовые облики интерьера")} className="recolor-presets" collapsible={false}>
        {PROJECT_INTERIORS_PRESETS.map((preset) => (
          <ChoiceTile
            key={preset.id}
            className="recolor-preset shops-preset"
            selected={preset.id === current}
            media={<ShopRoomArt look={artLook(interiorLookOf(applyProjectInteriorsPreset(createProjectInteriors(), unit.id, preset.id), unit.id))} label={fill(tr("Схема шаблона «{0}»"), tr(preset.label))} />}
            title={tr(preset.label)}
            tooltip={tr(preset.description)}
            onClick={() => onPreset(preset)}
          />
        ))}
      </PresetShelf>
      {/* «Как в игре» — внизу карточкой, и только то, что есть что вернуть (пояснение — подсказкой строки). */}
      <ActionRows
        label={tr("Как в игре")}
        actions={[
          !interiorLookIsStock(look) && {
            id: "interior",
            label: tr("Как в игре: этот интерьер"),
            title: tr("Стены, пол, потолок и мебель — цвета и блеск файлов интерьера. Свои цвета панель помнит."),
            onClick: onInteriorStandard,
          },
          Object.keys(work.interiors || {}).length > 0 && { id: "nothing", label: tr("Ничего не ставить"), onClick: onStandard },
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Источники
 * ------------------------------------------------------------------ */

function sourceLine(source, report) {
  const row = (report || []).find((item) => item.id === source.id);
  if (!row) return "";
  if (row.missing) return tr("папка пропала");
  /* Подпись строки в одну строку (длинное — многоточием): то, что требует внимания, стоит первым. */
  const parts = [fill(tr("интерьеров: {0}"), row.units), fill(tr("файлов: {0}"), row.files)];
  if (row.problems) parts.unshift(fill(tr("не прочитано: {0}"), row.problems));
  return parts.join(" · ");
}

function SourcesTool({ side, catalog, packs }) {
  useTr();
  const [message, setMessage] = useState("");
  const run = async (work) => setMessage((await work()) || "");
  /* Пакеты каталога Astral — в своём блоке выше, а не среди папок игрока. */
  const folders = catalog.sources.filter((source) => source.kind !== "astral");
  const nameOf = (source) => (source.kind === "rage-cache" ? `${tr("Кэш RAGE:MP")} · ${source.label}` : source.label);
  const help = [
    side === "majestic"
      ? tr("Если у вас есть свои файлы интерьеров Majestic, укажите папку с ними или со сборкой (например, пакеты dlcpacks) — Astral только читает её. Кэш клиента Majestic (alt:V) зашифрован: интерьеры сервера из него не прочесть.")
      : tr("Если у вас есть свои файлы интерьеров GTA 5 РП, Astral прочтёт папку с ними или кэш клиента RAGE:MP на этом компьютере. Свои папки он только читает."),
    tr("Паки из каталога Astral скачиваются на этот компьютер и остаются у вас; свои папки Astral только читает и никуда не отправляет. Интерьер ставится в игру только по вашей кнопке; снятие возвращает игру как была."),
  ];
  /* Убрать пак или свою папку — внизу страницы, красным; пока идёт чтение, строк нет. */
  const removals = [
    ...packRemoveActions(packs),
    ...(catalog.busy ? [] : folders.map((source) => ({ id: `source-${source.id}`, label: fill(tr("Убрать папку «{0}»"), nameOf(source)), danger: true, onClick: () => run(() => catalog.remove(source.id)) }))),
  ];
  return (
    <>
      <ProjectInteriorsPacks packs={packs} />
      <ListGroup title={tr("Свои папки")} help={help} data-project-interiors-section="sources">
        {/* Папка — запись списка (что в ней найдено); убрать её — внизу страницы. */}
        {folders.map((source) => (
          <ListRow key={source.id} icon={<FolderOpen />} title={nameOf(source)} caption={sourceLine(source, catalog.report) || source.path} data-source={source.id} />
        ))}
        <NavRow icon={<Plus />} title={tr("Добавить папку…")} disabled={catalog.busy} onOpen={() => run(() => catalog.add())} />
        {catalog.sources.length > 0 && <NavRow icon={<ArrowsClockwise />} title={tr("Обновить список")} disabled={catalog.busy} onOpen={catalog.rescan} />}
        {catalog.candidates.map((candidate) => (
          <NavRow key={candidate.id} icon={<Plus />} title={fill(tr("Добавить найденный кэш RAGE:MP: {0}"), candidate.label)} disabled={catalog.busy} onOpen={() => run(() => catalog.add(candidate.id))} />
        ))}
      </ListGroup>
      {message && (
        <p className="fx-hint" role="alert">
          {message}
        </p>
      )}
      {catalog.status === "failed" && (
        <p className="fx-hint" role="alert">
          {catalog.message}
        </p>
      )}
      <ActionRows label={tr("Убрать")} actions={removals} />
    </>
  );
}

export default function ProjectInteriorsInspector({
  tool,
  work,
  side,
  unit,
  mlo,
  sceneInfo,
  catalog,
  packs,
  focus = null,
  onMlo,
  onInstall,
  onSurface,
  onSurfacesStandard,
  onPreset,
  onInteriorStandard,
  onStandard,
  onTool = null,
}) {
  if (tool === "sources") return <SourcesTool side={side} catalog={catalog} packs={packs} />;
  if (tool === "surfaces") return <SurfacesTool work={work} unit={unit} sceneInfo={sceneInfo} focus={focus} onSurface={onSurface} onSurfacesStandard={onSurfacesStandard} />;
  if (tool === "templates") return <TemplatesTool work={work} unit={unit} onPreset={onPreset} onInteriorStandard={onInteriorStandard} onStandard={onStandard} />;
  return <InteriorTool side={side} unit={unit} mlo={mlo} onMlo={onMlo} look={unit ? interiorLookOf(work, unit.id) : null} onInstall={onInstall} onTool={onTool} status={catalog.current ? catalog.status : "loading"} />;
}
