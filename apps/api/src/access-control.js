export function isAdminUser(user) {
  return Boolean(user && user.role === "admin");
}

export function createRequireAdmin(resolveUser) {
  if (typeof resolveUser !== "function") {
    throw new TypeError("resolveUser must be a function");
  }

  return async function requireAdmin(req, res, next) {
    const user = await resolveUser(req);
    if (!isAdminUser(user)) {
      return res.status(403).json({ error: "Недостаточно прав." });
    }
    req.user = user;
    return next();
  };
}
