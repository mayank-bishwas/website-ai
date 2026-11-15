import assert from "node:assert/strict";
import test from "node:test";

import { isValidCustomerSessionId, getCustomerMerchantSlug, insertCustomerMessage } from "../lib/customer/logging.ts";

function fakeSupabase({ insertResult } = {}) {
  const calls = [];
  const builder = {
    insert(value) {
      calls.push(["insert", value]);
      return Promise.resolve(insertResult ?? { error: null });
    },
  };
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      return builder;
    },
  };
}

test("session id validation accepts UUIDs and fallback ids, rejects invalid values", () => {
  assert.equal(isValidCustomerSessionId("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isValidCustomerSessionId("session-1731000000000-x7k9"), true);
  assert.equal(isValidCustomerSessionId("a".repeat(128)), true);
  assert.equal(isValidCustomerSessionId(""), false);
  assert.equal(isValidCustomerSessionId("a".repeat(129)), false);
  assert.equal(isValidCustomerSessionId("has space"), false);
  assert.equal(isValidCustomerSessionId("has/slash"), false);
  assert.equal(isValidCustomerSessionId("has_underscore"), false);
  assert.equal(isValidCustomerSessionId(undefined), false);
  assert.equal(isValidCustomerSessionId(null), false);
  assert.equal(isValidCustomerSessionId(123), false);
});

test("merchant slug defaults to shahi-meva and honours CUSTOMER_MERCHANT_SLUG", () => {
  const original = process.env.CUSTOMER_MERCHANT_SLUG;
  delete process.env.CUSTOMER_MERCHANT_SLUG;
  assert.equal(getCustomerMerchantSlug(), "shahi-meva");
  process.env.CUSTOMER_MERCHANT_SLUG = "other-merchant";
  assert.equal(getCustomerMerchantSlug(), "other-merchant");
  if (original === undefined) delete process.env.CUSTOMER_MERCHANT_SLUG;
  else process.env.CUSTOMER_MERCHANT_SLUG = original;
});

test("customer and assistant messages insert into customer_messages with the same session id", async () => {
  const supabase = fakeSupabase();
  await insertCustomerMessage(supabase, { sessionId: "session-1", sender: "customer", messageText: "Kaju price?", status: "sent" });
  await insertCustomerMessage(supabase, { sessionId: "session-1", sender: "assistant", messageText: "₹550", status: "completed", metadata: { provider: "gemini", model: "gemini-3.6-flash", duration_ms: 1200 } });

  const fromCalls = supabase.calls.filter((call) => call[0] === "from");
  assert.deepEqual(fromCalls.map((call) => call[1]), ["customer_messages", "customer_messages"]);

  const inserts = supabase.calls.filter((call) => call[0] === "insert").map((call) => call[1]);
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].session_id, "session-1");
  assert.equal(inserts[0].sender, "customer");
  assert.equal(inserts[0].status, "sent");
  assert.equal(inserts[0].merchant_slug, "shahi-meva");
  assert.equal(inserts[0].message_text, "Kaju price?");
  assert.deepEqual(inserts[0].metadata, {});
  assert.equal(inserts[1].session_id, "session-1");
  assert.equal(inserts[1].sender, "assistant");
  assert.equal(inserts[1].status, "completed");
  assert.deepEqual(inserts[1].metadata, { provider: "gemini", model: "gemini-3.6-flash", duration_ms: 1200 });
});

test("logging failures are swallowed and never throw", async () => {
  const failing = {
    from() {
      return {
        insert() {
          return Promise.resolve({ error: { code: "42P01", message: "relation does not exist" } });
        },
      };
    },
  };
  await insertCustomerMessage(failing, { sessionId: "session-1", sender: "customer", messageText: "hi", status: "sent" });

  const throwing = {
    from() {
      throw new Error("connection refused");
    },
  };
  await insertCustomerMessage(throwing, { sessionId: "session-1", sender: "customer", messageText: "hi", status: "sent" });
});
