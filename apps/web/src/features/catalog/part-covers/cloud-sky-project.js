// Чистые помощники кадра неба с облаками (без WebGL и окна — тесты читают их напрямую): проект неба из файлов таймцикла соседней части и доля облачных точек кадра.
import { createLook, importCloudsFromMod, importSkyFromMod } from "@modovik/timecycle";

/** Облако — светлое и почти бесцветное (насыщенность ниже границы), небо — синее. */
export const CLOUD_SATURATION = 0.2;
export const CLOUD_LIGHT = 0.45;

const textOf = (bytes) => (typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes));

/** Файлы таймцикла соседней части: `w_*.xml` — небо, `clouds.xml` и `cloudkeyframes.xml` — какие облака разрешены. */
export function skyProjectOf(files, name = "") {
  const named = (pattern) =>
    files
      .filter((file) => pattern.test(file.name))
      .map((file) => ({ name: file.name, text: textOf(file.bytes) }));
  const sky = importSkyFromMod(named(/^w_[a-z0-9_]+\.xml$/i), { name });
  const clouds = importCloudsFromMod(named(/^(clouds|cloudkeyframes)\.xml$/i), {
    name,
  });
  const project = sky?.project || clouds?.project || null;
  if (project && sky?.project && clouds?.project)
    project.look = {
      ...(project.look || {}),
      clouds: clouds.project.look.clouds,
    };
  return {
    project,
    sky: Boolean(sky?.project),
    clouds: Boolean(clouds?.project),
  };
}

/**
 * Проект без выбора облаков автора (`look.clouds`): выбор нужен кадру квартала из игры, а шейдерному небу (петля, кадры без квартала, обложка без игры) он
 * делает вид «не нейтральным», и `skySpec` (`SkyCover.jsx`) ушёл бы в ветку «ясный день эталона с видом», потеряв правки погоды автора. Выбора нет — тот же объект.
 */
export function withoutCloudChoice(project) {
  const clouds = project?.look?.clouds;
  if (!clouds || (clouds.types === null && clouds.template === null)) return project;
  return { ...project, look: { ...project.look, clouds: createLook().clouds } };
}

/** Доля «облачных» точек RGBA-кадра (светлые и почти бесцветные). */
export function cloudShare(rgba) {
  let hit = 0;
  const count = rgba.length / 4;
  for (let at = 0; at < rgba.length; at += 4) {
    const max = Math.max(rgba[at], rgba[at + 1], rgba[at + 2]) / 255;
    const min = Math.min(rgba[at], rgba[at + 1], rgba[at + 2]) / 255;
    if (max >= CLOUD_LIGHT && (max - min) / max <= CLOUD_SATURATION) hit += 1;
  }
  return count ? hit / count : 0;
}
