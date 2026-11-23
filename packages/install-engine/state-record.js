const blockedRecordKeys = new Set(["__proto__", "constructor", "prototype"]);

export function cleanId(value) {
  let cleaned = String(value || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .slice(0, 96);
  while (cleaned.startsWith("-")) cleaned = cleaned.slice(1);
  while (cleaned.endsWith("-")) cleaned = cleaned.slice(0, -1);
  return cleaned;
}

export function checkedRecordKey(value, label) {
  const key = String(value || "");
  if (!key || blockedRecordKeys.has(key)) {
    throw new Error(`${label} contains a reserved state key.`);
  }
  return key;
}

export function ownRecordValue(record, key) {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function setRecordValue(record, key, value) {
  const checked = checkedRecordKey(key, "State key");
  Object.defineProperty(record, checked, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  return value;
}
