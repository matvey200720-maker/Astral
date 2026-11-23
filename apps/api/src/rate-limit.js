import { rateLimit } from "express-rate-limit";

/*
 * Общий потолок запросов локального API.
 *
 * 300 запросов запирали администратора посреди проверки; у входа свой, строгий
 * потолок (`authLimit` в server.js), а этот оставляет место окну, сайту и
 * консоли администратора вместе.
 *
 * Картинки и файлы пакетов — чтение готового по адресу, а не действие, и в
 * счёт не идут. Каталог на тысячи модов (выгрузка Discord, v2 с медиа по
 * хэшу) при прокрутке просит обложки сотнями; в общем счёте они выедали
 * потолок за минуту, и на 15 минут отказывало всё остальное — вход,
 * установка, сам каталог (`tests/api-rate-limit.test.js`).
 *
 * Сам интерфейс (страница, куски, `/assets`, `/media`) и кадры сцен тоже не в
 * счёте (31.10.2026): потолок на них выедался прокруткой витрин, отказ подгрузки
 * куска перезагружал окно (`stale-build.js`), и всё окно становилось голым JSON
 * «Слишком много запросов» — так выглядела ошибка на «Новой сборке».
 */
export const UNCOUNTED_READS = /^\/api\/(media|packages|fx-scenes)\//;
const isInterfaceRead = (path) => path !== "/api" && !path.startsWith("/api/");

export function apiRateLimit(limit = process.env.MODOVIK_API_RATE_LIMIT) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(limit || 1800),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Слишком много запросов. Попробуйте позже." },
    skip: (request) =>
      (request.method === "GET" || request.method === "HEAD") &&
      (UNCOUNTED_READS.test(request.path) || isInterfaceRead(request.path)),
  });
}
