import fs from "node:fs/promises";
import path from "node:path";

/*
 * Общее для записей сверки с игрой (ТЗ H1, 14.11.2026): мини-карта, прицел,
 * счётчик патронов и счётчик урона пишут при «Применить» одну запись каждый
 * (`buildReconcileRecord` из `@modovik/minimap-contract/reconcile`). Формат записи
 * и её сборка — в контракте; здесь то, что берётся из главного процесса: экран
 * игры из запроса, итог проверки движка и файлы, что он записал.
 */

/** Экран игры из запроса — как его прочитал главный процесс (`readGameScreen`), или `null`. */
export function rawGameScreenOf(input) {
  const screen = input?.gameScreen;
  return screen && typeof screen === "object" && !Array.isArray(screen)
    ? screen
    : null;
}

/** Откуда запись: работа проекта и версия Astral, если окно их передало (иначе пусто). */
export function reconcileOrigin(input) {
  const work = input?.work;
  return {
    work:
      work && typeof work === "object"
        ? { id: String(work.id ?? ""), name: String(work.name ?? "") }
        : null,
    astral: typeof input?.astral === "string" ? input.astral : "",
  };
}

/**
 * Итог проверки движка из ответа `install-rpf-patch`. Движок собирает архив и до
 * подмены живого файла сверяет каждый записанный файл с тем, что был в пакете
 * (фаза `verify`); не сошлось — установка отказывает, и ответа нет. Поэтому
 * ответ — это «проверка пройдена»: точка отката, поставленные архивы, чем
 * дописан заголовок. Ответа движка нет (или он без точки отката и архивов) —
 * `null`, и запись называет это проблемой `verify-missing`.
 */
export function engineVerifyFacts(installed) {
  if (!installed || typeof installed !== "object") return null;
  const archives = Array.isArray(installed.archives)
    ? installed.archives.map(String)
    : null;
  const restorePoint =
    typeof installed.id === "string" && installed.id ? installed.id : null;
  if (!archives && !restorePoint) return null;
  return {
    passed: true,
    phase: "verify",
    archives: archives || [],
    restorePoint,
    finalizer:
      typeof installed.archiveFinalizer === "string"
        ? installed.archiveFinalizer
        : null,
    keySource:
      typeof installed.keySource === "string" ? installed.keySource : null,
  };
}

/** Файлы пакета, как их записывает установка: `[{ target, size, sha256 }]` по манифесту пакета (нет манифеста — пусто). */
export async function patchWrittenFiles(patchDirectory) {
  try {
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(String(patchDirectory), "manifest.json"),
        "utf8",
      ),
    );
    return (Array.isArray(manifest?.Actions) ? manifest.Actions : []).map(
      (action) => ({
        target: String(action?.TargetPath || ""),
        size: Number(action?.Size) || 0,
        sha256: String(action?.Sha256 || ""),
      }),
    );
  } catch {
    return [];
  }
}

/** Точек сцены в пикселе экрана игры: высота экрана / высота сцены; разрешения нет — `null`. */
export function pixelsPerStagePoint(gameScreen, stageHeight) {
  const height = Number(gameScreen?.height);
  return height > 0 && stageHeight > 0 ? height / stageHeight : null;
}

/** Ограничить ожидание: чтение живого файла после установки не должно зависнуть вместе с «Применить». */
export function withTimeout(promise, milliseconds, message = "timeout") {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/**
 * Собрать запись сверки так, чтобы её сбой не стал сбоем установки: установка уже
 * прошла, а запись — вспомогательная. Не собралась — `null` (окно пишет «запись не собрана»).
 */
export function safeReconcile(build) {
  try {
    return build();
  } catch {
    return null;
  }
}
