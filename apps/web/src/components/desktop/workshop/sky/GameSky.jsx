import { memo } from "react";
import ChoiceTile from "../../../ui/ChoiceTile.jsx";
import PresetShelf from "../../../ui/PresetShelf.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Небо, которое уже стоит в игре (ТЗ 17.10.2026, вечер, задача 3): «Взять из
 * своей игры».
 *
 * Если у человека стоит чужой графический пакет — NaturalVision Evolved,
 * coreFx, сборка сервера, — его небо лежит в файлах игры. Здесь оно
 * предлагается шаблоном: плитка читается с диска (`apps/desktop/src/
 * sky-sources.js`), ничего из чужого в Astral не копируется, а взятое небо
 * ложится в проект точными числами пакета и правится теми же ручками.
 *
 * Название — по меткам самого пакета (узнанный пакет, метка автора, папка
 * дополнения); без метки — по месту. Придумывать «это NVE» без метки нельзя.
 */

const fill = (template, ...values) => template.replace(/\{(\d+)\}/g, (_, slot) => values[Number(slot)] ?? "");

/* Имя прописными буквами (так подписывают пакеты) читается криком в
   интерфейсе: длинное слово — с заглавной, сокращения вроде NVE остаются. */
const calm = (text) =>
  /^[^a-zа-яё]*$/.test(text) && text.replace(/[^A-Za-zА-Яа-яЁё]/g, "").length > 4
    ? text.charAt(0) + text.slice(1).toLowerCase()
    : text;

/** Название плитки: узнанный пакет, метка автора, папка дополнения или место. */
export function skySourceTitle(source) {
  return (
    source.pack?.label ||
    (source.author && calm(source.author)) ||
    (source.folder && calm(source.folder)) ||
    (source.kind === "mods" ? tr("Слой OpenIV") : tr("Небо вашей игры"))
  );
}

/** Строка под названием: где лежит и что внутри — числом, без склонения. */
function sourceMeta(source) {
  const where =
    source.kind === "mods"
      ? tr("Слой OpenIV (mods)")
      : source.kind === "dlc"
        ? tr("Дополнение игры")
        : tr("В игре сейчас");
  const parts = [
    where,
    fill(tr("Погод: {0}"), source.weathers),
    ...(source.weather ? [tr("файл погоды")] : []),
    ...(source.clouds ? [tr("облака")] : []),
  ];
  return parts.join(" · ");
}

function GameSky({ sources, busy = false, onTake }) {
  useTr();
  if (!sources?.length) return null;
  const hasLayer = sources.some((source) => source.kind === "mods");
  return (
    <>
      <PresetShelf
        title={tr("Небо из вашей игры")}
        label={tr("Небо из вашей игры")}
        count={sources.length}
        className="sky-presets"
        collapsible={false}
      >
        {sources.map((source) => (
          <ChoiceTile
            key={source.id}
            className="sky-preset"
            title={skySourceTitle(source)}
            description={sourceMeta(source)}
            disabled={busy}
            onClick={() => onTake(source)}
          />
        ))}
      </PresetShelf>
      <p className="fx-hint">
        {tr("Файлы читаются из вашей игры и в Astral не копируются. Взятое небо ложится в проект точными числами пакета — его можно править ручками.")}
      </p>
      {hasLayer && (
        <p className="fx-hint">
          {tr("Слой OpenIV Astral не меняет, а игра с загрузчиком читает его вместо update.rpf: небо можно взять и править, но в игре оно не появится, пока этот слой стоит.")}
        </p>
      )}
    </>
  );
}

export default memo(GameSky);
