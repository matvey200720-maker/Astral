const textEncoder = new TextEncoder();

function canonicalValue(value, path) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path}: non-finite number.`);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value))
    return `[${value.map((item, index) => canonicalValue(item, `${path}[${index}]`)).join(",")}]`;
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${path}: canonical JSON accepts only plain JSON values.`);
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalValue(value[key], `${path}.${key}`)}`,
    )
    .join(",")}}`;
}

export function canonicalStreetLightJson(value) {
  return canonicalValue(value, "value");
}

export function canonicalStreetLightBytes(value) {
  return textEncoder.encode(canonicalStreetLightJson(value));
}

export async function sha256StreetLightCanonical(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable.");
  const digest = await subtle.digest(
    "SHA-256",
    canonicalStreetLightBytes(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
