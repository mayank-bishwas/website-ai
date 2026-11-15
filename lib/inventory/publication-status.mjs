export function resolvePublicationStatus(sourceProduct) {
  const snakeCaseValue = sourceProduct.publication_status;
  const camelCaseValue = sourceProduct.publicationStatus;

  if (
    (snakeCaseValue !== undefined && !["draft", "published"].includes(snakeCaseValue)) ||
    (camelCaseValue !== undefined && !["draft", "published"].includes(camelCaseValue)) ||
    (snakeCaseValue !== undefined && camelCaseValue !== undefined && snakeCaseValue !== camelCaseValue)
  ) {
    return null;
  }

  return snakeCaseValue ?? camelCaseValue ?? "published";
}
