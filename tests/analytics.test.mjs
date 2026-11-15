import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildGa4ReportPlan, buildSearchConsoleReportPlan, validateGa4ReportPlan } from "../lib/analytics/plans.ts";
import { runGa4Report } from "../lib/analytics/ga4.ts";
import { runSearchConsoleReport } from "../lib/analytics/search-console.ts";
import { getGa4PropertyConfig, getSearchConsolePropertyConfig } from "../lib/analytics/config.ts";
import { decodeServiceAccountCredentials, GA4_READONLY_SCOPE, SEARCH_CONSOLE_READONLY_SCOPE } from "../lib/google/credentials.ts";
import { requestGoogleAccessToken } from "../lib/google/token.ts";
import { GoogleServiceError } from "../lib/google/errors.ts";
import { resolvePublicationStatus } from "../lib/inventory/publication-status.mjs";

const now = new Date("2026-11-09T10:00:00Z");

test("GA4 plans allow only supported metrics and dimensions with date comparison", () => {
  const plan = buildGa4ReportPlan("Compare active users and sessions by source / medium for last 7 days", now);
  assert.deepEqual(plan.dateRanges, [
    { startDate: "2026-11-02", endDate: "2026-11-08" },
    { startDate: "2026-10-26", endDate: "2026-11-01" },
  ]);
  assert.deepEqual(plan.metrics, ["activeUsers", "sessions"]);
  assert.deepEqual(plan.dimensions, ["sessionSourceMedium"]);
  assert.throws(() => validateGa4ReportPlan({ ...plan, metrics: ["arbitrarySql"] }), /metrics are not supported/);
  assert.throws(() => buildGa4ReportPlan("sessions for last 400 days", now), /1 to 366 days/);
});

test("Search Console plans use complete days, supported dimensions, and bounded rows", () => {
  const plan = buildSearchConsoleReportPlan("Compare clicks for queries and pages last 7 days", now);
  assert.deepEqual(plan.dateRanges[0], { startDate: "2026-10-31", endDate: "2026-11-06" });
  assert.deepEqual(plan.dimensions, ["query", "page"]);
  assert.equal(plan.rowLimit, 20);
});

test("GA4 adapter maps only requested response fields to safe structured data", async () => {
  const property = getGa4PropertyConfig("560092767");
  let request;
  const plan = { dateRanges: [{ startDate: "2026-11-01", endDate: "2026-11-07" }], metrics: ["sessions"], dimensions: ["sessionSourceMedium"], limit: 20 };
  const report = await runGa4Report(property, plan, async (url, body) => {
    request = { url, body };
    return { dimensionHeaders: [{ name: "sessionSourceMedium" }], metricHeaders: [{ name: "sessions" }], rows: [{ dimensionValues: [{ value: "google / organic" }], metricValues: [{ value: "12" }]}], rowCount: 21, metadata: { subjectToThresholding: true } };
  });
  assert.match(request.url, /properties\/560092767:runReport$/);
  assert.equal(request.body.limit, 20);
  assert.deepEqual(report.rows, [{ sessionSourceMedium: "google / organic", sessions: 12 }]);
  assert.equal(report.truncated, true);
  assert.equal(report.subjectToThresholding, true);
  await assert.rejects(runGa4Report(property, plan, async () => ({ dimensionHeaders: [], metricHeaders: [{ name: "sessions" }], rows: [{ metricValues: [{ value: "Infinity" }] }] })), (error) => error instanceof GoogleServiceError);
});

test("Search Console adapter fixes property URL and maps comparison periods and metrics", async () => {
  const property = getSearchConsolePropertyConfig("sc-domain:frenglishpass.store");
  const plan = { dateRanges: [{ startDate: "2026-10-30", endDate: "2026-11-06" }, { startDate: "2026-10-22", endDate: "2026-10-29" }], dimensions: ["query"], rowLimit: 20 };
  const calls = [];
  const report = await runSearchConsoleReport(property, plan, async (url, body) => {
    calls.push({ url, body });
    return { rows: [{ keys: ["kaju"], clicks: 5, impressions: 100, ctr: 0.05, position: 4.2 }] };
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /sc-domain%3Afrenglishpass.store/);
  assert.equal(calls[0].body.dataState, "final");
  assert.deepEqual(report.periods[0].rows, [{ query: "kaju", clicks: 5, impressions: 100, ctr: 0.05, position: 4.2 }]);
  assert.equal(report.sourceLabel, "FrenglishPass test property");
  assert.match(report.note, /top rows/);
});

test("Google property configuration restricts identifiers and keeps the FrenglishPass label", () => {
  assert.equal(getGa4PropertyConfig("560092767").sourceLabel, "FrenglishPass test property");
  assert.equal(getSearchConsolePropertyConfig("sc-domain:frenglishpass.store").sourceLabel, "FrenglishPass test property");
  assert.throws(() => getGa4PropertyConfig("560092767:runReport"), /missing or invalid/);
  assert.throws(() => getSearchConsolePropertyConfig("https://attacker.test/?property=sc-domain:frenglishpass.store"), /invalid/);
});

test("service-account credentials are validated without exposing their contents", async () => {
  assert.throws(() => decodeServiceAccountCredentials(undefined), (error) => error instanceof GoogleServiceError && error.reason === "credentials_missing");
  assert.throws(() => decodeServiceAccountCredentials(Buffer.from("not-json").toString("base64")), (error) => error instanceof GoogleServiceError && error.reason === "credentials_invalid");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credentialsJson = JSON.stringify({ type: "service_account", client_email: "reporter@example.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "https://oauth2.googleapis.com/token" });
  const credentials = decodeServiceAccountCredentials(Buffer.from(credentialsJson).toString("base64"));
  assert.equal(credentials.clientEmail, "reporter@example.iam.gserviceaccount.com");
  await assert.rejects(requestGoogleAccessToken(credentials, ["https://www.googleapis.com/auth/cloud-platform"], async () => Response.json({})), (error) => error instanceof GoogleServiceError);
});

test("token exchange uses only requested read-only scopes and hides credential material", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credentials = { clientEmail: "reporter@example.iam.gserviceaccount.com", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), tokenUri: "https://oauth2.googleapis.com/token" };
  let captured;
  const token = await requestGoogleAccessToken(credentials, [GA4_READONLY_SCOPE, SEARCH_CONSOLE_READONLY_SCOPE], async (url, options) => {
    captured = { url, options };
    return Response.json({ access_token: "mock-access-token", expires_in: 3600 });
  }, () => 1_800_000_000_000);
  assert.equal(token, "mock-access-token");
  assert.equal(captured.url, "https://oauth2.googleapis.com/token");
  assert.doesNotMatch(String(captured.options.body), /PRIVATE KEY/);
  const assertion = new URLSearchParams(captured.options.body).get("assertion");
  const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString());
  assert.equal(claims.scope, `${GA4_READONLY_SCOPE} ${SEARCH_CONSOLE_READONLY_SCOPE}`);
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
});

test("new imported products publish by default while explicit drafts stay drafts", () => {
  assert.equal(resolvePublicationStatus({}), "published");
  assert.equal(resolvePublicationStatus({ publicationStatus: "draft" }), "draft");
  assert.equal(resolvePublicationStatus({ publication_status: "draft" }), "draft");
  assert.equal(resolvePublicationStatus({ publicationStatus: "published" }), "published");
  assert.equal(resolvePublicationStatus({ publicationStatus: "pending" }), null);
  assert.equal(resolvePublicationStatus({ publicationStatus: "draft", publication_status: "published" }), null);
});


test("publishing migration is bounded to the exact 15 imported SKUs", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261109130000_publish_initial_shahi_meva_inventory.sql", import.meta.url), "utf8");
  const skuList = sql.match(/imported_skus text\[\] := array\[([\s\S]*?)\];/);
  assert.ok(skuList);
  const skus = [...skuList[1].matchAll(/'([0-9]{2}[A-C])'/g)].map((match) => match[1]);
  assert.equal(skus.length, 15);
  assert.deepEqual(skus, ["01A", "01B", "01C", "02A", "02B", "02C", "03A", "03B", "03C", "04A", "04B", "04C", "05A", "05B", "05C"]);
  assert.match(sql, /where sku = any\(imported_skus\)[\s\S]*?and archived_at is null[\s\S]*?and publication_status = 'draft'/);
  assert.match(sql, /alter column publication_status set default 'published'/);
});


test("publication migration fixes both identity-trigger branches before its product update", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261109130000_publish_initial_shahi_meva_inventory.sql", import.meta.url), "utf8");
  const functionMatch = sql.match(/create or replace function public\.protect_catalog_identity\(\)([\s\S]*?)\$\$;/i);
  assert.ok(functionMatch);
  const functionSql = functionMatch[1];
  assert.match(functionSql, /set search_path = ''/i);
  const familyBranch = functionSql.match(/if tg_table_name = 'product_families' then([\s\S]*?)elsif tg_table_name = 'products' then/i)?.[1];
  const productBranch = functionSql.match(/elsif tg_table_name = 'products' then([\s\S]*?)end if;/i)?.[1];
  assert.ok(familyBranch);
  assert.ok(productBranch);
  assert.match(familyBranch, /new\.family_code[\s\S]*old\.family_code/);
  assert.doesNotMatch(familyBranch, /\b(?:new|old)\.(?:sku|family_id)\b/);
  assert.match(productBranch, /new\.sku[\s\S]*old\.sku[\s\S]*new\.family_id[\s\S]*old\.family_id/);
  assert.doesNotMatch(productBranch, /\b(?:new|old)\.family_code\b/);
  assert.ok(sql.indexOf("create or replace function") < sql.indexOf("update public.products"));
  assert.match(sql, /Product family codes are immutable\./);
  assert.match(sql, /Product SKUs and family assignments are immutable\./);
});
