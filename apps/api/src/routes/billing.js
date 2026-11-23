import { randomUUID } from "node:crypto";
import { Router } from "express";

const durations = [
  { months: 1, label: "1 месяц", discount: 0 },
  { months: 3, label: "3 месяца", discount: 5 },
  { months: 6, label: "6 месяцев", discount: 10 },
  { months: 12, label: "12 месяцев", discount: 20 },
];
const products = {
  plus: { id: "plus", name: "PLUS", monthlyPrice: 299 },
  creator: { id: "creator", name: "CREATOR", monthlyPrice: 599 },
};

function quote(productId, months) {
  const product = products[productId];
  const period = durations.find((item) => item.months === Number(months));
  if (!product || !period) return null;
  const subtotal = product.monthlyPrice * period.months;
  const total = Math.round(subtotal * (1 - period.discount / 100));
  return {
    product,
    period,
    subtotal,
    total,
    savings: subtotal - total,
    currency: "RUB",
  };
}

export function createBillingRouter({ requireCsrf, requireUser }) {
  const router = Router();

  router.get("/plans", (_req, res) =>
    res.json({ products: Object.values(products), durations }),
  );
  router.get("/quote", (req, res) => {
    const result = quote(req.query.product, req.query.months);
    if (!result) return res.status(400).json({ error: "Некорректный тариф." });
    return res.json(result);
  });
  router.post("/checkout", requireCsrf, requireUser, (req, res) => {
    const result = quote(req.body.product, req.body.months);
    if (!result) return res.status(400).json({ error: "Некорректный тариф." });
    return res.status(201).json({
      id: randomUUID(),
      status: "provider_not_connected",
      quote: result,
      message: "Заказ подготовлен. Платёжный провайдер ещё не подключён.",
    });
  });

  return router;
}
