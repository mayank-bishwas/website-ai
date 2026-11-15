import test from "node:test";
import assert from "node:assert/strict";
import { mapKnowledgeRecords } from "../lib/portal-knowledge.ts";

test("maps database UUIDs and statuses to the Knowledge Base view model", () => {
  const entries = mapKnowledgeRecords([
    {
      id: "11111111-1111-4111-8111-111111111111",
      updated_at: "2026-11-12T10:30:00.000Z",
      content: "Published answer",
      status: "published",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      updated_at: "2026-11-12T11:45:00.000Z",
      content: "Archived answer",
      status: "archived",
    },
  ]);

  assert.equal(entries[0].id, 1);
  assert.equal(entries[0].recordId, "11111111-1111-4111-8111-111111111111");
  assert.equal(entries[0].archived, false);
  assert.equal(entries[0].content, "Published answer");
  assert.equal(entries[1].id, 2);
  assert.equal(entries[1].recordId, "22222222-2222-4222-8222-222222222222");
  assert.equal(entries[1].archived, true);
  assert.equal(entries[1].content, "Archived answer");
  assert.match(entries[0].updated, /2026/);
  assert.notEqual(entries[0].updatedTime, "");
});
