import { memo, useMemo } from "react";
import { Check, Stack, X } from "../../../ui/icons.jsx";
import {
  MARKUP_SERVERS,
  MARKUP_TEMPLATES,
  applyMarkupTemplate,
  buildMapScene,
  currentMarkupTemplate,
  markupGroups,
  markupKeptGroups,
  normalizeWorldMap,
  setMapGroupVisible,
} from "@modovik/vector-map";
import Button from "../../../ui/Button.jsx";
import MapScenePicture from "./MapScenePicture.jsx";
import { LookPicture, currentLook, lookTitle } from "./MapLooks.jsx";
import MapSetRow from "./MapSetRow.jsx";
import { PanelSection } from "./MapPanelParts.jsx";
import useBaseLayers, { OVERLAY_LAYERS } from "./useBaseLayers.js";
import useProgressive from "./useProgressive.js";
import { VIEWS, denseFrame } from "./set-frames.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { mapText, setTitle } from "./map-copy.js";

/*
 * Панель «Шаблоны» (просьба пользователя 06.10): готовая разметка карты под
 * сервер — Majestic RP, GTA 5 RP — с территориями, кругами, точками и
 * подписями мест, как их зовут игроки. Шаблон — не другой цвет карты: вид
 * карты (атлас, чёрная, спутник) выбран в «Карте», и шаблон ложится поверх
 * него. Поэтому вверху стоит текущий вид со «Сменить», а карточка шаблона
 * показывает разметку на карте самого человека — той же подложкой, что в
 * кадре: выбрал атлас — видно, как шаблон ляжет на атлас.
 *
 * Стоящий шаблон — строками его наборов с глазом: территории, капты,
 * круги можно спрятать по одному, не снимая шаблон. Тонкая правка зон и
 * подписей — инструментами «Подписи» и «Зоны», как у любых наборов.
 *
 * Карточка шаблона — переключатель: щелчок по стоящему шаблону снимает его.
 * «Снять» в строке стоящего шаблона остаётся — им снимают, не ища карточку.
 */

/* Какой кусок карты показывает карточка: город, весь штат или (`dense`, 13.10)
   то место, где подписей шаблона гуще всего: подписи паков стоят в метрах
   карты, и на всём штате их не прочесть. */

/* Шаблон на чистой карте человека: его подложка и цвета, без его объектов. */
function sampleConfig(look, id, names) {
  const empty = normalizeWorldMap({
    ...look,
    markup: "",
    zones: { ...look.zones, hiddenGroups: [], items: [] },
    markers: { ...look.markers, hiddenGroups: [], items: [] },
  });
  return applyMarkupTemplate(empty, id, { names });
}

/*
 * Разметка карточек помнится между открытиями вкладки: панель монтируется
 * заново с каждым взятием инструмента, а разметка шаблона на той же карте
 * от этого не меняется. Ключ — вид подписей карты, шаблон, атлас и имена
 * районов (по ссылке: они приходят из игры один раз за окно).
 */
const OVERLAYS = new Map();
const OVERLAYS_LIMIT = 36;
const NAME_IDS = new WeakMap();
const namesId = (names) => {
  if (!names) return "";
  if (!NAME_IDS.has(names)) NAME_IDS.set(names, String(NAME_IDS.size + 1 + Math.random()));
  return NAME_IDS.get(names);
};

function overlayFor(look, lookKey, markupId, names, atlas) {
  const key = `${lookKey}|${markupId}|${JSON.stringify(atlas)}|${namesId(names)}`;
  let overlay = OVERLAYS.get(key);
  if (!overlay) {
    const sample = buildMapScene(sampleConfig(look, markupId, names), { atlas });
    overlay = { ...sample, layers: sample.layers.filter((layer) => OVERLAY_LAYERS.has(layer.id)) };
    OVERLAYS.set(key, overlay);
    if (OVERLAYS.size > OVERLAYS_LIMIT) OVERLAYS.delete(OVERLAYS.keys().next().value);
  }
  return overlay;
}

const TemplatePreview = memo(function TemplatePreview({ baseLayers, look, lookKey, markup, names, atlas, backdrop }) {
  /*
   * Разметка шаблона считается один раз на вид подписей карты — это сотни
   * подписей и зон. Подложка подставляется отдельно и дёшево: живой растр
   * подложки пересобирается фоном и приходит новой ссылкой, и пересчитывать
   * из-за него шаблон незачем; примитивы разметки те же — их не рисуют
   * заново (`MapScene`).
   */
  const overlay = useMemo(
    () => overlayFor(look, lookKey, markup.id, names, atlas),
    [look, lookKey, markup.id, names, atlas],
  );
  const scene = useMemo(
    () => ({ ...overlay, layers: [...baseLayers, ...overlay.layers] }),
    [overlay, baseLayers],
  );
  const dense = useMemo(
    () =>
      markup.view === "dense"
        ? denseFrame(overlay.layers.filter((layer) => layer.id === "marker-labels"), overlay)
        : null,
    [markup.view, overlay],
  );
  const rect = VIEWS[markup.view] || VIEWS.city;
  const frame =
    dense || {
      x: rect.u * scene.width,
      y: rect.v * scene.height,
      width: rect.width * scene.width,
      height: rect.height * scene.height,
    };
  /* Картинкой, а не разметкой (21.10): `MapScenePicture.jsx`. */
  return <MapScenePicture scene={scene} frame={frame} backdrop={backdrop} />;
});

export default function MapTemplatesPanel({
  config,
  /* Сцена кадра: её подложка — подложка карточек. */
  scene,
  atlas,
  backdrop = "",
  /* Имена районов из игры игрока (`{ код зоны: имя }`). */
  names = null,
  thumbs = {},
  onConfig,
  onOpenLook = null,
  /* Строка статуса редактора: что смена шаблона сохранила. */
  onNotice = null,
  memoryId = "",
}) {
  useTr();
  const current = currentMarkupTemplate(config);
  const server = MARKUP_SERVERS.find((item) => item.id === current?.server);
  const mapLook = currentLook(config);
  const baseLayers = useBaseLayers(scene);
  /*
   * Карточкам от карты нужны подложка и цвета подписей — не её объекты:
   * правка зоны или новая надпись не пересчитывают девять миниатюр. Ключ —
   * по содержимому: нормализация собирает подложку новым объектом на каждую
   * правку, и по ссылке миниатюры пересчитывались бы всё равно.
   */
  const lookKey = JSON.stringify([
    config.base,
    config.template,
    config.markers.labelColor,
    config.markers.labelOutlineColor,
    config.zones.labelColor,
  ]);
  const look = useMemo(
    () => normalizeWorldMap({ ...config, zones: { ...config.zones, items: [] }, markers: { ...config.markers, items: [] } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- подложка и цвета подписей по содержимому, не предметы
    [lookKey],
  );

  /*
   * Карточка — переключатель, как карточки наборов в «Зонах» и «Подписях»:
   * щелчок по стоящему шаблону снимает его, по другому — ставит. Так один и
   * тот же щелчок и включает, и выключает, и не нужно искать «Снять».
   */
  /*
   * Смена и снятие шаблона не теряют работу (11.10): набор, который человек
   * правил, прячется, а не уходит, — и строка статуса говорит об этом вслух.
   */
  const tellKept = (id) => {
    const kept = markupKeptGroups(config, id, { names });
    if (!kept.length) return;
    const titles = kept.map((group) => `«${setTitle(group.title)}»`).join(", ");
    onNotice?.(
      mapText(
        kept.length > 1
          ? "Ваши правки в {titles} сохранены: наборы спрятаны и вернутся с шаблоном"
          : "Ваши правки в {titles} сохранены: набор спрятан и вернётся с шаблоном",
        { titles },
      ),
    );
  };
  const choose = (markup) => {
    if (current?.id === markup.id) {
      tellKept("");
      onConfig(applyMarkupTemplate(config, "", { names }), mapText("Шаблон «{title}» снят", { title: tr(markup.title) }));
      return;
    }
    tellKept(markup.id);
    onConfig(applyMarkupTemplate(config, markup.id, { names }), mapText("Шаблон «{title}»", { title: tr(markup.title) }));
  };
  const remove = () => {
    tellKept("");
    onConfig(applyMarkupTemplate(config, "", { names }), tr("Шаблон снят"));
  };
  const groups = useMemo(() => markupGroups(config, current), [config, current]);
  const shown = useProgressive(MARKUP_TEMPLATES.length);
  const order = (markup) => MARKUP_TEMPLATES.indexOf(markup);

  return (
    <div className="wmc-templates">
      {/* На что ляжет шаблон — вид карты из «Карты», здесь же и сменить. */}
      <PanelSection title={tr("Вид карты")} icon={<Stack aria-hidden="true" />}>
        <button type="button" className="wmc-look-card" onClick={() => onOpenLook?.()}>
          <span className="wmc-look-card-picture">
            <LookPicture look={mapLook} thumbs={thumbs} />
          </span>
          <span className="wmc-look-card-copy">
            <b>{lookTitle(mapLook)}</b>
            <small>{tr("Под шаблоном")}</small>
          </span>
          <span className="wmc-look-card-action">{tr("Сменить")}</span>
        </button>
      </PanelSection>

      {current && (
        <PanelSection
          className="wmc-template-current"
          title={server ? `${tr(server.title)} · ${tr(current.title)}` : tr(current.title)}
          actions={
            <Button variant="ghost" size="sm" icon={<X />} onClick={remove}>
              {tr("Снять")}
            </Button>
          }
        >
          <ul className="wmc-group-lines" aria-label={tr("Что на карте")}>
            {groups.map((group) => (
              <MapSetRow
                key={`${group.section}:${group.id}`}
                config={config}
                section={group.section}
                group={group}
                memoryId={memoryId}
                onConfig={onConfig}
                onVisible={(visible) =>
                  onConfig(
                    setMapGroupVisible(config, group.section, group.id, visible),
                    mapText(visible ? "«{title}» показано" : "«{title}» скрыто", { title: setTitle(group.title) }),
                  )
                }
              />
            ))}
          </ul>
        </PanelSection>
      )}

      {MARKUP_SERVERS.map((server) => (
        <PanelSection key={server.id} title={tr(server.title)}>
          <div className="wmc-set-grid" role="group" aria-label={mapText("Шаблоны: {server}", { server: tr(server.title) })}>
            {MARKUP_TEMPLATES.filter((markup) => markup.server === server.id).map((markup) => {
              const on = current?.id === markup.id;
              return (
                <button
                  type="button"
                  key={markup.id}
                  className={`ui-choice wmc-set-card${on ? " is-selected" : ""}`}
                  aria-pressed={on}
                  title={on ? mapText("{hint} — щелчок снимет", { hint: tr(markup.hint) }) : tr(markup.hint)}
                  data-markup={markup.id}
                  onClick={() => choose(markup)}
                >
                  <span className="ui-choice-media wmc-set-media">
                    {order(markup) < shown && (
                      <TemplatePreview
                        baseLayers={baseLayers}
                        look={look}
                        lookKey={lookKey}
                        markup={markup}
                        names={names}
                        atlas={atlas}
                        backdrop={backdrop}
                      />
                    )}
                    {on && (
                      <i className="ui-choice-mark" aria-hidden="true">
                        <Check weight="bold" />
                      </i>
                    )}
                  </span>
                  <span className="ui-choice-copy">
                    <b>{tr(markup.title)}</b>
                    <small>{tr(markup.hint)}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </PanelSection>
      ))}
    </div>
  );
}
