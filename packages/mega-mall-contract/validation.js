export function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

export function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "ожидался объект.");
  }
  return value;
}

export function exact(value, keys, path, optional = []) {
  record(value, path);
  const allowed = new Set([...keys, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "неизвестное поле.");
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "поле обязательно.");
  }
  return value;
}

export function identifier(value, path, max = 96) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    !/^[a-z0-9][a-z0-9._:-]*$/.test(value)
  ) {
    fail(path, "ожидался безопасный lowercase-идентификатор.");
  }
  return value;
}

export function text(value, path, min, max) {
  if (typeof value !== "string") fail(path, "ожидалась строка.");
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    fail(path, `допустимо от ${min} до ${max} символов.`);
  }
  return normalized;
}

export function enumeration(value, values, path) {
  if (!values.includes(value)) {
    fail(path, `ожидалось одно из значений: ${values.join(", ")}.`);
  }
  return value;
}

export function integer(value, path, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(path, `ожидалось целое число от ${min} до ${max}.`);
  }
  return value;
}

export function number(value, path, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    fail(path, `ожидалось конечное число от ${min} до ${max}.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

export function boolean(value, path) {
  if (typeof value !== "boolean") fail(path, "ожидалось логическое значение.");
  return value;
}

export function color(value, path) {
  if (typeof value !== "string" || !/^#[0-9a-f]{8}$/i.test(value)) {
    fail(path, "ожидался цвет #rrggbbaa.");
  }
  return value.toLowerCase();
}

export function sha256(value, path) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail(path, "ожидался lowercase SHA-256 в формате sha256:<64 hex>.");
  }
  return value;
}

export function isoDate(value, path) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail(path, "ожидалась дата ISO-8601 UTC.");
  }
  return new Date(value).toISOString();
}

export function unique(values, path, readKey = (value) => value) {
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    const key = readKey(value);
    if (seen.has(key)) fail(`${path}[${index}]`, `дубликат ${key}.`);
    seen.add(key);
  }
  return values;
}

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
