import { readDrawable } from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { inflateResource } from "@modovik/native-rs";

/*
 * Модель без группы шейдеров («пустышка»): игра Legacy 3889 её не переживает — при подгрузке она перебирает шейдеры модели без проверки и падает (ACCESS_VIOLATION по адресу 0x18, дамп 03.10.2026,
 * мод GTA5RP убирал так штатные наклейки зала). Автор редукса прячет вещи теми же пустышками (21.11.2026: Andy Lord, `optimization-world` 42 модели и `arenas` 2 — `0xc0000005` через ~15 с после входа в сюжет).
 *
 * Малый модуль без редакторов: им пользуется сторож установки (`model-safety-guard.js`, на пути каталога и редуксов) и сборка мастерской (`recolor-arenas.js`: `unsafeDrawables`). Чтение файла — `@modovik/rage-drawable`.
 */
export const MODEL_EXTENSIONS = Object.freeze(["ydr", "ydd", "yft"]);

/** Вид модели по имени файла (`ydr`, `ydd`, `yft`) или `null`. */
export function modelKindOf(name) {
  const extension = String(name).toLowerCase().split(".").pop();
  return MODEL_EXTENSIONS.includes(extension) ? extension : null;
}

/* Длина корневой структуры вида (байт): ресурс короче — обрывок или мусор, а не модель. */
const ROOT_BYTES = Object.freeze({ ydr: 0xd0, ydd: 0x40, yft: 0x130 });

/**
 * Вердикт по байтам модели:
 *   `"empty"` — в файле есть модель без группы шейдеров (игра падает, доказано дампами) — сторож установки такой файл не кладёт;
 *   `"none"` — файл разобран, но моделей в нём наш читатель не нашёл (пустой словарь, одна ткань): падение не доказано, сторож установки НЕ снимает;
 *   `"unreadable"` — файл не разобран: читатель отказал, ресурс распаковался не целиком или короче корневой структуры (обрывок, мусор). Это не значит,
 *     что игра его не примет: сторож установки такие НЕ снимает. До 21.11.2026 обрывок из нескольких байт читался как «модель без шейдеров»
 *     (поля пустого места равны нулю) и молча не клался — так пропала заглушка ствола в `tests/gunpack-install.test.js`;
 *   `"ok"`.
 * Сборка мастерской (`unsafeDrawables`) отказывает всему, что не `"ok"`, как раньше.
 */
export function modelVerdict(bytes, name) {
  const kind = modelKindOf(name);
  if (!kind) return "ok";
  let drawables;
  try {
    const resource = openResourceWith(new Uint8Array(bytes), inflateResource);
    if (!resource.complete || resource.data.length < ROOT_BYTES[kind])
      return "unreadable";
    drawables = readDrawable(resource, {
      inflateRaw: inflateResource,
      kind,
    }).drawables;
  } catch {
    return "unreadable";
  }
  if (!drawables.length) return "none";
  return drawables.some((drawable) => !drawable.hasShaderGroup)
    ? "empty"
    : "ok";
}

/** Имена файлов-пустышек (и не разобранных) среди `[{ name, bytes }]` — как `unsafeDrawables` сборки мастерской. */
export function unsafeDrawables(files) {
  const unsafe = [];
  for (const file of files) {
    if (!modelKindOf(file.name)) continue;
    if (modelVerdict(file.bytes, file.name) !== "ok") unsafe.push(file.name);
  }
  return unsafe;
}
