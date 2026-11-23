import { useMemo, useRef, useState } from "react";
import { DownloadSimple, Globe, HardDrives, ImageSquare, PencilSimpleLine, Play } from "../../../../components/ui/icons.jsx";
import FavoriteHeart from "../../../../components/ui/FavoriteHeart.jsx";
import Button from "../../../../components/ui/Button.jsx";
import ClipPlayer from "../../../../components/ui/ClipPlayer.jsx";
import PickTile from "../../../../components/ui/PickTile.jsx";
import ModAuthor from "../../../../components/desktop/catalog/ModAuthor.jsx";
import ModName from "../../../../components/desktop/catalog/ModName.jsx";
import { dataLangOf } from "../../../../components/desktop/catalog/data-lang.js";
import { modActionCopy } from "../../../../components/desktop/catalog/modActionCopy.js";
import { modCardCopy } from "../../../../components/desktop/catalog/mod-card/modCardCopy.js";
import { catalogDownloadCount } from "../../../../catalog-utils.js";
import { modSizeLabel, sizeEstimateNote } from "../../size-estimate.js";
import { openingEditor } from "../../editor-opening.js";
import { catalogWorkEditor, modEditor, openModEditor } from "../../mod-editor.js";
import { installsFromCatalog } from "../../bundles/catalog-works.js";
import { openCatalogWork } from "../../../workshop/works/catalog-work.js";
import { projectFactText } from "../../card-projects.js";
import { useBundleActions } from "../../bundles/BundleContext.js";
import { humanFailure } from "../../../../utils/installFailure.js";
import { tr } from "../../../../locales/ui.js";
import SceneInstall from "./SceneInstall.jsx";
import { firstClipIndex, sceneFrames } from "./scene-frames.js";

/*
 * Сцена выбранного мода — правая часть варианта В («Просмотр», ТЗ 29.10.2026-b): большой кадр, слова, действия, внизу лента кадров мода.
 *
 * Кадр на сцене — обложка (`PickTile` постером, как в окне «Компоненты»); ролик мода встаёт на сцену по нажатию ▶ и играет только здесь — у выбранного, в списке слева
 * одни постеры (`docs/3D.md`, п. 31). Мод без своей обложки кадра не имеет: сцена так и говорит, а городской кадр GTA вместо него не ставится.
 * Сцену пересоздаёт выбор другого мода (`key`): кадр, нажатие ▶ и ошибки действий не переходят от мода к моду.
 */

const cx = (...names) => names.filter(Boolean).join(" ");

/* Что стоит под «плиткой» кадра: ролик или картинка. */
function Frame({ frame, autoStart, label, onFailed }) {
  if (frame.type === "image")
    return <PickTile look="poster" mode="static" cover={frame.src} fit="auto" title="" className="cvc-stage-tile" />;
  return (
    <ClipPlayer
      key={frame.key}
      className="cvc-stage-clip"
      src={frame.src}
      poster={frame.poster}
      bytes={frame.bytes}
      loop={Boolean(frame.effect || frame.loop)}
      silent={Boolean(frame.effect || frame.silent || frame.loop)}
      autoStart={autoStart}
      label={label}
      /* Ролик со звуком, сутки и эффект при сбое сами говорят словами и дают «Повторить» (`ClipPlayer`); выбывает только петля поста, как на странице мода. */
      onError={frame.type === "video" ? onFailed : undefined}
    />
  );
}

function Strip({ frames, index, onPick, label }) {
  if (frames.length < 2) return null;
  return (
    <ul className="cvc-strip" role="list" aria-label={label}>
      {frames.map((frame, at) => (
        <li key={frame.key}>
          <button
            type="button"
            className={cx("cvc-thumb", at === index && "is-active", frame.type !== "image" && "is-video")}
            aria-label={`${label} ${at + 1}`}
            aria-current={at === index ? "true" : undefined}
            onClick={() => onPick(at)}
          >
            <PickTile look="poster" mode="static" cover={frame.poster || frame.src} fit="auto" title="" />
            {frame.type !== "image" && (
              <span className="cvc-thumb-badge" aria-hidden="true">
                <Play weight="fill" />
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Facts({ mod, mods, locale }) {
  const size = modSizeLabel(mod, mods, locale);
  const downloads = catalogDownloadCount(mod);
  const project = projectFactText(mod);
  if (!size.text && !downloads && !project) return null;
  return (
    <ul className="cvc-facts">
      {size.text && (
        <li data-fact="size" data-approximate={size.approximate ? "" : undefined} title={size.approximate ? sizeEstimateNote() : undefined}>
          <HardDrives aria-hidden="true" />
          {size.text}
        </li>
      )}
      {downloads > 0 && (
        <li data-fact="downloads">
          <DownloadSimple aria-hidden="true" />
          {downloads.toLocaleString(locale)}
        </li>
      )}
      {project && (
        <li data-fact="project">
          <Globe aria-hidden="true" />
          {project}
        </li>
      )}
    </ul>
  );
}

/**
 * @param {{ entry: object, mods: object[], words: object, language: string, liked: boolean, kicker: string, onFavorite: Function, onSelect: Function, onOpen: Function, onNavigate: Function|null }} props
 * `entry` — запись списка: `{ key, mod, group, parts, title, icon }`; у редукса без своего пака `mod` пуст, и сцена показывает его имя и «Открыть» выборкой частей.
 */
export default function Scene({ entry, mods, words, language, liked, kicker, onFavorite, onSelect, onOpen, onNavigate }) {
  const { mod, group } = entry;
  const actions = useBundleActions();
  const actionCopy = modActionCopy(language);
  /* Кадры редукса — по обложке группы: её видно и на плитке сетки. */
  const sceneMod = useMemo(() => (group ? { ...(mod || { id: group.id }), cover: group.cover || mod?.cover } : mod), [group, mod]);
  const frames = useMemo(() => (sceneMod ? sceneFrames(sceneMod) : []), [sceneMod]);
  const [index, setIndex] = useState(0);
  /* Нажали ▶ на обложке — ролик стартует сам; на ролик через ленту просто встаёт кадр с постером и ▶ проигрывателя. */
  const [started, setStarted] = useState(false);
  const [dropped, setDropped] = useState(() => new Set());
  const shown = frames.filter((frame) => !dropped.has(frame.key));
  const at = Math.min(index, Math.max(0, shown.length - 1));
  const frame = shown[at] || null;
  const clipAt = firstClipIndex(shown);
  const editor = mod && onNavigate ? modEditor(mod) || catalogWorkEditor(mod) : null;
  const [editing, setEditing] = useState(false);
  const [failure, setFailure] = useState("");
  const editingRef = useRef(false);
  const edit = async () => {
    if (editingRef.current || !editor) return;
    editingRef.current = true;
    setEditing(true);
    setFailure("");
    const top = document.querySelector(".desktop-main")?.scrollTop || 0;
    const editorWords = modCardCopy(language).editor[editor.copyKey || editor.kind];
    try {
      await openingEditor({ title: editorWords?.name || "", label: tr("Готовлю редактор по файлам мода…"), top }, () =>
        openModEditor(mod, { mods, navigate: onNavigate, locale: language, returnTo: mod, returnTop: top, installed: actions?.installed || null }),
      );
    } catch (error) {
      setFailure(humanFailure(error, language) || String(error?.message || ""));
    } finally {
      editingRef.current = false;
      setEditing(false);
    }
  };
  /* Работа-набор (трейсер, попадание, огонь) ставится кнопкой «Установить», а в мастерскую ведёт вторая: редактора у неё нет, открывается сама работа. */
  const openable = Boolean(mod && onNavigate && !editor && installsFromCatalog(mod));
  const openWork = async () => {
    if (editingRef.current) return;
    editingRef.current = true;
    setEditing(true);
    setFailure("");
    try {
      await openCatalogWork(mod);
      onNavigate("workshop");
    } catch (error) {
      setFailure(humanFailure(error, language) || tr("Работа не открылась."));
    } finally {
      editingRef.current = false;
      setEditing(false);
    }
  };
  const playLabel = tr("Смотреть ролик");
  const name = group && !mod ? group.name : entry.title;
  return (
    <section className="cvc-scene" aria-label={entry.title} data-scene={entry.key}>
      <div className="cvc-stage">
        {frame ? (
          <Frame
            frame={frame}
            autoStart={started && frame.key === shown[clipAt]?.key}
            label={frame.effect ? tr("Стрельба из карабина") : frame.silent ? tr("Сутки таймцикла") : tr("Ролик со звуком")}
            onFailed={() => setDropped((current) => new Set(current).add(frame.key))}
          />
        ) : (
          <div className="cvc-stage-empty" role="img" aria-label={tr("У мода нет своего кадра")}>
            {entry.icon ? <entry.icon aria-hidden="true" /> : <ImageSquare aria-hidden="true" />}
            <span>{tr("У мода нет своего кадра")}</span>
          </div>
        )}
        {frame?.type === "image" && clipAt >= 0 && (
          <Button
            variant="secondary"
            size="md"
            className="cvc-stage-play"
            icon={<Play weight="fill" />}
            ariaLabel={playLabel}
            title={playLabel}
            onClick={() => {
              setIndex(clipAt);
              setStarted(true);
            }}
          >
            {playLabel}
          </Button>
        )}
      </div>

      <div className="cvc-copy">
        {kicker && <small className="cvc-kicker">{kicker}</small>}
        <h2 className="cvc-title" lang={dataLangOf(name)} title={name}>
          <ModName name={name} />
        </h2>
        {mod && (
          <div className="cvc-byline">
            <ModAuthor mod={mod} onOpen={onSelect} />
            {!group && (
              <Button
                variant="secondary"
                size="md"
                className="cvc-like"
                icon={<FavoriteHeart on={liked} />}
                active={liked}
                aria-pressed={liked}
                ariaLabel={liked ? words.favoriteRemove(entry.title) : words.favoriteAdd(entry.title)}
                title={liked ? words.favoriteRemove(entry.title) : words.favoriteAdd(entry.title)}
                onClick={() => onFavorite(mod.id)}
              />
            )}
          </div>
        )}
        {group && !mod ? (
          group.author ? (
            <p className="cvc-note" lang={dataLangOf(group.author)}>
              {group.author}
            </p>
          ) : null
        ) : (
          <Facts mod={mod} mods={mods} locale={words.locale} />
        )}
        {group && entry.components > 0 && <p className="cvc-note">{words.components(entry.components)}</p>}
      </div>

      <div className="cvc-actions">
        {mod ? (
          <>
            <SceneInstall mod={mod} mods={mods} language={language} onSelect={() => onOpen(entry)} />
            {(editor || openable) && (
              <Button
                variant="secondary"
                size="md"
                className="cvc-edit"
                icon={<PencilSimpleLine />}
                title={editor ? modCardCopy(language).editor[editor.copyKey || editor.kind]?.hint : undefined}
                onClick={editor ? edit : openWork}
                aria-busy={editing || undefined}
                disabled={editing}
              >
                {actionCopy.openInWorkshop}
              </Button>
            )}
            <Button variant="ghost" size="md" className="cvc-open" onClick={() => onOpen(entry)}>
              {tr("Открыть")}
            </Button>
          </>
        ) : (
          <Button variant="primary" size="md" className="cvc-open" onClick={() => onOpen(entry)}>
            {tr("Открыть")}
          </Button>
        )}
      </div>
      {failure && (
        <p className="cvc-action-note is-failed" role="alert">
          {failure}
        </p>
      )}

      <Strip frames={shown} index={at} onPick={setIndex} label={tr("Кадры")} />
    </section>
  );
}
