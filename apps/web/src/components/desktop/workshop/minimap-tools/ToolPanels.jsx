import { tr } from "../../../../locales/ui.js";
import ColorsPanel from "./ColorsPanel.jsx";
import DistancePanel from "./DistancePanel.jsx";
import { GpsMarkerPanel, GpsRoutePanel } from "./GpsPanels.jsx";
import HealthLossPanel from "./HealthLossPanel.jsx";
import IconsPanel from "./IconsPanel.jsx";
import {
  BlurPanel,
  FlashPanel,
  MarkerPanel,
  OthersPanel,
  OutlinePanel,
  PositionPanel,
  ZoomPanel,
} from "./MapPanels.jsx";
import NumbersPanel from "./NumbersPanel.jsx";
import OverlaysPanel from "./OverlaysPanel.jsx";
import { ElementsSection, StructureSection } from "./StructurePanel.jsx";
import TemplatesPanel from "./TemplatesPanel.jsx";
import { Fine, FineHost } from "./FineSettings.jsx";

/*
 * Панели инструментов мини-карты.
 *
 * 22.10.2026 (владелец: «человека должен встречать не миллион пугающих инструментов»): семнадцать инструментов стали девятью,
 * а каждая старая панель — разделом новой. 22.11.2026 (владелец: «должно быть всё просто… очень много путаешься в настройках») —
 * ещё проще: новый порядок, «Урон» влился в «Значки», «Положение на экране» разошлось на два инструмента, а в каждом инструменте сверху —
 * готовый вид и главные ручки, остальное — в закрытой «Тонкой настройке» (`FineSettings.jsx`).
 *
 *   Положение HP      — выключатель «HP отдельно от карты» → готовые раскладки → тонкая настройка (места элементов, подложка)
 *   Линии HP          — раскладка (готовые плитки) и цвета; подложка, рамка и «что на карте» — в тонкой настройке (бывшие «Полоски»)
 *   Значки            — значки HP и брони → цифры → «Урон с картинками» (вспышка; счёт вниз и вылетающие цифры — в тонкой настройке)
 *   Рамка             — шаблоны рамки, цвет, стороны; размытие вокруг карты — в тонкой настройке
 *   Метки             — метка и маршрут GPS (бывший «GPS»); размер, прозрачность и линия — в тонкой настройке
 *   Обзор             — дальность обзора; метки других игроков — в тонкой настройке
 *   Тексты и логотипы — свои надписи, картинки и GIF; слова вместо «км» и «м» — в тонкой настройке
 *   Стрелка           — стрелка игрока и буква N
 *   Положение карты   — где стоит карта, размер, экран игры → готовые мини-карты (бывший «Экран»); развёрнутый радар — в тонкой настройке
 *
 * Сами органы остались прежними (`minimap-tools/*`): здесь они только собираются в порядок. Что вызывает кадр и
 * сцену — решает окно (`MinimapCustomizer.jsx`).
 */

export function BarsPanel({
  config,
  commit,
  patchEffects,
  barAspect,
  onFill,
  onVideo,
  selected,
  onSelect,
  onToggleWidget,
  onPatchWidget,
  mapToggle,
  bigPlaces = null,
}) {
  return (
    <FineHost>
      <StructureSection config={config} commit={commit} />
      <ColorsPanel
        config={config}
        patchEffects={patchEffects}
        barAspect={barAspect}
        onFill={onFill}
        onVideo={onVideo}
      />
      <Fine>
        <ElementsSection
          config={config}
          selected={selected}
          onSelect={onSelect}
          onToggleWidget={onToggleWidget}
          onPatchWidget={onPatchWidget}
          mapToggle={mapToggle}
        />
      </Fine>
      {bigPlaces}
    </FineHost>
  );
}

export function IconsDigitsPanel({
  config,
  commit,
  patchEffects,
  widgetToggle,
  toggleWidget,
  uploadVisualAsset,
  onPatchWidget,
  numberTarget,
  onNumberTarget,
  placing,
  onPlacing,
  previewLevel,
  onPreviewLevel,
  /* «Урон с картинками» (22.11.2026): бывший инструмент «Урон» — раздел «Значков». Кнопки пробы урона стоят здесь, а не в углу кадра. */
  damageControls = null,
  holdFlash = false,
  onHoldFlash = null,
  onShowNumbers = null,
  bigPlaces = null,
}) {
  return (
    <FineHost>
      <IconsPanel
        config={config}
        commit={commit}
        patchEffects={patchEffects}
        widgetToggle={widgetToggle}
        uploadVisualAsset={uploadVisualAsset}
        onPatchWidget={onPatchWidget}
        previewLevel={previewLevel}
        onPreviewLevel={onPreviewLevel}
      />
      <NumbersPanel
        config={config}
        patchEffects={patchEffects}
        toggleWidget={toggleWidget}
        target={
          config.effects.lossDisplay === "combined"
            ? "healthNumber"
            : numberTarget
        }
        onTarget={onNumberTarget}
        placing={placing}
        onPlacing={onPlacing}
      />
      <FlashPanel
        config={config}
        patchEffects={patchEffects}
        uploadVisualAsset={uploadVisualAsset}
        holdFlash={holdFlash}
        onHoldFlash={onHoldFlash}
        title={tr("Урон с картинками")}
        lead={
          <>
            <p className="mmc-section-hint">
              {tr("Запустите пробу: карта покажет урон по броне, потом по HP")}
            </p>
            {damageControls}
          </>
        }
      />
      <Fine>
        <HealthLossPanel
          config={config}
          patchEffects={patchEffects}
          onShowNumbers={onShowNumbers}
        />
      </Fine>
      {bigPlaces}
    </FineHost>
  );
}

export function FramePanel({ config, patchOutline, patchFrame }) {
  return (
    <FineHost>
      <OutlinePanel
        config={config}
        patchOutline={patchOutline}
        title={tr("Рамка")}
      />
      <Fine>
        <BlurPanel
          config={config}
          patchFrame={patchFrame}
          title={tr("Размытие вокруг карты")}
        />
      </Fine>
    </FineHost>
  );
}

export function GpsPanel({
  gps,
  onGps,
  scene,
  pictureBusy,
  pictureError,
  onPicture,
}) {
  return (
    <FineHost>
      <GpsMarkerPanel
        gps={gps}
        onGps={onGps}
        scene={scene}
        pictureBusy={pictureBusy}
        pictureError={pictureError}
        onPicture={onPicture}
      />
      <GpsRoutePanel gps={gps} onGps={onGps} scene={scene} />
    </FineHost>
  );
}

export function ViewPanel({
  config,
  patchZoom,
  patchEffects,
  uploadVisualAsset,
}) {
  return (
    <FineHost>
      <ZoomPanel
        config={config}
        patchZoom={patchZoom}
        title={tr("Дальность обзора")}
      />
      <Fine>
        <OthersPanel
          config={config}
          patchEffects={patchEffects}
          uploadVisualAsset={uploadVisualAsset}
        />
      </Fine>
    </FineHost>
  );
}

export function TextsPanel({
  overlays,
  selected,
  onSelect,
  onAddText,
  onAddPicture,
  onPatch,
  onRemove,
  busy,
  error,
  distance,
  onDistance,
}) {
  return (
    <FineHost>
      <OverlaysPanel
        overlays={overlays}
        selected={selected}
        onSelect={onSelect}
        onAddText={onAddText}
        onAddPicture={onAddPicture}
        onPatch={onPatch}
        onRemove={onRemove}
        busy={busy}
        error={error}
      />
      <Fine>
        <DistancePanel
          distance={distance}
          onDistance={onDistance}
          title={tr("Слова вместо км и м")}
        />
      </Fine>
    </FineHost>
  );
}

export function ArrowPanel({ config, patchEffects, uploadVisualAsset }) {
  return (
    <MarkerPanel
      config={config}
      patchEffects={patchEffects}
      uploadVisualAsset={uploadVisualAsset}
      title={tr("Стрелка и компас")}
    />
  );
}

/* «Положение HP» (22.11.2026): выключатель «HP отдельно от карты», готовые раскладки и перетаскивание на кадре; места элементов и подложка — в тонкой настройке. */
export function HpPositionPanel({
  config,
  commit,
  patchMap,
  mapToggle,
  screenInfo,
  onDetachVitals,
  selected = null,
  onSelect = null,
  onPatchWidget = null,
}) {
  return (
    <FineHost>
      <PositionPanel
        mode="hp"
        config={config}
        commit={commit}
        patchMap={patchMap}
        mapToggle={mapToggle}
        screenInfo={screenInfo}
        onDetachVitals={onDetachVitals}
        selected={selected}
        onSelect={onSelect}
        onPatchWidget={onPatchWidget}
      />
    </FineHost>
  );
}

/* «Положение карты» (бывший «Экран»): где стоит карта, её прозрачность и размер, экран игры → готовые мини-карты; развёрнутый радар — в тонкой настройке. */
export function ScreenPanel({
  config,
  commit,
  patchMap,
  mapToggle,
  screenInfo,
  gameInfo = null,
  onTemplate,
}) {
  return (
    <FineHost>
      <PositionPanel
        config={config}
        commit={commit}
        patchMap={patchMap}
        mapToggle={mapToggle}
        screenInfo={screenInfo}
        gameInfo={gameInfo}
      />
      <TemplatesPanel config={config} onTemplate={onTemplate} />
    </FineHost>
  );
}
