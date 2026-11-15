import type { GoogleApiPost } from "../google/types.ts";
import { GoogleServiceError } from "../google/errors.ts";
import { validateGa4ReportPlan, type Ga4ReportPlan } from "./plans.ts";
import type { Ga4PropertyConfig } from "./config.ts";

type Ga4ApiResponse = {
  dimensionHeaders?: Array<{ name?: unknown }>;
  metricHeaders?: Array<{ name?: unknown }>;
  rows?: Array<{
    dimensionValues?: Array<{ value?: unknown }>;
    metricValues?: Array<{ value?: unknown }>;
  }>;
  rowCount?: number;
  metadata?: {
    dataLossFromOtherRow?: boolean;
    subjectToThresholding?: boolean;
  };
};

export type Ga4ReportResult = {
  source: "ga4";
  propertyId: string;
  sourceLabel: string;
  dateRanges: Ga4ReportPlan["dateRanges"];
  metrics: Ga4ReportPlan["metrics"];
  dimensions: Ga4ReportPlan["dimensions"];
  rows: Array<Record<string, string | number>>;
  empty: boolean;
  truncated: boolean;
  subjectToThresholding: boolean;
  dataLossFromOtherRow: boolean;
};

function mapGa4Response(payload: unknown, plan: Ga4ReportPlan, property: Ga4PropertyConfig): Ga4ReportResult {
  const response = payload as Ga4ApiResponse;
  const dimensionHeaders = response.dimensionHeaders?.map((header) => header.name);
  const metricHeaders = response.metricHeaders?.map((header) => header.name);
  if (
    !dimensionHeaders ||
    !metricHeaders ||
    dimensionHeaders.some((name) => typeof name !== "string") ||
    metricHeaders.some((name) => typeof name !== "string") ||
    metricHeaders.length !== plan.metrics.length
  ) {
    throw new GoogleServiceError("invalid_response");
  }

  const rows = (response.rows ?? []).map((row) => {
    const dimensionValues = row.dimensionValues ?? [];
    const metricValues = row.metricValues ?? [];
    if (dimensionValues.length !== dimensionHeaders.length || metricValues.length !== metricHeaders.length) {
      throw new GoogleServiceError("invalid_response");
    }
    const mapped: Record<string, string | number> = {};
    dimensionHeaders.forEach((name, index) => {
      const value = dimensionValues[index]?.value;
      if (typeof value !== "string") throw new GoogleServiceError("invalid_response");
      mapped[name as string] = value;
    });
    metricHeaders.forEach((name, index) => {
      const value = metricValues[index]?.value;
      const numeric = typeof value === "string" ? Number(value) : Number.NaN;
      if (!Number.isFinite(numeric)) throw new GoogleServiceError("invalid_response");
      mapped[name as string] = numeric;
    });
    return mapped;
  });

  return {
    source: "ga4",
    propertyId: property.propertyId,
    sourceLabel: property.sourceLabel,
    dateRanges: plan.dateRanges,
    metrics: plan.metrics,
    dimensions: plan.dimensions,
    rows,
    empty: rows.length === 0,
    truncated: typeof response.rowCount === "number" && response.rowCount > rows.length,
    subjectToThresholding: response.metadata?.subjectToThresholding === true,
    dataLossFromOtherRow: response.metadata?.dataLossFromOtherRow === true,
  };
}

export async function runGa4Report(
  property: Ga4PropertyConfig,
  plan: Ga4ReportPlan,
  postJson: GoogleApiPost,
): Promise<Ga4ReportResult> {
  validateGa4ReportPlan(plan);
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${property.propertyId}:runReport`;
  const body = {
    dateRanges: plan.dateRanges,
    metrics: plan.metrics.map((name) => ({ name })),
    dimensions: plan.dimensions.map((name) => ({ name })),
    limit: plan.limit,
    ...(plan.dimensions.length
      ? { orderBys: [{ metric: { metricName: plan.metrics[0] }, desc: true }] }
      : {}),
  };
  const payload = await postJson(url, body);
  return mapGa4Response(payload, plan, property);
}
