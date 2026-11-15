import type { GoogleApiPost } from "../google/types.ts";
import { GoogleServiceError } from "../google/errors.ts";
import { validateSearchConsoleReportPlan, type SearchConsoleReportPlan } from "./plans.ts";
import type { SearchConsolePropertyConfig } from "./config.ts";

type SearchConsoleApiRow = {
  keys?: unknown[];
  clicks?: unknown;
  impressions?: unknown;
  ctr?: unknown;
  position?: unknown;
};

type SearchConsoleApiResponse = { rows?: SearchConsoleApiRow[] };

type SearchConsolePeriod = {
  dateRange: SearchConsoleReportPlan["dateRanges"][number];
  rows: Array<Record<string, string | number>>;
  empty: boolean;
};

export type SearchConsoleReportResult = {
  source: "search-console";
  propertyUrl: string;
  sourceLabel: string;
  dimensions: SearchConsoleReportPlan["dimensions"];
  periods: SearchConsolePeriod[];
  empty: boolean;
  note: string;
};

function numeric(value: unknown): number {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(result)) throw new GoogleServiceError("invalid_response");
  return result;
}

function mapRows(payload: unknown, plan: SearchConsoleReportPlan): Array<Record<string, string | number>> {
  const response = payload as SearchConsoleApiResponse;
  if (response.rows !== undefined && !Array.isArray(response.rows)) {
    throw new GoogleServiceError("invalid_response");
  }

  return (response.rows ?? []).map((row) => {
    const keys = row.keys ?? [];
    if (keys.length !== plan.dimensions.length || keys.some((key) => typeof key !== "string")) {
      throw new GoogleServiceError("invalid_response");
    }
    const mapped: Record<string, string | number> = {};
    plan.dimensions.forEach((dimension, index) => {
      mapped[dimension] = keys[index] as string;
    });
    mapped.clicks = numeric(row.clicks);
    mapped.impressions = numeric(row.impressions);
    mapped.ctr = numeric(row.ctr);
    mapped.position = numeric(row.position);
    return mapped;
  });
}

export async function runSearchConsoleReport(
  property: SearchConsolePropertyConfig,
  plan: SearchConsoleReportPlan,
  postJson: GoogleApiPost,
): Promise<SearchConsoleReportResult> {
  validateSearchConsoleReportPlan(plan);
  const encodedProperty = encodeURIComponent(property.propertyUrl);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodedProperty}/searchAnalytics/query`;
  const periods = await Promise.all(plan.dateRanges.map(async (dateRange) => {
    const payload = await postJson(url, {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      ...(plan.dimensions.length ? { dimensions: plan.dimensions } : {}),
      rowLimit: plan.rowLimit,
      dataState: "final",
    });
    const rows = mapRows(payload, plan);
    return { dateRange, rows, empty: rows.length === 0 };
  }));

  return {
    source: "search-console",
    propertyUrl: property.propertyUrl,
    sourceLabel: property.sourceLabel,
    dimensions: plan.dimensions,
    periods,
    empty: periods[0].empty,
    note: "Search Console returns top rows only and can omit low-volume or recently delayed data.",
  };
}
