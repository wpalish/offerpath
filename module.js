import {
  F,
  S,
  R,
  C,
  live,
  rows,
  byId,
  unique,
  required,
  minor,
  amount,
  interval,
  noOverlap,
  changed,
  immutable,
  admin,
  totalLines,
  summary,
  clock,
  label,
} from "./core/rules.js";
const definition = {
  slug: "offerpath",
  reference: 69,
  title: "OfferPath",
  description:
    "Коммерческие предложения с составом, сроком действия, версиями и ручной фиксацией подтверждения; электронной подписи нет.",
  limitations:
    "Одна организация · Собственный сервер · Ручной ввод · Без банковских и внешних интеграций",
  collections: [
    C("offers", "Предложения", [
      F("number", "Номер"),
      F("client", "Заказчик"),
      F("scope", "Объём и результат", "textarea"),
      F("terms", "Условия и исключения", "textarea"),
      S("currency", "Валюта", ["KZT", "USD", "KGS", "UZS"]),
      F("price", "Предварительная цена", "money"),
      F("validUntil", "Действует до", "date"),
      S("status", "Состояние", [
        ["draft", "Черновик"],
        ["shared", "Отправка отмечена"],
        ["accepted", "Подтверждение отмечено"],
        ["declined", "Отклонено"],
      ]),
      F("evidence", "Основание подтверждения", "textarea", { required: false }),
    ]),
  ],
  validate(state, before, command, actor) {
    unique(rows(state, "offers"), "number", "Номер");
    for (const r of rows(state, "offers")) {
      const old = changed(before, "offers", r.id);
      if (!old) required(r.status === "draft", "Сначала создайте черновик.");
      if (r.status === "accepted")
        required(
          r.evidence.length >= 5,
          "Запишите основание ручной отметки подтверждения.",
        );
      if (r.status === "shared")
        required(
          r.validUntil >= new Date().toISOString().slice(0, 10),
          "Срок предложения истёк.",
        );
      if (old?.status === "accepted")
        immutable(old, r, [
          "number",
          "client",
          "scope",
          "terms",
          "currency",
          "price",
          "validUntil",
          "status",
          "evidence",
          "archived",
        ]);
      if (old?.status === "shared" && r.status !== "draft")
        immutable(old, r, [
          "scope",
          "terms",
          "currency",
          "price",
          "validUntil",
        ]);
    }
  },
  summarize(state) {
    return rows(state, "offers").map((o) =>
      summary(
        o.number + " · " + o.client,
        o.scope,
        "Предварительно: " +
          o.price +
          " " +
          o.currency +
          " · до " +
          o.validUntil,
        o.terms,
        "Статус: " +
          label(definition, "offers", "status", o.status) +
          ". Отметка не создаёт электронную подпись или договор.",
      ),
    );
  },
};
export default definition;
