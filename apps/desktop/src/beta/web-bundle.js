import { openPakFile } from "@modovik/beta-pak";

/*
 * Веб-интерфейс бета-лаунчера: `beta\astral-web.pak` проверяется ключом
 * активации целиком, а расшифровывается по месту (packages/beta-pak,
 * `openPakFile`): открытый текст файла появляется в памяти, только когда окно
 * его запросило, и отдаётся локальным сервером из памяти
 * (apps/api/src/memory-web.js). На диск открытый интерфейс не попадает.
 *
 * Раньше pak расшифровывался в память целиком (~295 МБ): 0,85 с до окна и
 * столько же оперативной памяти на весь запуск (31.10.2026, холодный старт).
 * Теперь на старте один проход проверки тегов (чужой ключ, правка байта и
 * обрезка отказывают сразу), а sha256 файла из индекса сверяется при выдаче.
 * `expectedSha256` (хэш открытого bundle из подписанного манифеста) — для
 * вызывающего, который проверил подпись манифеста: сам по себе файл
 * manifest.json на диске ничем не защищён, и лаунчер ему не верит. Нужен хэш
 * всего открытого bundle, поэтому проход заодно его считает.
 */
export async function loadBetaWebBundle({
  pakFile,
  key,
  expectedSha256 = "",
  open = openPakFile,
  scan,
}) {
  const bundle = await open(pakFile, key, { hashPlain: Boolean(expectedSha256), scan });
  if (expectedSha256 && bundle.sha256 !== expectedSha256)
    throw new Error("web bundle does not match the signed manifest");
  if (!bundle.files.has("index.html"))
    throw new Error("web bundle has no index.html");
  return bundle;
}
