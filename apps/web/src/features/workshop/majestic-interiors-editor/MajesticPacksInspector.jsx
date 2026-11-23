/*
 * Вкладка «Паки интерьеров» редактора «Интерьеры Majestic RP» (Хелпер 7, 25.10.2026): откуда берутся файлы интерьеров.
 *
 * Показаны только паки реестра (`majestic-interiors.js`: паки всех двенадцати записей, у тюрьмы оба, у казино основной и дополнение; запасные
 * сборки Mission Row и запись без пакета — Vespucci — сюда не входят). У каждого: имя интерьера, состояние — «Скачан», идёт скачивание с
 * процентом, «Есть в ваших папках» (интерьер нашёлся в папке игрока, качать нечего), «нет в каталоге Astral» (облако такого пака не знает: кнопки
 * нет) — и «Скачать» (щелчок по строке) / «Отмена» («×») / «Убрать пак» (строкой внизу страницы) теми же каналами, что у «Интерьеров проектов» (`useProjectPacks`: грант облака, `fetch/cancel/remove`
 * главного процесса). Скачанное лежит у игрока; дальше кадр, цвет и блеск, «Применить» берут файлы оттуда. Папок игрока здесь не добавляют.
 */

import ActionRows from "../../../components/ui/ActionRows.jsx";
import ListGroup, { ListRow, ListSub } from "../../../components/ui/ListGroup.jsx";
import { CheckCircle, DownloadSimple, Package } from "../../../components/ui/icons.jsx";
import SectionHeading from "../section-help.jsx";
import { fill, packProgressText, packSizeText, packStatesText } from "../project-interiors-editor/project-interiors-text.js";
import { registryPacks } from "./majestic-interiors-entries.js";
import { tr, useTr } from "../../../locales/ui.js";

/** Имя строки: интерьер, а у записи с двумя пакетами — какой это (тюрьма: снаружи или внутри; казино: дополнение). */
function packTitle(item) {
  const part = item.role === "inside" ? tr("Внутри") : item.role === "addition" ? tr("дополнение") : item.sides ? tr("Снаружи") : "";
  return part ? `${tr(item.label)} · ${part}` : tr(item.label);
}

/** Состояние пакета: идёт скачивание, скачан, есть в папках игрока, можно скачать, облако его не знает. */
function packState(pack, local) {
  if (pack?.active) return "active";
  if (pack?.fetched) return "fetched";
  if (local) return "local";
  return pack ? "remote" : "absent";
}

/* Знак «на месте» справа в строке: слово теснило бы подпись (в немецком «Heruntergeladen» съедало полполосы), имя — для читалки и подсказки. */
const doneMark = (label) => (
  <span role="img" aria-label={label} title={label}>
    <CheckCircle aria-hidden="true" />
  </span>
);

/*
 * Строка пакета — строкой общей группы, как паки «Интерьеров проектов» (`ProjectInteriorsPacks.jsx`): можно скачать — щелчок по строке
 * скачивает; идёт скачивание — запись с процентом и «×» «Отмена», под ней полоса хода; скачан или лежит в папке игрока — знак справа; облако
 * пака не знает — запись без кнопки. «Убрать» скачанный — строкой внизу страницы (`ActionRows`).
 */
function PackRow({ item, pack, state, current, note, onDownload, onCancel }) {
  const title = packTitle(item);
  const meta = pack ? [packSizeText(pack.bytes), packStatesText(pack)].filter(Boolean).join(" · ") : "";
  const props = { icon: <Package />, title, className: "majestic-pack", "data-state": state, "data-pack": item.slug, "aria-current": current ? "true" : undefined };
  let line;
  /* Скачать нечего (выпуска пака ещё нет) — запись без кнопки, а не серая кнопка. */
  if (state === "remote" && pack.releaseId) line = <ListRow {...props} caption={meta} trailing={<DownloadSimple aria-hidden="true" />} onOpen={() => onDownload(pack)} />;
  else if (state === "active")
    line = <ListRow {...props} caption={packProgressText(pack.active)} trailing={<span>{pack.active.percent}%</span>} onClear={() => onCancel(pack.slug)} clearLabel={tr("Отмена")} />;
  else if (state === "fetched") line = <ListRow {...props} caption={meta} trailing={doneMark(tr("Скачан"))} />;
  else if (state === "local") line = <ListRow {...props} caption={tr("Есть в ваших папках")} trailing={doneMark(tr("Есть в ваших папках"))} />;
  else line = <ListRow {...props} caption={meta} trailing={null} />;
  return (
    <>
      {line}
      {(state === "active" || note) && (
        <ListSub>
          {state === "active" && (
            <span className="project-interiors-pack-bar" role="progressbar" aria-label={fill(tr("Скачивание: {0}"), title)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pack.active.percent}>
              <i style={{ width: `${pack.active.percent}%` }} />
            </span>
          )}
          {note && (
            <small className="project-interiors-pack-note" role="alert" data-pack-note={item.slug}>
              {note}
            </small>
          )}
        </ListSub>
      )}
    </>
  );
}

/**
 * `packs` — результат `useProjectPacks("majestic", …)`; `catalog` — каталог проекта (`useProjectCatalog`): по нему видно, что интерьер уже лежит
 * в папке игрока; `current` — запись реестра, что правится сейчас (её строки отмечены).
 */
export default function MajesticPacksInspector({ packs, catalog, current = "" }) {
  useTr();
  const known = new Map(packs.packs.map((pack) => [pack.slug, pack]));
  const units = new Set(catalog.current ? catalog.units.map((unit) => unit.id) : []);
  const rows = registryPacks().map((item) => {
    const pack = known.get(item.slug) || null;
    return { item, pack, state: packState(pack, units.has(item.unit)) };
  });
  const allThere = rows.every((row) => row.state === "fetched" || row.state === "local");
  /* Пак, которого облако не знает, — без действия: такие строки сведены в одну запись под списком (п. 2 `design-qa.md`, разбор 30.10.2026). */
  const listed = rows.filter((row) => row.state !== "absent");
  const absent = rows.filter((row) => row.state === "absent");
  /* Скачанный пак убирается строкой внизу страницы (п. 4 `design-qa.md`), красным. */
  const removals =
    packs.status === "web" || packs.closed
      ? []
      : rows
          .filter((row) => row.state === "fetched")
          .map((row) => ({ id: `pack-${row.item.slug}`, label: fill(tr("Убрать пак «{0}»"), packTitle(row.item)), danger: true, onClick: () => packs.remove(row.pack.slug) }));
  return (
    <div className="fx-inspector recolor-inspector majestic-inspector">
      <section className="ui-panel fx-section recolor-section" aria-label={tr("Паки интерьеров")} data-majestic-section="packs">
        <SectionHeading title="" help={tr("Паки интерьеров Majestic RP лежат на серверах Astral: нужный скачивается на этот компьютер, и интерьер появляется в кадре. Здесь только паки интерьеров этого редактора.")} />
        {packs.status === "web" ? (
          <p className="fx-hint" role="status">
            {tr("Интерьеры Majestic RP открываются в Astral Desktop: файлы казино берутся с вашего компьютера.")}
          </p>
        ) : packs.closed ? (
          <p className="fx-hint" role="status">
            {tr("Каталог интерьеров пока открыт только команде Astral.")}
          </p>
        ) : (
          <>
            {allThere ? (
              <p className="fx-hint" role="status">
                {tr("Все пакеты на месте")}
              </p>
            ) : null}
            {/* Ни одного пака в каталоге — одна тихая строка, а не запись со значком: она читалась строкой-действием (критик 30.10.2026). */}
            {!listed.length && absent.length > 0 && (
              <p className="fx-hint majestic-pack-absent" role="status" data-absent={absent.length}>
                {tr("Паков в каталоге Astral пока нет")}
              </p>
            )}
            {listed.length > 0 && (
              <ListGroup label={tr("Паки интерьеров")}>
                {listed.map(({ item, pack, state }) => (
                  <PackRow
                    key={item.slug}
                    item={item}
                    pack={pack}
                    state={state}
                    current={item.entryId === current}
                    note={pack && packs.note.slug === pack.slug ? packs.note.text : ""}
                    onDownload={packs.download}
                    onCancel={packs.cancel}
                  />
                ))}
                {/* Остальные паки, которых облако не знает, — одной записью без значка и без действия. */}
                {absent.length > 0 && (
                  <ListRow
                    title={fill(tr("Ещё {0} — нет в каталоге Astral"), absent.length)}
                    className="majestic-pack-absent"
                    data-absent={absent.length}
                    trailing={null}
                  />
                )}
              </ListGroup>
            )}
          </>
        )}
        {packs.note.text && !packs.note.slug ? (
          <p className="fx-hint" role="alert">
            {packs.note.text}
          </p>
        ) : null}
      </section>
      <ActionRows label={tr("Действия с паками")} actions={removals} />
    </div>
  );
}
