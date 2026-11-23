const FALLBACK_SLUG = "gun";
const SLUG_LIMIT = 48;
const REVOKE_DELAY_MS = 1000;
const PNG = "image/png";

// Границы допустимых знаков имени парами «от, до»: цифры, a–z, а–я и ё.
const SLUG_BOUNDS = [48, 57, 97, 122, 0x430, 0x44f, 0x451, 0x451];

function inSlugAlphabet(code) {
  for (let i = 0; i < SLUG_BOUNDS.length; i += 2) {
    if (code >= SLUG_BOUNDS[i] && code <= SLUG_BOUNDS[i + 1]) return true;
  }
  return false;
}

// Куски текста из допустимых знаков; любой другой знак (или их подряд) — граница куска.
function* slugWords(text) {
  let word = "";
  for (const ch of text) {
    if (inSlugAlphabet(ch.codePointAt(0))) {
      word += ch;
    } else if (word) {
      yield word;
      word = "";
    }
  }
  if (word) yield word;
}

function slugify(value) {
  if (!value) return FALLBACK_SLUG;
  const joined = [...slugWords(String(value).toLowerCase())].join("-");
  return joined.slice(0, SLUG_LIMIT) || FALLBACK_SLUG;
}

function downloadBlob(blob, name) {
  const href = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href, download: name }).click();
  const release = () => URL.revokeObjectURL(href);
  setTimeout(release, REVOKE_DELAY_MS);
}

// Холст отдаёт PNG через колбэк; null означает, что кодировать не вышло.
function encodePng(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, PNG);
  });
}

const textureFileName = (title, material) => `${slugify(title)}-${slugify(material)}.png`;

// Материалы, у которых есть что выгружать. Слои читаются у каждого материала первыми;
// наклейки и износ общие на проект: если они есть, тронуты все.
function* touchedMaterials(project) {
  const sharedWork = project.stickers?.length > 0 || project.wear?.amount > 0;
  for (const material of project.materials) {
    if (0 < material.layers.length || sharedWork) yield material;
  }
}

async function exportTextures({ project, surfaceOf, name }) {
  const files = [];
  for (const material of touchedMaterials(project)) {
    const surface = surfaceOf(material.name);
    const blob = surface ? await encodePng(surface.canvas) : null;
    if (!blob) continue;
    downloadBlob(blob, textureFileName(name, material.name));
    files.push(material);
  }
  return files.length;
}

export { downloadBlob, exportTextures, slugify };
