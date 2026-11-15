import assert from "node:assert/strict";
import test from "node:test";
import { answerAsk } from "../lib/ask/answer.ts";

const catalogFixture = [
  { sku: "01A", name: "Kaju", description: "Plain cashews", variant: "500 g", price: 550, availability: "out_of_stock", familyName: "Nuts" },
  { sku: "01B", name: "Badam", description: "Almonds", variant: "200 g", price: 800, availability: "in_stock", familyName: "Nuts" },
];

const knowledgeFixture = [{ id: 8, content: "Store hours are every day from 8:00 AM to 8:30 PM." }];

const websiteFixture = [{ source_url: "/about", content: "Welcome to our store!" }];

function makeInput(getCatalog, getKnowledge, getWebsiteContent, question) {
  let capturedPrompt = "";
  return {
    question,
    history: [],
    getCatalog,
    getKnowledge,
    getWebsiteContent,
    primary: { provider: "gemini", model: "gemini-test" },
    fallback: { provider: "openrouter", model: "fallback-test" },
    invoke: async (_config, prompt) => {
      capturedPrompt = prompt ?? "";
      return "Mock provider response for " + question;
    },
    getPrompt: () => capturedPrompt,
  };
}

test("ASK retrieves all three approved sources from Supabase", async () => {
  const input = makeInput(
    async () => catalogFixture,
    async () => knowledgeFixture,
    async () => websiteFixture,
    "What products do you have?"
  );
  const result = await answerAsk(input);

  assert.equal(result.status, "completed");
  const parsed = JSON.parse(input.getPrompt());
  assert.equal(parsed.source_results.length, 3);
  assert.ok(parsed.source_results.some(s => s.source === "inventory"));
  assert.ok(parsed.source_results.some(s => s.source === "knowledge-base"));
  assert.ok(parsed.source_results.some(s => s.source === "website"));
});

test("ASK retrieves published knowledge entries only", async () => {
  const input = makeInput(
    async () => catalogFixture,
    async () => knowledgeFixture,
    async () => websiteFixture,
    "What are your store hours?"
  );
  const result = await answerAsk(input);

  assert.equal(result.status, "completed");
  const parsed = JSON.parse(input.getPrompt());
  const knowledgeSource = parsed.source_results.find(s => s.source === "knowledge-base");
  assert.ok(knowledgeSource);
  assert.ok(knowledgeSource.data.length > 0);
});

test("ASK retrieves active website content only", async () => {
  const input = makeInput(
    async () => catalogFixture,
    async () => knowledgeFixture,
    async () => websiteFixture,
    "What are your store hours?"
  );
  const result = await answerAsk(input);

  assert.equal(result.status, "completed");
  const parsed = JSON.parse(input.getPrompt());
  const websiteSource = parsed.source_results.find(s => s.source === "website");
  assert.ok(websiteSource);
  assert.ok(websiteSource.data.length > 0);
});
