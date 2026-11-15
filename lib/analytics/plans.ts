export type ReportRange = { startDate: string; endDate: string };
export type Ga4Metric = "activeUsers" | "sessions" | "screenPageViews" | "newUsers";
export type Ga4Dimension = "sessionSourceMedium" | "landingPagePlusQueryString";
export type SearchConsoleDimension = "query" | "page";

export type Ga4ReportPlan = {
  dateRanges: ReportRange[];
  metrics: Ga4Metric[];
  dimensions: Ga4Dimension[];
  limit: number;
};

export type SearchConsoleReportPlan = {
  dateRanges: ReportRange[];
  dimensions: SearchConsoleDimension[];
  rowLimit: number;
};

export class ReportPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportPlanError";
  }
}

const ga4Metrics = new Set<Ga4Metric>(["activeUsers", "sessions", "screenPageViews", "newUsers"]);
const ga4Dimensions = new Set<Ga4Dimension>(["sessionSourceMedium", "landingPagePlusQueryString"]);
const gscDimensions = new Set<SearchConsoleDimension>(["query", "page"]);
const MAX_DAYS = 366;

function asDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, count: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + count);
  return result;
}

function inclusiveDays(range: ReportRange): number {
  const start = asDate(range.startDate);
  const end = asDate(range.endDate);
  if (!start || !end || start > end) throw new ReportPlanError("Use a valid date range in YYYY-MM-DD format.");
  return Math.floor((end.valueOf() - start.valueOf()) / 86_400_000) + 1;
}

function parseRequestedRange(question: string, today: Date, lagDays: number): ReportRange {
  const explicit = question.match(/\b(\d{4}-\d{2}-\d{2})\s+(?:to|through|until)\s+(\d{4}-\d{2}-\d{2})\b/i);
  const endDefault = addDays(today, -lagDays);

  if (explicit) return { startDate: explicit[1], endDate: explicit[2] };

  const duration = question.match(/\b(?:last|past|previous|over the last)\s+(\d{1,3})\s+days?\b/i);
  const days = duration ? Number(duration[1]) : 7;
  if (days < 1 || days > MAX_DAYS) {
    throw new ReportPlanError(`Choose a date range from 1 to ${MAX_DAYS} days.`);
  }

  return {
    startDate: formatDate(addDays(endDefault, -(days - 1))),
    endDate: formatDate(endDefault),
  };
}

function addPreviousRange(current: ReportRange): ReportRange {
  const days = inclusiveDays(current);
  const end = asDate(current.startDate)!;
  const previousEnd = addDays(end, -1);
  return {
    startDate: formatDate(addDays(previousEnd, -(days - 1))),
    endDate: formatDate(previousEnd),
  };
}

function asksForComparison(question: string): boolean {
  return /\b(compare|comparison|compared with|compared to|versus|vs\.?|previous period|prior period)\b/i.test(question);
}

function validateRanges(ranges: ReportRange[], today: Date): void {
  for (const range of ranges) {
    const days = inclusiveDays(range);
    if (days > MAX_DAYS) throw new ReportPlanError(`Choose a date range of no more than ${MAX_DAYS} days.`);
    if (asDate(range.endDate)! > today) throw new ReportPlanError("Future dates are not available in these reports.");
  }
}

export function buildGa4ReportPlan(question: string, now = new Date()): Ga4ReportPlan {
  const today = new Date(`${formatDate(now)}T00:00:00.000Z`);
  const current = parseRequestedRange(question, today, 1);
  const dateRanges = [current];
  if (asksForComparison(question)) dateRanges.push(addPreviousRange(current));
  validateRanges(dateRanges, today);

  const normalized = question.toLowerCase();
  const metrics = new Set<Ga4Metric>();
  if (/\b(active users?|visitors?|users?)\b/.test(normalized)) metrics.add("activeUsers");
  if (/\b(sessions?|traffic|source\s*\/\s*medium|acquisition)\b/.test(normalized)) metrics.add("sessions");
  if (/\b(views?|page views?|pageviews)\b/.test(normalized)) metrics.add("screenPageViews");
  if (/\bnew users?\b/.test(normalized)) metrics.add("newUsers");
  if (metrics.size === 0) {
    metrics.add("activeUsers");
    metrics.add("sessions");
  }

  const dimensions: Ga4Dimension[] = [];
  if (/\b(source\s*\/\s*medium|traffic sources?|acquisition|referrers?)\b/.test(normalized)) {
    dimensions.push("sessionSourceMedium");
  } else if (/\b(landing pages?|top pages?)\b/.test(normalized)) {
    dimensions.push("landingPagePlusQueryString");
  }

  const plan: Ga4ReportPlan = {
    dateRanges,
    metrics: [...metrics],
    dimensions,
    limit: dimensions.length ? 20 : 1,
  };
  validateGa4ReportPlan(plan, today);
  return plan;
}

export function validateGa4ReportPlan(plan: Ga4ReportPlan, today = new Date()): void {
  if (!Array.isArray(plan.dateRanges) || plan.dateRanges.length < 1 || plan.dateRanges.length > 2) {
    throw new ReportPlanError("GA4 reports accept one date range and an optional comparison range.");
  }
  validateRanges(plan.dateRanges, today);
  if (!Array.isArray(plan.metrics) || plan.metrics.length < 1 || plan.metrics.length > 4 || plan.metrics.some((metric) => !ga4Metrics.has(metric))) {
    throw new ReportPlanError("The requested GA4 metrics are not supported.");
  }
  if (!Array.isArray(plan.dimensions) || plan.dimensions.length > 1 || plan.dimensions.some((dimension) => !ga4Dimensions.has(dimension))) {
    throw new ReportPlanError("The requested GA4 breakdown is not supported.");
  }
  if (!Number.isInteger(plan.limit) || plan.limit < 1 || plan.limit > 20) {
    throw new ReportPlanError("GA4 report row limits must be between 1 and 20.");
  }
}

export function buildSearchConsoleReportPlan(question: string, now = new Date()): SearchConsoleReportPlan {
  const today = new Date(`${formatDate(now)}T00:00:00.000Z`);
  const current = parseRequestedRange(question, today, 3);
  const dateRanges = [current];
  if (asksForComparison(question)) dateRanges.push(addPreviousRange(current));
  validateRanges(dateRanges, today);

  const normalized = question.toLowerCase();
  const asksQueries = /\b(queries|query|search terms?|keywords?)\b/.test(normalized);
  const asksPages = /\b(pages?|landing pages?)\b/.test(normalized);
  const dimensions: SearchConsoleDimension[] = [];
  if (asksQueries) dimensions.push("query");
  if (asksPages) dimensions.push("page");

  const plan: SearchConsoleReportPlan = {
    dateRanges,
    dimensions,
    rowLimit: dimensions.length ? 20 : 1,
  };
  validateSearchConsoleReportPlan(plan, today);
  return plan;
}

export function validateSearchConsoleReportPlan(plan: SearchConsoleReportPlan, today = new Date()): void {
  if (!Array.isArray(plan.dateRanges) || plan.dateRanges.length < 1 || plan.dateRanges.length > 2) {
    throw new ReportPlanError("Search Console reports accept one date range and an optional comparison range.");
  }
  validateRanges(plan.dateRanges, today);
  if (!Array.isArray(plan.dimensions) || plan.dimensions.length > 2 || plan.dimensions.some((dimension) => !gscDimensions.has(dimension))) {
    throw new ReportPlanError("The requested Search Console breakdown is not supported.");
  }
  if (new Set(plan.dimensions).size !== plan.dimensions.length) {
    throw new ReportPlanError("The requested Search Console breakdown contains duplicates.");
  }
  if (!Number.isInteger(plan.rowLimit) || plan.rowLimit < 1 || plan.rowLimit > 20) {
    throw new ReportPlanError("Search Console row limits must be between 1 and 20.");
  }
}
