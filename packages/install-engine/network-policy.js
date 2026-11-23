export function trustedPackageUrl(
  raw,
  { allowInsecureLocalhost = false, allowedHosts = null } = {},
) {
  const url = new URL(raw);
  let hostname = url.hostname.toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  const local = ["127.0.0.1", "localhost", "::1"].includes(hostname);
  if (
    url.protocol !== "https:" &&
    !(allowInsecureLocalhost && local && url.protocol === "http:")
  ) {
    throw new Error("Payload должен загружаться по HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("URL пакета не должен содержать учётные данные.");
  }
  if (
    Array.isArray(allowedHosts) &&
    (!allowedHosts.length || !allowedHosts.includes(hostname))
  ) {
    throw new Error("Package host is not on the approved CDN allowlist.");
  }
  if (!allowInsecureLocalhost && isBlockedLiteralAddress(hostname)) {
    throw new Error("Local and special-use IP addresses are not allowed.");
  }
  return url;
}

function isBlockedLiteralAddress(hostname) {
  if (hostname.startsWith("::ffff:")) {
    const mapped = hostname.slice("::ffff:".length);
    if (isIPv4Literal(mapped)) return isBlockedIPv4(mapped);
  }
  if (isIPv4Literal(hostname)) return isBlockedIPv4(hostname);
  if (!hostname.includes(":")) return false;
  const normalized = hostname.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function isIPv4Literal(hostname) {
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) =>
        part.length >= 1 &&
        part.length <= 3 &&
        [...part].every((character) => character >= "0" && character <= "9"),
    )
  );
}

function isBlockedIPv4(hostname) {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 2, 168].includes(b)) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}
