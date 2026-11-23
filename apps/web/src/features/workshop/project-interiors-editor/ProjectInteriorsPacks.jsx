/*
 * «Интерьеры проектов» — блок «Из каталога Astral» на вкладке «Источники».
 *
 * Интерьеры Majestic и GTA 5 РП раздаются с CDN Astral (решение владельца
 * 17.10.2026, вечер): список паков проекта приходит из облачного каталога вместе
 * с полнотой каждого интерьера, поэтому его видно, не скачав ни байта. Пак
 * скачивается щелчком по его строке; после обрыва связи загрузка продолжается с того места,
 * где встала. Скачанное лежит у игрока, дальше всё как с его собственной
 * папкой: кадр, цвет и блеск, «Установить». Неполные интерьеры только смотрятся.
 *
 * Без абзацев (ТЗ 29.10.2026, вечер; образец — страница вещи «Мастерской арены»): пак — строка группы (`ListRow`) своего раздела
 * («Другие интерьеры · Гаражи»). Не скачанный — строка-кнопка со знаком загрузки; скачиваемый и скачанный — записи списка без
 * кнопки (у первого — «×» «Отмена» и полоса хода под строкой, у второго — знак «Скачан»). Пояснение — по «?» у заголовка блока,
 * «Убрать пак» — карточкой внизу страницы (`packRemoveActions`, её рисует `SourcesTool`).
 */

import { useState } from "react";
import ListGroup, { ListRow, ListSub } from "../../../components/ui/ListGroup.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import { CheckCircle, DownloadSimple, Package } from "../../../components/ui/icons.jsx";
import SectionHeading from "../section-help.jsx";
import { fill, interiorsCountText, packProgressText, packSizeText, packStatesText } from "./project-interiors-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/** Строка, под которой полоса хода скачивания и (если есть) слово об отказе. */
function PackNote({ pack, state, note }) {
  if (state !== "active" && !note) return null;
  return (
    <ListSub>
      {state === "active" && (
        <span className="project-interiors-pack-bar" role="progressbar" aria-label={fill(tr("Скачивание: {0}"), pack.label)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pack.active.percent}>
          <i style={{ width: `${pack.active.percent}%` }} />
        </span>
      )}
      {note && (
        <small className="project-interiors-pack-note" role="alert">
          {note}
        </small>
      )}
    </ListSub>
  );
}

function PackRow({ pack, note, onDownload, onCancel }) {
  const state = pack.active ? "active" : pack.fetched ? "fetched" : "remote";
  const meta = [interiorsCountText(pack.units.length), packSizeText(pack.bytes), packStatesText(pack)].filter(Boolean).join(" · ");
  const props = { icon: <Package />, title: pack.label, "data-state": state, "data-pack": pack.slug };
  return (
    <>
      {state === "remote" && <ListRow {...props} caption={meta} trailing={<DownloadSimple aria-hidden="true" />} onOpen={() => onDownload(pack)} />}
      {/* Идёт скачивание — запись без кнопки, а «Отмена» — своим «×» рядом. */}
      {state === "active" && <ListRow {...props} caption={packProgressText(pack.active)} trailing={<span>{pack.active.percent}%</span>} onClear={() => onCancel(pack.slug)} clearLabel={tr("Отмена")} />}
      {/* Скачан — знаком справа (слово теснило бы подпись: в немецком «Heruntergeladen» съедало полполосы), имя знака — для читалки и подсказки. */}
      {state === "fetched" && <ListRow {...props} caption={meta} trailing={<span role="img" aria-label={tr("Скачан")} title={tr("Скачан")}><CheckCircle aria-hidden="true" /></span>} />}
      <PackNote pack={pack} state={state} note={note} />
    </>
  );
}

/** Строки «Убрать пак «…»» для карточки действий внизу страницы: только скачанные паки, которые можно убрать. */
export function packRemoveActions(packs) {
  if (packs.status === "web") return [];
  return packs.packs
    .filter((pack) => pack.fetched && !pack.active)
    .map((pack) => ({ id: `pack-${pack.slug}`, label: fill(tr("Убрать пак «{0}»"), pack.label), danger: true, onClick: () => packs.remove(pack.slug) }));
}

/** `packs` — результат `useProjectPacks`. */
export default function ProjectInteriorsPacks({ packs }) {
  useTr();
  const [query, setQuery] = useState("");
  if (packs.status === "web") return null;
  const needle = query.trim().toLowerCase();
  /* Пак без выпуска скачать нельзя: строки с одним «недоступно» нет — её не показываем, пока он не скачан. */
  const offered = packs.packs.filter((pack) => pack.releaseId || pack.fetched || pack.active);
  const shown = needle ? offered.filter((pack) => `${pack.label} ${pack.place.join(" ")} ${pack.units.map((unit) => unit.label).join(" ")}`.toLowerCase().includes(needle)) : offered;
  /* Паки приходят упорядоченными по месту и имени: группа — подряд идущие с одним местом. */
  const places = [];
  for (const pack of shown) {
    const place = pack.place.join(" · ");
    if (places.at(-1)?.place === place) places.at(-1).packs.push(pack);
    else places.push({ place, packs: [pack] });
  }
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={tr("Из каталога Astral")} data-project-interiors-section="packs">
      <SectionHeading
        title={tr("Из каталога Astral")}
        help={tr("Интерьеры проекта лежат на серверах Astral: список виден сразу, а нужный пак скачивается на этот компьютер. Неполные интерьеры можно смотреть, ставить в игру — только целые. Для проверки полноты нужна ваша GTA V.")}
      />
      {packs.closed ? (
        <p className="fx-hint" role="status">
          {tr("Каталог интерьеров пока открыт только команде Astral.")}
        </p>
      ) : !offered.length ? (
        <p className="fx-hint" role="status">
          {tr("Паков этого проекта в каталоге Astral пока нет.")}
        </p>
      ) : (
        <>
          <TextField label={tr("Найти пак")} value={query} placeholder={tr("Название, место или интерьер")} onChange={setQuery} />
          {!shown.length ? (
            <p className="fx-hint" role="status">
              {tr("Ничего не нашлось.")}
            </p>
          ) : (
            places.map(({ place, packs: group }) => (
              <ListGroup key={place} title={place} label={place || tr("Паки проекта")}>
                {group.map((pack) => (
                  <PackRow key={pack.slug} pack={pack} note={packs.note.slug === pack.slug ? packs.note.text : ""} onDownload={packs.download} onCancel={packs.cancel} />
                ))}
              </ListGroup>
            ))
          )}
        </>
      )}
      {packs.note.text && !packs.note.slug && (
        <p className="fx-hint" role="alert">
          {packs.note.text}
        </p>
      )}
    </section>
  );
}
