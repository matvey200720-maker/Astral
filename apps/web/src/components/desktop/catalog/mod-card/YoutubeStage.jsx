import { useEffect, useRef, useState } from "react";
import { YoutubeLogo } from "../../../ui/icons.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { openLink } from "../../settings/open-link.js";
import {
  watchPlayerError,
  youtubePlayerUrl,
  youtubePosterUrl,
  youtubeWatchUrl,
} from "../../../../features/catalog/youtube-video.js";

/*
 * Ролик YouTube на сцене карточки мода (25.10.2026).
 *
 * Настоящий плеер в рамке — пока он играет. Автор мог запретить встраивание (ошибки плеера 101/150): тогда рамка
 * показывала бы родную страницу «Видео недоступно» с кнопкой «Посмотреть на YouTube», а окно лаунчера новых окон
 * не открывает, и кнопка мертва (владелец, 25.10.2026, Blink x Skye). Поэтому лаунчер слушает ответ плеера
 * (`watchPlayerError`) и при ошибке заменяет рамку своим кадром: картинка ролика и «Смотреть на YouTube», которая
 * открывает системный браузер. Слова «недоступно» там нет — ролик есть, он просто смотрится на YouTube.
 */
export default function YoutubeStage({ id }) {
  useTr();
  const frame = useRef(null);
  const [failed, setFailed] = useState(false);
  /* Картинка ролика: полная, а у ролика без неё — средняя; нет и её — тёмное поле. */
  const [posterSize, setPosterSize] = useState("maxresdefault");

  useEffect(() => {
    if (failed) return undefined;
    return watchPlayerError(frame.current, () => setFailed(true));
  }, [id, failed]);

  if (failed) {
    const poster = posterSize ? youtubePosterUrl(id, posterSize) : "";
    return (
      <figure className="mod-card-frame mod-stage-video mod-stage-youtube is-blocked" data-youtube-blocked="">
        {poster && (
          <img
            className="mod-stage-poster"
            src={poster}
            alt=""
            draggable="false"
            onLoad={(event) => {
              /* У ролика без «максимальной» картинки YouTube отдаёт серую заглушку 120 × 90. */
              if (event.currentTarget.naturalWidth <= 120) setPosterSize(posterSize === "maxresdefault" ? "hqdefault" : "");
            }}
            onError={() => setPosterSize(posterSize === "maxresdefault" ? "hqdefault" : "")}
          />
        )}
        <a
          className="mod-stage-watch"
          href={youtubeWatchUrl(id)}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            event.preventDefault();
            openLink(youtubeWatchUrl(id));
          }}
        >
          <YoutubeLogo weight="fill" aria-hidden="true" />
          <span>{tr("Смотреть на YouTube")}</span>
        </a>
      </figure>
    );
  }

  return (
    <figure className="mod-card-frame mod-stage-video mod-stage-youtube">
      <iframe
        ref={frame}
        className="mod-stage-media mod-stage-player"
        src={youtubePlayerUrl(id, typeof window === "undefined" ? "" : window.location.origin)}
        /* Название ролика — данные автора (на языке автора) и в самом плеере; рамке — слова окна. */
        title={tr("Обзор на YouTube")}
        allow="encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
      />
    </figure>
  );
}
