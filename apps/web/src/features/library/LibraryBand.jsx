import { Fragment } from "react";
import {
  ClockCounterClockwise,
  HardDrives,
  Package,
  Stack,
} from "../../components/ui/icons.jsx";
import { Skeleton } from "../../components/ui/Skeleton.jsx";
import { tr, useUiLanguage } from "../../locales/ui.js";
import { trFill } from "../../locales/tr-fill.js";
import {
  diskFigures,
  lastPoint,
  modsWord,
  pointStamp,
  splitBytes,
} from "./library-numbers.js";

/*
 * Сводка сверху «Библиотеки» (вариант Б «Состояние игры», владелец, 15.11.2026): четыре карточки — какая сборка стоит, сколько модов в игре (по группам), сколько
 * места они занимают и когда снята последняя точка возврата. В режиме выделения карточки показывают, что будет после удаления («26 → 23», точка «создадим сейчас»).
 * Цифры — настоящие: группы и выделение — с полки, сборка — из установленных сборок каталога, место и точка — из хранилища и стопки точек движка
 * (`library-numbers.js`). Чего нет (песочница, сбой чтения) — «—» и слова «не удалось посчитать», а не образец. Пока цифры читаются, на их месте либо прошлое значение
 * (карточка слегка притушена, `data-stale`), либо скелет: пустого места карточка не показывает никогда (16.11.2026).
 */

/* Скелет на месте крупной цифры и подписи под ней: карточка держит высоту и «дышит», пока читается хранилище. */
function Waiting() {
  return (
    <>
      <Skeleton className="lib-band-wait" />
      <Skeleton line className="lib-band-wait-line" />
    </>
  );
}

const SEGMENTS = [
  ["graphics", "Графика"],
  ["weapons", "Оружие"],
  ["clothing", "Одежда"],
];

function Eyebrow({ icon: Icon, children }) {
  return (
    /* Подпись карточки прописными — решение макета («Состояние игры»): это метка-заголовок, не крик. */
    <div className="lib-band-eyebrow" data-audit-ignore="caps">
      <Icon aria-hidden="true" />
      {children}
    </div>
  );
}

function BuildCard({ bundles }) {
  /* Главная сборка — та, у которой больше всего частей уже стоит в игре. */
  const entry = [...bundles].sort(
    (left, right) =>
      right.progress.installedCount - left.progress.installedCount,
  )[0];
  return (
    <article className="lib-band-card lib-band-build">
      <span className="lib-band-collage" aria-hidden="true">
        <Stack />
      </span>
      <div className="lib-band-text">
        <Eyebrow icon={Stack}>{tr("Сборка")}</Eyebrow>
        {entry ? (
          <>
            <h3 className="lib-band-title">{entry.bundle.name}</h3>
            <p className="lib-band-sub">
              {trFill(
                "Модов сборки в игре: {0} из {1}",
                entry.progress.installedCount,
                entry.progress.total,
              )}
            </p>
          </>
        ) : (
          <>
            <h3 className="lib-band-title is-quiet">{tr("не выбрана")}</h3>
            <p className="lib-band-sub">
              {tr("Сборку можно собрать в разделе «Сборки»")}
            </p>
          </>
        )}
      </div>
    </article>
  );
}

function InGameCard({ total, counts, removing, language }) {
  const picked = removing.total;
  const after = picked > 0;
  return (
    <article className={`lib-band-card${after ? " is-after" : ""}`}>
      <Eyebrow icon={Package}>{tr("Сейчас в игре")}</Eyebrow>
      <div className="lib-band-big">
        {after ? (
          <>
            {total}
            <span className="lib-band-arrow">→</span>
            {total - picked}
          </>
        ) : (
          total
        )}
        <small>{modsWord(after ? total - picked : total, language)}</small>
      </div>
      <div className="lib-band-bar" aria-hidden="true">
        {total === 0 && <i className="is-empty" style={{ flex: 1 }} />}
        {SEGMENTS.map(([id]) => {
          const gone = removing[id] || 0;
          const keep = (counts[id] || 0) - gone;
          return (
            <Fragment key={id}>
              {keep > 0 && <i data-segment={id} style={{ flex: keep }} />}
              {gone > 0 && <i className="is-removed" style={{ flex: gone }} />}
            </Fragment>
          );
        })}
      </div>
      <p className="lib-band-legend">
        {SEGMENTS.map(([id, name]) => (
          <span key={id}>
            <u data-segment={id} />
            {tr(name)} <b>{counts[id] || 0}</b>
          </span>
        ))}
      </p>
    </article>
  );
}

function DiskCard({ numbers, language }) {
  const figures = diskFigures(numbers.storage);
  const mods = figures?.mods;
  return (
    <article
      className="lib-band-card"
      data-stale={numbers.stale?.storage ? "" : undefined}
    >
      <Eyebrow icon={HardDrives}>{tr("Место на диске")}</Eyebrow>
      {numbers.storage === undefined ? (
        <Waiting />
      ) : typeof mods === "number" ? (
        <>
          <div className="lib-band-big">
            {splitBytes(mods, language).value}
            <small>{splitBytes(mods, language).unit}</small>
          </div>
          <p className="lib-band-sub">
            {tr("Заняли моды")}
            {typeof figures.free === "number" && (
              <>
                {" · "}
                {tr("свободно")}{" "}
                <b>
                  {splitBytes(figures.free, language).value}{" "}
                  {splitBytes(figures.free, language).unit}
                </b>
              </>
            )}
            {typeof figures.points === "number" && (
              <>
                <br />
                {trFill(
                  "Точки возврата: {0}",
                  `${splitBytes(figures.points, language).value} ${splitBytes(figures.points, language).unit}`,
                )}
              </>
            )}
          </p>
        </>
      ) : (
        <>
          <div className="lib-band-big">—</div>
          <p className="lib-band-sub">{tr("не удалось посчитать")}</p>
        </>
      )}
    </article>
  );
}

function PointCard({ numbers, language, willCreate }) {
  const point = lastPoint(numbers.points);
  const stamp = point ? pointStamp(point.at, language) : "";
  return (
    <article
      className={`lib-band-card${willCreate ? " is-after" : ""}`}
      data-stale={numbers.stale?.points ? "" : undefined}
    >
      <Eyebrow icon={ClockCounterClockwise}>{tr("Точка возврата")}</Eyebrow>
      {numbers.points === undefined && !willCreate ? (
        <Waiting />
      ) : willCreate ? (
        <>
          <div className="lib-band-big is-small">{tr("создадим сейчас")}</div>
          <p className="lib-band-sub">
            {tr("Перед удалением.")}
            {point ? ` ${trFill("Прежняя: {0}", stamp)}` : ""}
          </p>
        </>
      ) : point ? (
        <>
          <div className="lib-band-big is-small">{stamp}</div>
          {point.count !== null && (
            <p className="lib-band-sub">
              {trFill("Было модов: {0}", point.count)}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="lib-band-big is-small is-quiet">
            {numbers.points === null ? "—" : tr("нет")}
          </div>
          <p className="lib-band-sub">
            {numbers.points === null
              ? tr("не удалось прочитать")
              : tr("Появится перед первой установкой")}
          </p>
        </>
      )}
    </article>
  );
}

/**
 * @param {object} props
 * @param {number} props.total сколько всего стоит в игре
 * @param {Record<string, number>} props.counts сколько в каждой группе (graphics, weapons, clothing)
 * @param {Record<string, number> & { total: number }} props.removing сколько отмечено к удалению: всего и по группам
 * @param {{ bundle: { name: string }, progress: { installedCount: number, total: number } }[]} props.bundles установленные сборки каталога
 * @param {{ storage: object | null | undefined, points: object[] | null | undefined }} props.numbers
 */
export default function LibraryBand({
  total,
  counts,
  removing,
  bundles,
  numbers,
}) {
  const language = useUiLanguage();
  return (
    <section className="lib-band" aria-label={tr("Сводка по библиотеке")}>
      <BuildCard bundles={bundles} />
      <InGameCard
        total={total}
        counts={counts}
        removing={removing}
        language={language}
      />
      <DiskCard numbers={numbers} language={language} />
      <PointCard
        numbers={numbers}
        language={language}
        willCreate={removing.total > 0}
      />
    </section>
  );
}
