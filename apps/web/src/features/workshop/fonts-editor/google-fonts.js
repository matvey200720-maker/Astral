// Шрифт из каталога Google Fonts: берём целый файл из репозитория google/fonts на GitHub
// (а не нарезку по подмножествам, которую сайт раздаёт браузерам).
import { fontTypeOf, pickFontFile } from "../../../components/desktop/workshop/map-font-source.js";

const CONTENTS_URL = "https://api.github.com/repos/google/fonts/contents";
const LICENCE_DIRS = ["ofl", "apache", "ufl"];
const NAME_LIMIT = 60;

export const GOOGLE_FONTS_URL = "https://fonts.google.com/?subset=cyrillic";

const VERDICT = {
  unclear: "Не понял, какой это шрифт. Вставьте ссылку со страницы шрифта на Google Fonts или его название.",
  offline: "Google Fonts сейчас не отвечает. Скачайте шрифт кнопкой «Download» на его странице и перетащите архив сюда.",
  broken: "Файл шрифта не скачался — попробуйте ещё раз.",
};
const absentVerdict = (family) => `Шрифта «${family}» на Google Fonts нет — проверьте название.`;

// ---------------------------------------------------------------- разбор того, что вставил человек

// Имя из пути страницы шрифта: .../specimen/<имя>?... — первое непустое
function specimenName(text) {
  const parts = text.split("/");
  for (let at = 1; at < parts.length - 1; at += 1) {
    const name = parts[at].toLowerCase() === "specimen" ? parts[at + 1].split(/[?#]/, 1)[0] : "";
    if (name) return name;
  }
  return "";
}

// Имя из параметра family=... ссылки на CSS; значение идёт до ":" или "&"
const FAMILY_PARAM = new RegExp("[?&]family=([^:&]+)", "i");
const queryFamily = (text) => FAMILY_PARAM.exec(text)?.[1] ?? "";

const decodeName = (raw) => decodeURIComponent(raw.split("+").join(" ")).trim();

const looksLikeLink = (text) => {
  const head = text.toLowerCase();
  return head.startsWith("http:") || head.startsWith("https:") || text.includes("/");
};

function resolveFamily(text) {
  const raw = specimenName(text) || queryFamily(text);
  if (raw) return decodeName(raw);
  return looksLikeLink(text) ? "" : text.split(/\s+/).join(" ").slice(0, NAME_LIMIT);
}

export const googleFontFamily = (input) => {
  const text = `${input || ""}`.trim();
  return text && resolveFamily(text);
};

const isAsciiAlnum = (ch) => (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");

export const googleFontFolder = (family) => (family ? [...String(family).toLowerCase()].filter(isAsciiAlnum).join("") : "");

// ---------------------------------------------------------------- сеть

// Список файлов папки; null — здесь семейства нет, пора смотреть следующую лицензию
const listFolder = (fetcher, licence, folder) =>
  Promise.resolve(`${CONTENTS_URL}/${licence}/${folder}`)
    .then((address) => fetcher(address))
    .then((reply) => {
      if (reply.status === 404) return null;
      if (!reply.ok) throw new Error(VERDICT.offline);
      return reply.json();
    })
    .then((body) => (Array.isArray(body) ? body : null))
    .catch(() => {
      throw new Error(VERDICT.offline);
    });

// Файл шрифта, который стоит скачать из списка папки, или null
function chooseEntry(entries) {
  const wanted = pickFontFile(entries.map((entry) => entry.name));
  if (!wanted) return null;
  const entry = entries.find((item) => item.name === wanted);
  return entry?.download_url ? { name: wanted, address: entry.download_url } : null;
}

// Лицензии по порядку; первая с подходящим файлом побеждает, остальные не смотрятся
async function seek(fetcher, folder, [licence, ...rest]) {
  if (licence === undefined) return null;
  const entries = await listFolder(fetcher, licence, folder);
  return (entries && chooseEntry(entries)) ?? seek(fetcher, folder, rest);
}

const downloadBlob = (fetcher, address) =>
  Promise.resolve(address)
    .then((url) => fetcher(url))
    .then((reply) => {
      if (!reply.ok) throw new Error(VERDICT.broken);
      return reply.blob();
    });

// Имя файла — по семейству, расширение и тип — у выбранного файла репозитория
const packFont = (blob, family, fileName) =>
  new File([blob], `${family}.${fileName.split(".").pop()}`, { type: fontTypeOf(fileName) });

export const fontFromGoogle = async (input, fetcher = globalThis.fetch) => {
  const family = googleFontFamily(input);
  const folder = googleFontFolder(family);
  if (folder === "") throw new Error(VERDICT.unclear);

  const hit = await seek(fetcher, folder, LICENCE_DIRS);
  if (!hit) throw new Error(absentVerdict(family));
  return downloadBlob(fetcher, hit.address).then((blob) => packFont(blob, family, hit.name));
};
