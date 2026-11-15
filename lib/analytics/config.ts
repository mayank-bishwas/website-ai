export type Ga4PropertyConfig = { propertyId: string; sourceLabel: string };
export type SearchConsolePropertyConfig = { propertyUrl: string; sourceLabel: string };

export function getGa4PropertyConfig(
  propertyIdValue: string | undefined,
  labelValue?: string,
): Ga4PropertyConfig {
  if (!propertyIdValue || !/^\d{1,20}$/.test(propertyIdValue)) {
    throw new Error("GA4 property configuration is missing or invalid.");
  }
  const defaultLabel = propertyIdValue === "560092767"
    ? "FrenglishPass test property"
    : `GA4 property ${propertyIdValue}`;
  return { propertyId: propertyIdValue, sourceLabel: labelValue?.trim() || defaultLabel };
}

export function getSearchConsolePropertyConfig(
  propertyUrlValue: string | undefined,
  labelValue?: string,
): SearchConsolePropertyConfig {
  if (!propertyUrlValue) throw new Error("Search Console property configuration is missing.");

  const domainProperty = /^sc-domain:([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/i.exec(propertyUrlValue);
  if (domainProperty) {
    const normalized = `sc-domain:${domainProperty[1].toLowerCase()}`;
    const defaultLabel = normalized === "sc-domain:frenglishpass.store"
      ? "FrenglishPass test property"
      : normalized;
    return { propertyUrl: normalized, sourceLabel: labelValue?.trim() || defaultLabel };
  }

  try {
    const url = new URL(propertyUrlValue);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) throw new Error("invalid Search Console property");
    const normalized = `${url.origin}${url.pathname}`;
    return { propertyUrl: normalized, sourceLabel: labelValue?.trim() || normalized };
  } catch {
    throw new Error("Search Console property configuration is invalid.");
  }
}
