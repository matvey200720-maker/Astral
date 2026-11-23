/*
 * «Иконки» большой карты (05.11.2026): значки карты игры — выбрать, заменить значком игры или своей картинкой, скрыть.
 *
 * Слева, поверх кадра, — сетка значков по разделам (настоящие картинки из файлов игры игрока), справа — выбранный значок:
 * названия, «В игре → Будет», «Как в игре», «Удалить», «Своя» и готовые значки самой игры. Работа — `config.blipIcons`; в игру
 * она уезжает кнопкой «Применить» карты отдельным патчем (`install-queue/tasks/blip-icons.js`). Мини-карта и карта паузы — один
 * фильм, поэтому значок меняется на обеих: об этом сказано в самом окне.
 */

import { useMemo, useRef, useState } from "react";
import { blipIconEdit } from "@modovik/vector-map/blip-icons";
import Button from "../../../../ui/Button.jsx";
import SegmentedControl from "../../../../ui/SegmentedControl.jsx";
import { ArrowCounterClockwise, Eye, EyeSlash, MagnifyingGlass, UploadSimple } from "../../../../ui/icons.jsx";
import { tr, useTr, useUiLanguage } from "../../../../../locales/ui.js";
import { mapText } from "../map-copy.js";
import { BLIP_SERVERS, blipCatalogEntry, blipTitle } from "./blip-catalog.js";
import {
  applyBlipEdit,
  atlasGrid,
  atlasPosition,
  buildSections,
  buildServerSections,
  countEdits,
  countVisible,
  effectiveEdit,
  hideBlips,
  readyIcons,
  serverSectionName,
  showBlips,
} from "./blip-icons-model.js";
import { serverIconTitle, serverIconsOf } from "./server-icons.js";
import "./map-icons.css";

const TILE_ICON = 40;
const READY_ICON = 32;
const PREVIEW_ICON = 56;

/* Почему значок не меняется — словами окна. */
const reasonText = (reason, followName) => {
  switch (reason) {
    case "gps-owned":
      return tr("Значок метки GPS правится в «Мини-карте»: раздел «Метки и GPS».");
    case "vector":
      return tr("Этот значок нарисован фигурами прямо в фильме мини-карты, картинки в листе у него нет — Astral такие не меняет.");
    case "placeholder":
      return tr("У этого номера в игре стоит красная заглушка: игра его не рисует, менять нечего.");
    case "composite":
      return followName
        ? mapText("Составной значок: он берёт картинку значка «{name}» и меняется вместе с ним.", { name: followName })
        : tr("Составной значок из нескольких картинок — Astral меняет только значки из одной картинки.");
    case "no-symbol":
      return tr("В файле игры для этого номера нет значка.");
    case "no-sheet":
      return tr("Лист этого значка не прочитался из игры.");
    default:
      return tr("Этот значок Astral не меняет.");
  }
};

/* Вид списка: «Иконки сервера» (разделы и подписи Majestic) или «Все значки игры» (подборка и остальное). */
const viewOf = (model) => (model.view === "server" ? "server" : "game");

/** Что будет в игре у номера: штатный, другой значок игры, своя картинка или пусто. Общая клетка меняется у обоих номеров. */
function futureOf(index, work, sprite) {
  const edit = index ? effectiveEdit(index, work, sprite) : blipIconEdit(work, sprite);
  if (!edit) return { kind: "stock" };
  if (edit.mode === "hidden") return { kind: "hidden" };
  if (edit.mode === "set") return { kind: "set", from: edit.from };
  return { kind: "picture", assetId: edit.assetId };
}

/* Картинка значка: клетка атласа (настоящий значок игры) или своя картинка проекта. */
function BlipPicture({ model, sprite, size, future = { kind: "stock" }, assetUrls }) {
  const shown = future.kind === "set" ? future.from : sprite;
  if (future.kind === "picture" && assetUrls?.[future.assetId])
    return <span className="wmc-icons-pic" style={{ width: size, height: size }}><img src={assetUrls[future.assetId]} alt="" draggable="false" /></span>;
  const at = atlasPosition(model.index, shown, size);
  const { columns, rows } = atlasGrid(model.index);
  /* Нет клетки в листе (векторный значок): пустая рамка, а не нарисованный образец. */
  const classes = `wmc-icons-pic${future.kind === "hidden" ? " is-hidden" : ""}${at ? "" : " is-blank"}`;
  return (
    <span className={classes} style={{ width: size, height: size }}>
      {at && model.atlasUrl ? (
        <i
          aria-hidden="true"
          style={{
            backgroundImage: `url(${model.atlasUrl})`,
            backgroundSize: `${columns * size}px ${rows * size}px`,
            backgroundPosition: `${-at.x}px ${-at.y}px`,
          }}
        />
      ) : null}
      {future.kind === "hidden" ? <EyeSlash className="wmc-icons-slash" aria-hidden="true" /> : null}
    </span>
  );
}

function Status({ model, onReload }) {
  useTr();
  if (model.status === "ready") return null;
  const text =
    model.status === "unsupported"
      ? tr("Значки читаются из файлов игры, а их видит только приложение Astral: браузер не открывает GTA V.")
      : model.status === "error"
        ? model.reason
          ? mapText("Не удалось прочитать значки из игры: {reason}", { reason: model.reason })
          : tr("Не удалось прочитать значки из игры: не найдена GTA V Legacy.")
        : tr("Читаю значки из игры…");
  return (
    <div className="wmc-icons-state" role="status" aria-live="polite">
      {model.status === "error" ? (
        <>
          <p>{text}</p>
          <Button variant="secondary" size="sm" icon={<ArrowCounterClockwise />} onClick={onReload}>
            {tr("Прочитать ещё раз")}
          </Button>
        </>
      ) : (
        <p>{text}</p>
      )}
    </div>
  );
}

/**
 * Сетка значков поверх кадра карты.
 *
 * @param {{ model: object, work: object, pick: number|null, onPick: Function, onWork: Function, assetUrls: object, query: string, onQuery: Function }} props
 */
export function MapIconsStage({ model, work, pick, onPick, onWork, assetUrls, query, onQuery }) {
  useTr();
  const language = useUiLanguage();
  const view = viewOf(model);
  const sections = useMemo(() => {
    if (!model.index) return [];
    return view === "server" ? buildServerSections(model.index, language, query) : buildSections(model.index, language, query);
  }, [model.index, language, query, view]);
  const counts = countEdits(work);
  const everyone = useMemo(() => sections.flatMap((section) => section.items).filter((item) => item.editable).map((item) => item.sprite), [sections]);
  return (
    <div className="wmc-icons-stage" data-testid="wmc-icons-stage" data-view={view} data-wheel-own="true">
      <header className="wmc-icons-bar">
        {model.setView ? (
          <SegmentedControl
            size="sm"
            className="wmc-icons-views"
            label={tr("Вид списка значков")}
            value={view}
            onChange={model.setView}
            options={[
              { value: "server", label: tr("Иконки сервера") },
              { value: "game", label: tr("Все значки игры") },
            ]}
          />
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          icon={<EyeSlash />}
          disabled={!model.index || !everyone.length}
          onClick={() => onWork(hideBlips(model.index, work, everyone), tr("Значки карты: скрыть все"), "icons.hide-all")}
        >
          {tr("Скрыть все")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Eye />}
          disabled={!model.index || !counts.hidden}
          onClick={() => onWork(showBlips(model.index, work, everyone), tr("Значки карты: показать все"), "icons.show-all")}
        >
          {tr("Показать все")}
        </Button>
        <span className="wmc-icons-count">
          {mapText("Скрыто: {hidden}", { hidden: counts.hidden })}
          <span aria-hidden="true"> · </span>
          {mapText("Заменено: {replaced}", { replaced: counts.replaced })}
        </span>
        <label className="wmc-icons-search">
          <MagnifyingGlass aria-hidden="true" />
          <input type="search" value={query} placeholder={tr("Поиск значка")} aria-label={tr("Поиск значка")} onChange={(event) => onQuery(event.target.value)} />
        </label>
      </header>
      <p className="wmc-icons-note">{tr("Значок меняется и на мини-карте, и на карте паузы: у игры это один фильм. В игру значки уходят кнопкой «Применить».")}</p>
      {view === "server" ? (
        <p className="wmc-icons-note" data-testid="wmc-icons-server-note">
          {tr("Названия и разделы — как у сервера Majestic. Значок меняется по номеру игры; что сервер рисует сам (окна, меню, свои картинки), Astral не меняет.")}
        </p>
      ) : null}
      {model.index?.state?.sandbox ? (
        <p className="wmc-icons-note" data-testid="wmc-icons-sandbox">
          {tr("Песочница: значки нарисованы кодом, настоящие Astral читает из файлов вашей GTA V.")}
        </p>
      ) : null}
      <Status model={model} onReload={model.reload} />
      <div className="wmc-icons-scroll">
        {sections.map((section) => {
          const editable = section.items.filter((item) => item.editable).map((item) => item.sprite);
          const allHidden = editable.length > 0 && editable.every((sprite) => effectiveEdit(model.index, work, sprite)?.mode === "hidden");
          const visible = countVisible(model.index, work, section.items.map((item) => item.sprite));
          return (
            <section key={section.id} className="wmc-icons-section" aria-label={section.title} data-section={section.id}>
              <header>
                <h3>{section.title}</h3>
                <small aria-label={mapText("Видно значков: {visible} из {total}", { visible, total: section.items.length })}>
                  {visible}/{section.items.length}
                </small>
                {editable.length ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={allHidden ? <Eye /> : <EyeSlash />}
                    onClick={() =>
                      onWork(
                        allHidden ? showBlips(model.index, work, editable) : hideBlips(model.index, work, editable),
                        mapText("Значки карты, «{name}»: {action}", { name: section.title, action: allHidden ? tr("показать") : tr("скрыть") }),
                        `icons.category.${section.id}`,
                      )
                    }
                  >
                    {allHidden ? tr("Показать категорию") : tr("Скрыть категорию")}
                  </Button>
                ) : null}
              </header>
              <div className="wmc-icons-grid">
                {section.items.map((item) => {
                  const future = futureOf(model.index, work, item.sprite);
                  const changed = future.kind !== "stock";
                  /* Подпись сервера длинная («Автосалон эксклюзивного транспорта Majestic Motors»): целиком — в подсказке. */
                  const hint = view === "server" ? (item.editable ? item.title : `${item.title}. ${reasonText(item.reason, null)}`) : item.editable ? undefined : reasonText(item.reason, null);
                  return (
                    <button
                      key={item.sprite}
                      type="button"
                      className={`wmc-icons-tile${pick === item.sprite ? " is-picked" : ""}${changed ? " is-changed" : ""}${item.editable ? "" : " is-locked"}`}
                      aria-pressed={pick === item.sprite}
                      title={hint}
                      data-sprite={item.sprite}
                      onClick={() => onPick(item.sprite)}
                    >
                      <BlipPicture model={model} sprite={item.sprite} size={TILE_ICON} future={future} assetUrls={assetUrls} />
                      <span className="wmc-icons-name" lang={item.listed ? undefined : "en"}>
                        {item.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {model.status === "ready" && !sections.length ? <p className="wmc-icons-empty">{tr("Такого значка нет")}</p> : null}
      </div>
    </div>
  );
}

/**
 * Правая колонка: выбранный значок.
 *
 * @param {{ model: object, work: object, pick: number|null, onPick: Function, onWork: Function, onPicture: Function, assetUrls: object }} props
 */
export function MapIconsInspector({ model, work, pick, onPick, onWork, onPicture, assetUrls }) {
  useTr();
  const language = useUiLanguage();
  const [ready, setReady] = useState("");
  const fileRef = useRef(null);
  const info = pick !== null && model.index ? model.index.bySprite.get(pick) : null;
  const future = pick !== null ? futureOf(model.index, work, pick) : { kind: "stock" };
  const gallery = useMemo(() => (model.index ? readyIcons(model.index, language, ready).slice(0, 700) : []), [model.index, language, ready]);

  const head = (
    <header className="wmc-icons-inspector-head">
      <small>{tr("Иконки")}</small>
      <strong>{viewOf(model) === "server" ? tr("Иконки сервера на карте") : tr("Значки карты игры")}</strong>
    </header>
  );
  if (!info)
    return (
      <div className="wmc-icons-inspector" data-testid="wmc-icons-inspector">
        {head}
        <p className="wmc-icons-hint">{tr("Выберите значок слева: его можно заменить значком игры, поставить свою картинку или скрыть.")}</p>
      </div>
    );

  const serverView = viewOf(model) === "server";
  /* Название по виду: в «Иконках сервера» — подпись сервера («КПП 1»), в «Всех значках игры» — название игры. */
  const nameOf = (sprite) => {
    const label = serverView ? serverIconsOf(sprite)[0] : null;
    return label ? serverIconTitle(label, language) : blipTitle(sprite, model.index.bySprite.get(sprite)?.symbol, language);
  };
  const title = nameOf(info.sprite);
  const editable = info.editable;
  const followName = info.follows !== undefined && info.follows !== null ? nameOf(info.follows) : "";
  const shared = (info.sharedWith || []).map(nameOf);
  const set = (edit, label, property) => onWork(applyBlipEdit(model.index, work, info.sprite, edit), label, property);
  const servers = Object.entries(blipCatalogEntry(info.sprite)?.servers || {});
  /* Значок из списка сервера зовётся так, как его знает игрок («Автошкола»); имя игры остаётся в строке со спрайтом. */
  const serverItems = serverIconsOf(info.sprite);
  const serverName = serverItems.length ? serverIconTitle(serverItems[0], language) : "";

  return (
    <div className="wmc-icons-inspector" data-testid="wmc-icons-inspector" data-view={viewOf(model)}>
      {head}
      <section className="wmc-icons-card">
        <h3 lang={(serverView && serverName) || blipCatalogEntry(info.sprite) ? undefined : "en"}>{title}</h3>
        {serverItems.length ? (
          <p className="wmc-icons-server-tag" data-testid="wmc-icons-server-tag">
            <small>{tr("Иконки сервера")}</small>
            <span>{serverItems.map((item) => serverSectionName(item.section, language)).join(" · ")}</span>
            {!serverView ? <span>{serverName}</span> : null}
          </p>
        ) : null}
        <p className="wmc-icons-sprite">
          <span>{mapText("Спрайт {sprite}", { sprite: info.sprite })}</span>
          <span aria-hidden="true"> | </span>
          <code>{info.symbol}</code>
        </p>
        {servers.length ? (
          <div className="wmc-icons-servers">
            <small>{tr("Бизнесы серверов с таким значком по смыслу")}</small>
            {servers.map(([id, name]) => (
              <p key={id}>
                <span>{BLIP_SERVERS[id].title}</span>
                <span lang="ru">{name}</span>
              </p>
            ))}
            <small className="wmc-icons-source">{tr("Названия — с вики серверов (05.11.2026). Номер спрайта серверы не публикуют, поэтому соответствие — по смыслу значка.")}</small>
          </div>
        ) : null}
        <div className="wmc-icons-compare">
          <figure>
            <BlipPicture model={model} sprite={info.sprite} size={PREVIEW_ICON} assetUrls={assetUrls} />
            <figcaption>{tr("В игре")}</figcaption>
          </figure>
          <span className="wmc-icons-arrow" aria-hidden="true">→</span>
          <figure>
            <BlipPicture model={model} sprite={info.sprite} size={PREVIEW_ICON} future={future} assetUrls={assetUrls} />
            <figcaption>{tr("Будет")}</figcaption>
          </figure>
        </div>
        {shared.length ? (
          <p className="wmc-icons-warn">
            {tr("Заодно изменится:")} <span lang="en">{shared.join(", ")}</span>
          </p>
        ) : null}
        {!editable ? (
          <p className="wmc-icons-warn">
            {reasonText(info.reason, followName)}
            {info.reason === "composite" && info.follows !== undefined ? (
              <Button variant="link" size="sm" onClick={() => onPick(info.follows)}>
                {mapText("Открыть «{name}»", { name: followName })}
              </Button>
            ) : null}
          </p>
        ) : null}
        <div className="wmc-icons-actions">
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowCounterClockwise />}
            disabled={!editable || future.kind === "stock"}
            onClick={() => set(null, mapText("Значок {sprite}: как в игре", { sprite: info.sprite }), `icons.${info.sprite}`)}
          >
            {tr("Как в игре")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<EyeSlash />}
            disabled={!editable || future.kind === "hidden"}
            onClick={() => set({ mode: "hidden" }, mapText("Значок {sprite}: скрыт", { sprite: info.sprite }), `icons.${info.sprite}`)}
          >
            {tr("Удалить")}
          </Button>
          <Button variant="secondary" size="sm" icon={<UploadSimple />} disabled={!editable || !onPicture} onClick={() => fileRef.current?.click()}>
            {tr("Своя")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/png,image/webp,image/jpeg,image/gif"
            data-testid="wmc-icons-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onPicture(file, info.sprite);
            }}
          />
        </div>
      </section>
      <section className="wmc-icons-card">
        <h3>{tr("Своя картинка")}</h3>
        <p className="wmc-icons-hint">
          {tr("Картинка вписывается в квадрат 64×64 точки. Игра красит значок в цвет метки: белое на прозрачном фоне станет этим цветом, цветное смешается с ним.")}
        </p>
      </section>
      <section className="wmc-icons-card">
        <h3>{tr("Готовые из набора")}</h3>
        <label className="wmc-icons-search is-block">
          <MagnifyingGlass aria-hidden="true" />
          <input type="search" value={ready} placeholder={tr("Поиск значка")} aria-label={tr("Поиск значка")} onChange={(event) => setReady(event.target.value)} />
        </label>
        <div className="wmc-icons-ready" role="group" aria-label={tr("Готовые из набора")}>
          {gallery.map((item) => (
            <button
              key={item.sprite}
              type="button"
              className={future.kind === "set" && future.from === item.sprite ? "wmc-icons-ready-tile is-picked" : "wmc-icons-ready-tile"}
              title={item.title}
              aria-label={item.title}
              disabled={!editable}
              onClick={() =>
                set(
                  item.sprite === info.sprite ? null : { mode: "set", from: item.sprite },
                  mapText("Значок {sprite}: заменён", { sprite: info.sprite }),
                  `icons.${info.sprite}`,
                )
              }
            >
              <BlipPicture model={model} sprite={item.sprite} size={READY_ICON} assetUrls={assetUrls} />
            </button>
          ))}
        </div>
        <p className="wmc-icons-hint">{tr("Значки самой игры: чёткие при любом приближении, игра красит их цветом метки, как родные.")}</p>
      </section>
    </div>
  );
}
