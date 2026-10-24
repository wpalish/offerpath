import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import definition from "../module.js";
import { WorkStore } from "../core/store.js";

const offer = (number, status = "draft") => ({ number, client: "SYNTHETIC client",
  scope: "SYNTHETIC work", terms: "No real commitments", currency: "KZT",
  price: "25000", validUntil: "2026-10-24", status, evidence: "" });
const save = (store, data, id) => {
  const result = store.transact({ operation: "save", collection: "offers", data, id,
    revision: store.read().revision });
  return id || result.data.offers.at(-1).id;
};
const audit = (store) => store.db.prepare("SELECT * FROM audit ORDER BY rowid").all();
function rejectUnchanged(store, action, pattern) {
  const before = store.read(), events = audit(store);
  assert.throws(action, pattern);
  assert.deepEqual(store.read(), before);
  assert.deepEqual(audit(store), events);
}

test("expiry preserves shared history and unrelated edits but rejects a newly expired share", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-24T12:00:00Z") });
  const store = new WorkStore(definition);
  try {
    const sent = save(store, offer("SYNTHETIC-SHARED"));
    save(store, offer("SYNTHETIC-SHARED", "shared"), sent);
    const original = store.read().data.offers[0];
    t.mock.timers.setTime(Date.parse("2026-10-25T00:00:01Z"));
    save(store, offer("SYNTHETIC-OTHER-DRAFT"));
    assert.deepEqual(store.read().data.offers[0], original);
    rejectUnchanged(store, () => save(store, { ...offer("SYNTHETIC-SHARED", "shared"), price: "1" }, sent), /нельзя менять/);
    const expiredDraft = save(store, offer("SYNTHETIC-EXPIRED-DRAFT"));
    rejectUnchanged(store, () => save(store, offer("SYNTHETIC-EXPIRED-DRAFT", "shared"), expiredDraft), /истёк/);
    store.transact({ operation: "archive", collection: "offers", id: sent,
      revision: store.read().revision });
    const archived = store.read().data.offers.find((r) => r.id === sent);
    assert.equal(archived.status, "shared");
    assert.equal(archived.archived, true);
    for (const key of ["number", "scope", "terms", "price", "validUntil"])
      assert.equal(archived[key], original[key]);
  } finally { store.close(); }
});

test("expired shared records survive file restart and validated restore without freezing the workspace", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-24T12:00:00Z") });
  const folder = mkdtempSync(join(tmpdir(), "offerpath-expiry-"));
  const path = join(folder, "workspace.sqlite");
  let store = new WorkStore(definition, path);
  const restored = new WorkStore(definition);
  try {
    const id = save(store, offer("SYNTHETIC-HISTORY"));
    save(store, offer("SYNTHETIC-HISTORY", "shared"), id);
    const copy = store.export(), before = store.read(), events = audit(store);
    store.close();
    t.mock.timers.setTime(Date.parse("2026-10-26T12:00:00Z"));
    store = new WorkStore(definition, path);
    assert.deepEqual(store.read(), before);
    assert.deepEqual(audit(store), events);
    restored.restore(copy);
    assert.deepEqual(restored.read().data, before.data);
    assert.deepEqual(restored.read().computed, before.computed);
    for (const target of [store, restored]) {
      save(target, offer("SYNTHETIC-AFTER-EXPIRY"));
      assert.deepEqual(target.read().data.offers[0], before.data.offers[0]);
      save(target, offer("SYNTHETIC-HISTORY"), id);
      rejectUnchanged(target, () => save(target, offer("SYNTHETIC-HISTORY", "shared"), id), /истёк/);
      save(target, { ...offer("SYNTHETIC-HISTORY"), validUntil: "2026-10-30" }, id);
      save(target, { ...offer("SYNTHETIC-HISTORY", "shared"), validUntil: "2026-10-30" }, id);
    }
  } finally {
    store.close(); restored.close(); rmSync(folder, { recursive: true, force: true });
  }
});
