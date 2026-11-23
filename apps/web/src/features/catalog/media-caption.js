import {
  captionIsDisclaimer,
  captionLiesAboutOrigin,
  formatTimecode,
  originCaption,
  SERVER_CAPTIONS,
  serverCaptionKey,
} from "@modovik/publishing";
import { tr } from "../../locales/ui.js";

// Кавычки названия по параметру языка: открывающая и закрывающая; неизвестный язык — как английский.
// Русского нет: при параметре ru подпись возвращается до пересборки.
const QUOTE_PAIRS = new Map([
  ["uk", "«»"],
  ["en", "“”"],
  ["de", "„“"],
  ["pl", "„”"],
  ["fr", ["«\u00a0", "\u00a0»"]],
]);
const quoted = (text, language) => {
  const [open, close] = QUOTE_PAIRS.get(language) ?? QUOTE_PAIRS.get("en");
  return open + text + close;
};

const dotted = (...parts) => parts.filter(Boolean).join(" · ");

// Как собирается подпись заново, по виду происхождения. Слова — по языку окна (tr), кавычки — по параметру.
const REBUILDERS = {
  upload: () => tr(SERVER_CAPTIONS.upload),
  "game-frame": ({ note }) => dotted(tr(SERVER_CAPTIONS["game-frame"]), note),
  "video-frame": ({ note, video }, language) => {
    const at = formatTimecode(video?.at);
    if (video?.provider === "file") return dotted(`${tr("Кадр из видео")} ${video.title ? quoted(video.title, language) : video.name}`, at, note);
    return dotted(tr("Кадр из обзора") + (video?.title ? ` ${quoted(video.title, language)}` : ""), video?.channel, at, note);
  },
};

// Подпись, которую вообще стоит показывать, вместе с тем, из чего она получена.
const shownCaption = (item) => {
  const origin = item?.origin;
  const kind = origin?.kind;
  if (typeof kind !== "string" || !kind || kind === "review-preview") return null;
  const standard = originCaption(origin);
  const caption = item.caption || standard;
  // Не показываем: пустое, оговорки, неправду о происхождении и обложку ролика.
  const withheld = !caption || captionIsDisclaimer(caption) || captionLiesAboutOrigin(caption, origin) || serverCaptionKey(caption) === "review-preview";
  return withheld ? null : { origin, standard, caption };
};

export const localMediaCaption = (item, language = "ru") => {
  const shown = shownCaption(item);
  if (!shown) return null;
  const { origin, standard, caption } = shown;
  if (language === "ru") return caption;
  if (standard && caption === standard) return REBUILDERS[origin.kind](origin, language);
  // Стандартная серверная подпись говорит словом языка окна, любая другая остаётся как есть.
  const key = serverCaptionKey(caption);
  return key ? tr(SERVER_CAPTIONS[key]) : caption;
};
