/*
 * Из какого архива читать: слой mods идёт первым, как у игры.
 *
 * У человека с OpenIV рядом с игрой лежит папка `mods`, и загрузчик ASI
 * подменяет ею ванильные архивы: игра читает `mods\x64h.rpf`, а не `x64h.rpf`.
 * Редактор, который читает ванильный, показывает не ту игру — и пока папка
 * mods остаётся копией, разницы не видит никто. Стоит человеку положить туда
 * свой ретекстур, и предпросмотр начинает молча врать: картинка из одного
 * архива, игра из другого. Цена ошибки здесь не медленный кадр, а доверие к
 * тому единственному, ради чего предпросмотр существует.
 *
 * Признак подмены — НЕ САМА ПАПКА, а загрузчик рядом с ней: ASI-загрузчик
 * (`dinput8.dll` и родня) плюс плагин, который и делает подмену (`OpenIV.asi`
 * и родня). Забытая папка `mods` без загрузчика игрой не читается вовсе, и
 * предпочесть её значило бы соврать в другую сторону.
 *
 * Имён у обоих по нескольку, и это не педантизм. Правило родилось на паре
 * `dinput8.dll` + `OpenIV.asi` — так стоит у того, кто ставил OpenIV руками. Но
 * САМ ЛАУНЧЕР ставит другую пару: `dinput8.dll` + `RageOpenV.asi`
 * (`pinnedLoaderManifest` в `packages/install-engine/loader-policy.js`), а на
 * Enhanced — `xinput1_4.dll`. То есть человек, у которого слой mods появился
 * от Astral, по узкому правилу получил бы ванильную картинку — врали бы мы
 * ровно своим же пользователям.
 *
 * Правило выведено предпросмотром интерьеров (см. `mega-mall-building-model.js`
 * и коммит f5813ff) и вынесено сюда, чтобы у модулей был ОДИН ответ на вопрос
 * «какой архив грузит игра», а не три похожих. Нативный хост адресует слой тем
 * же двоеточием — `mods/x64h:/levels/...`, — поэтому чтение и распаковка
 * работают без помощника RPF.
 *
 * Ключ кэша от подмены слоя не страдает у тех, кто кладёт в него путь архива
 * вместе с размером и временем правки: смена слоя пересобирает модель сама.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { ASI_LOADERS, MODS_PLUGINS } from "@modovik/install-engine";

const exists = async (file) => {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
};

/*
 * Имена не заводятся здесь: список один на весь проект и лежит в установщике
 * (`packages/install-engine/loader-policy.js`). Тем же перечнем он охраняет
 * ванильную установку и объявляет тень папки `mods`. Своя копия здесь была до
 * 2026-09-09 и успела разойтись с копией в `astral-layer.js` на `version.dll`.
 */
export { ASI_LOADERS, MODS_PLUGINS };

const anyExists = async (root, names) =>
  (await Promise.all(names.map((name) => exists(path.join(root, name))))).some(
    Boolean,
  );

/*
 * Память ЖИВЁТ СЕКУНДЫ, а не сеанс.
 *
 * Заведена она ради одной сборки: у зала стадиона четыре архива подряд, и
 * спрашивать диск об одном и том же четыре раза незачем. А вот помнить ответ
 * до перезапуска приложения нельзя — OpenIV ставят при открытом лаунчере, и
 * запомненное «слоя нет» пережило бы установку: игра уже читает mods, а
 * предпросмотр до конца сеанса показывал бы ванильный архив. Это ровно та
 * ложь, от которой заведён весь модуль, только отложенная.
 *
 * Пять секунд покрывают сборку целиком и не переживают ни одного похода
 * человека в проводник.
 */
const LOADER_MEMORY_MS = 5000;
const loaderByRoot = new Map();

/** Читает ли игра слой `mods`: папка сама по себе не считается, нужен ASI. */
export async function readsManagedLayer(gameRoot) {
  const root = String(gameRoot || "");
  if (!root) return false;
  const known = loaderByRoot.get(root);
  if (known && Date.now() - known.asked < LOADER_MEMORY_MS) return known.answer;
  const answer = (
    await Promise.all([
      anyExists(root, ASI_LOADERS),
      anyExists(root, MODS_PLUGINS),
    ])
  ).every(Boolean);
  loaderByRoot.set(root, { answer, asked: Date.now() });
  return answer;
}

/**
 * Архив, который на самом деле грузит игра, — путём ОТ КОРНЯ ИГРЫ.
 *
 * Относительным, а не абсолютным, потому что этот же путь уходит нативному
 * хосту параметром `--archive` и в адрес с двоеточием; абсолютный там не
 * примут. Кому нужен файл — соединит с корнем сам.
 */
export async function resolveGameArchive({ gameRoot, archive }) {
  const relative = String(archive || "");
  if (!relative) return relative;
  if (!(await readsManagedLayer(gameRoot))) return relative;
  const managed = path.posix.join("mods", relative.split("\\").join("/"));
  return (await exists(path.join(gameRoot, managed))) ? managed : relative;
}

/** Сбросить память о загрузчике — для тестов и на случай смены установки. */
export function forgetManagedLayer() {
  loaderByRoot.clear();
}
