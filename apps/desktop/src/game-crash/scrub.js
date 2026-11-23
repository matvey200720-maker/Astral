/*
 * Вычистка следов человека из журналов игры (ТЗ владельца 11.11.2026, «Журнал падений игры»).
 *
 * Журналы Windows, Majestic и RAGE MP пишут чужие программы, и в них бывает всё: путь профиля с именем
 * пользователя, почта, токен в заголовке, cookie, адрес сервера, ключ. Общая чистка журнала приложения
 * (`scrubText`) знает пути профиля, почту, `token=…`, bearer и IPv4; здесь — то, что встречается именно в чужих
 * журналах и в записи о падении: двоеточие вместо `=` (`token: …`), ключи вида `accessToken`/`x-auth-token`,
 * заголовки `Cookie`/`Authorization`, JWT и токены Discord целиком, IPv6 (в том числе `::1`, `fe80::…%зона`), длинные
 * ключи, адреса вида `ip:порт`, лицензионные коды Rockstar, имя пользователя Windows вне пути.
 *
 * Версия модуля `majestic-client.dll 1.23.41.0` — улика, а не адрес: четыре числа после имени библиотеки или слов
 * «version»/«ver»/«v»/«build» не маскируются (общая чистка `scrubText` знает то же исключение).
 *
 * Чистка идёт ДО записи в запись о падении и ДО выгрузки: что не вычищено здесь, не попадёт ни на диск, ни в тикет.
 */
import os from "node:os";
import { scrubText } from "@modovik/contracts/app-errors";

/** Предел одной строки журнала в записи: журналы Majestic бывают с километровыми строками JSON. */
export const LINE_LIMIT = 300;

const swap = (pattern, replacement) => (text) => text.replace(pattern, replacement);
/* Имя файла игры, а не адрес: после слова «host»/«server» такое окончание узлом не считается. */
const FILE_SUFFIX = /\.(?:ydr|yft|ytd|ydd|ymap|ytyp|ycd|ybn|ypt|rpf|dll|asi|exe|log|txt|xml|meta|dat|gfx|awc|json|cfg|ini)$/i;

/* Четыре числа — версия, когда им предшествует имя библиотеки (`.dll 1.23.41.0`) или слово version/ver/v/build/версия. */
const VERSION_BEFORE = "(?<!(?:\\.(?:dll|exe|asi|sys|ocx|drv)|\\b(?:version|ver|v|build))[\\s:=]*)";
const IPV4 = `${VERSION_BEFORE}\\b\\d{1,3}(?:\\.\\d{1,3}){3}(?::\\d{2,5})?\\b`;
const ZONE = "(?:%[A-Za-z0-9_.-]+)?";

/* Ключи, в названии которых есть секрет: accessToken, x-auth-token, client_secret, userPassword, api-key, Authorization… */
const KEY_PARTS = "token|secret|passw(?:or)?d|pwd|api[_-]?key|apikey|authorization|cookie|licen[cs]e|serial|ticket|credential";
/* Ключи ровно из слова: session, sid, auth, rgsc, social-club (в середине других слов они не нужны). */
const EXACT_KEYS = "session|sessionid|session_id|sid|auth|rgsc|social[_-]?club";
const VALUE = "[^\\s\"',;&}\\]]{3,}";

const STEPS = [
  /* JWT целиком (заголовок.тело.подпись), а не только хвост. */
  swap(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "<secret>"),
  /* Токен Discord без ключа: три части через точки (id.время.подпись), и mfa.… */
  swap(/\bmfa\.[A-Za-z0-9_-]{20,}/g, "<secret>"),
  swap(/(?<![A-Za-z0-9_.-])[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_.-])/g, "<secret>"),
  /* Заголовки целиком: значение до конца строки. */
  swap(/\b(cookie|set-cookie|authorization|proxy-authorization|x-api-key)\s*[:=]\s*[^\r\n]+/gi, "$1: <secret>"),
  /* `token: abc`, `accessToken=abc`, `"password" : "abc"`, `x-auth-token: abc` — значение до пробела, кавычки или конца. */
  swap(new RegExp(`(?<![\\w-])([\\w-]*(?:${KEY_PARTS})[\\w-]*)(["']?\\s*[:=]\\s*["']?)${VALUE}`, "gi"), "$1$2<secret>"),
  swap(new RegExp(`(?<![\\w-])(${EXACT_KEYS})(["']?\\s*[:=]\\s*["']?)${VALUE}`, "gi"), "$1$2<secret>"),
  /* Адрес с портом и IPv6 — раньше общего правила, чтобы порт и зона не остались; версии модулей не трогаются. */
  swap(new RegExp(IPV4, "gi"), "<ip>"),
  swap(new RegExp(`\\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}${ZONE}`, "gi"), "<ip>"),
  /* Привязанные к интерфейсу и «домашние» адреса: fe80::…%eth0, fd00::…, ::1, ::ffff:1.2.3.4. */
  swap(new RegExp(`(?<![\\w:.])(?:fe80|f[cd][0-9a-f]{2})(?::[0-9a-f]{0,4}){1,7}${ZONE}(?![\\w:])`, "gi"), "<ip>"),
  swap(/(?<![\w:.])::(?:ffff:)?(?:\d{1,3}\.){3}\d{1,3}(?![\w:.])/gi, "<ip>"),
  swap(new RegExp(`(?<![\\w:.])(?:[0-9a-f]{1,4}:){1,6}(?::[0-9a-f]{1,4}){1,6}${ZONE}(?![\\w:])`, "gi"), "<ip>"),
  swap(new RegExp(`(?<![\\w:.])(?:[0-9a-f]{1,4}:){1,7}:${ZONE}(?![\\w:])`, "gi"), "<ip>"),
  swap(/(?<![\w:.])::1(?![\w:])/g, "<ip>"),
  /* Длинные подряд идущие ключи: 32+ шестнадцатеричных знака (ключ, хеш входа) или 40+ знаков base64 без пробелов. */
  swap(/\b[0-9a-f]{32,}\b/gi, "<hex>"),
  /* Без «-», «_» и «/»: идентификаторы модов (`local-sound-weapon-carbinerifle-mk2-2b67ed90c144`) и пути ключами не считаются. */
  swap(/\b[A-Za-z0-9+]{40,}={0,2}(?![A-Za-z0-9+])/g, "<key>"),
  /* Адреса серверов проекта по имени узла: `connect to host.example.com:22005`. Разделитель обязателен: имя файла `hostbld3.ydr` или `server.dll` адресом не считается. */
  swap(/\b(?:connect(?:ing|ed)?(?:\s+to)?|server|host)(?:\s*[:=]\s*|\s+)([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?::\d{2,5})?)(?![A-Za-z0-9_])/gi, (match, address) => (FILE_SUFFIX.test(address) ? match : `${match.slice(0, match.length - address.length)}<host>`)),
];

const home = () => {
  try {
    return os.homedir();
  } catch {
    return "";
  }
};

const account = () => {
  try {
    return os.userInfo().username || "";
  } catch {
    return "";
  }
};

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Чистка чужого текста. `username`/`homeDir` можно передать (тесты, проверка на чужой машине); по умолчанию — текущий
 * пользователь процесса. Пути профиля превращаются в «~», имя — в «<user>».
 */
export function scrubGameText(value, { username, homeDir, limit = 6000 } = {}) {
  let text = scrubText(value === null || value === undefined ? "" : String(value), Math.max(limit * 2, limit));
  const root = homeDir === undefined ? home() : homeDir;
  if (root && root.length > 3) {
    text = text.replace(new RegExp(escapeRegExp(root).replace(/\\\\/g, "[\\\\/]+"), "gi"), "~");
    text = text.replace(new RegExp(escapeRegExp(root.split("\\").join("/")), "gi"), "~");
  }
  for (const step of STEPS) text = step(text);
  const alias = String(username === undefined ? account() : username).trim();
  if (alias.length >= 3) text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(alias)}(?![\\p{L}\\p{N}_])`, "giu"), "<user>");
  return text.length > limit ? text.slice(0, limit) : text;
}

/** Одна строка журнала для записи о падении: вычищена и обрезана. */
export function scrubLine(value, options = {}) {
  const line = scrubGameText(value, { ...options, limit: LINE_LIMIT * 2 }).replace(/\s+/g, " ").trim();
  return line.length > LINE_LIMIT ? `${line.slice(0, LINE_LIMIT - 1)}…` : line;
}
