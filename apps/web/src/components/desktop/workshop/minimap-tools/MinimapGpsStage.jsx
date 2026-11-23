import { StageBar, StageNote } from "../../../ui/StageOverlay.jsx";
import { gpsKilometres } from "../../../../features/workshop/gps-editor/gps-scene.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { trFill } from "../../../../locales/tr-fill.js";
import { localKilometres, useMinimapCopy } from "../minimap-lang.js";
import RouteFrame from "./RouteFrame.jsx";
import { useMarkerIcon, useRouteModel } from "./route-model.js";

/*
 * Кадр инструментов «Метка GPS», «Маршрут» и «Шаблоны» (задача 10 ТЗ
 * 10.10.2026, вечер). Владелец: «когда ты в инструмент заходишь, у тебя вот
 * так большая карта открывается по настройке этого GPS».
 *
 * ТЗ 22.10.2026: «сделать уже готовые фотки, а не чтобы человек мог переставлять
 * метку; сделать 2 варианта, где улучшенный доставит тебя быстрее». Кадр
 * показывает готовую картинку выбранного варианта — «Как в игре» или
 * «Улучшенный» (`RouteFrame`, `route-model.js`), а метка стоит на одном месте:
 * ни выбора точки, ни щелчка по карте.
 *
 * Игра под рукой и дороги прочитаны — кладутся настоящие плитки карты и
 * настоящие пути по узлам дорог игрока. Иначе кадр рисует схему сам и прямо
 * говорит об этом в подписи: листов Rockstar в поставке нет.
 */

export default function MinimapGpsStage({ gps, scene }) {
  useTr();
  const copy = useMinimapCopy();
  const { destination, baseLoading, baseFailure, stockImage } = scene;
  const model = useRouteModel(scene);
  const icon = useMarkerIcon(gps, scene);
  const variant = gps.route.accuracy === "direct" ? "direct" : "stock";
  const staged = model.source === "staged";
  const { distances } = model;
  const stock = localKilometres(copy, gpsKilometres(distances?.stock));
  const direct = localKilometres(copy, gpsKilometres(distances?.direct));
  const place = tr(destination.label);

  /* Строки состояния кадра — в панели редактора, не на картинке: карта и дороги из игры или не прочитаны, откуда значок метки. */
  const mapLine = staged
    ? model.state === "loading"
      ? tr("Читаем дороги вашей игры…")
      : tr("Дороги вашей игры не прочитаны — подключите GTA V, чтобы маршрут шёл по ним.")
    : tr("Карта — плитки из вашей GTA V.");
  const mapWarn = staged && model.state !== "loading";
  const routeLine = staged
    ? trFill("Длины сняты в игре: до «{0}» как в игре {1}, улучшенный {2}.", place, stock, direct)
    : `${tr("Маршрут Astral считает по узлам дорог вашей игры.")} ${trFill("До «{0}»: как в игре {1}, улучшенный {2}.", place, stock, direct)}`;
  const iconUnread = gps.marker.icon === "stock" && !stockImage && !baseLoading;
  const iconLine =
    gps.marker.icon === "stock"
      ? stockImage
        ? tr("Значок метки — из вашей игры.")
        : baseLoading
          ? tr("Читаем значок метки из вашей игры…")
          : baseFailure
            ? trFill("Значок метки из вашей игры не прочитан ({0}).", tr(baseFailure))
            : tr("Значок метки из вашей игры не прочитан.")
      : tr("Значок метки — тот силуэт, что уйдёт в игру.");

  return (
    <div className="recolor-stage gps-stage is-studio mmc-gps-stage">
      <div className="model-stage-frame gps-frame">
        <RouteFrame model={model} variant={variant} gps={gps} icon={icon} label={copy.pauseMap(place)} />
      </div>
      <StageBar>
        <div className="mmc-gps-compare" role="group" aria-label={tr("Длина маршрута")}>
          <span className={variant === "stock" ? "is-active" : ""}>
            {tr("Как в игре")} <b>{stock}</b>
          </span>
          <span className={variant === "direct" ? "is-active" : ""}>
            {tr("Улучшенный")} <b>{direct}</b>
          </span>
        </div>
      </StageBar>
      <StageNote tone={mapWarn ? "warning" : undefined}>{mapLine}</StageNote>
      <StageNote>{routeLine}</StageNote>
      <StageNote>{tr("Линию рисует Astral теми же толщиной, узором и прозрачностью, что уйдут в игру.")}</StageNote>
      <StageNote tone={iconUnread ? "warning" : undefined}>{iconLine}</StageNote>
    </div>
  );
}
