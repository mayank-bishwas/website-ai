import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const expectedProjectId = "cnewytssajkrtrenvlgz";
const tableNames = [
  "conversations",
  "inventory_audit_logs",
  "messages",
  "product_families",
  "products",
] as const;

type CheckStatus = "passed" | "failed" | "not_checked";

function check(status: CheckStatus, message: string) {
  return { status, message };
}

function isExpectedProjectUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === `${expectedProjectId}.supabase.co` &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export async function GET() {
  const supabaseUrl = process.env.SHAHI_MEVA_SUPABASE_URL;
  const secretKey = process.env.SHAHI_MEVA_SUPABASE_SECRET_KEY;
  const urlConfigured = Boolean(supabaseUrl);
  const secretConfigured = Boolean(secretKey);
  const urlMatchesProject = Boolean(supabaseUrl && isExpectedProjectUrl(supabaseUrl));
  const tableChecks: Record<string, ReturnType<typeof check>> = Object.fromEntries(
    tableNames.map((name) => [name, check("not_checked", "Not checked.")]),
  );
  let storageBucketCheck = check("not_checked", "Not checked.");

  const configurationCheck = {
    ...check(
      urlConfigured && secretConfigured ? "passed" : "failed",
      urlConfigured && secretConfigured
        ? "Supabase URL and secret key are configured."
        : "Supabase URL or secret key is missing.",
    ),
    url_configured: urlConfigured,
    secret_key_configured: secretConfigured,
  };
  const projectUrlCheck = urlMatchesProject
    ? check("passed", "URL belongs to the expected Supabase project.")
    : check("failed", "URL does not match the expected Supabase project.");

  if (!urlConfigured || !secretConfigured || !urlMatchesProject || !supabaseUrl || !secretKey) {
    return Response.json(
      {
        status: "failed",
        project_id: expectedProjectId,
        checks: {
          configuration: configurationCheck,
          project_url: projectUrlCheck,
          tables: tableChecks,
          storage_bucket: storageBucketCheck,
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const supabase = createSupabaseServerClient();
    const [tableResults, bucketResult] = await Promise.all([
      Promise.all(
        tableNames.map(async (tableName) => {
          const { error } = await supabase
            .from(tableName)
            .select("*", { head: true, count: "exact" })
            .limit(0);

          return error
            ? check("failed", "Table query failed.")
            : check("passed", "Table exists and can be queried.");
        }),
      ),
      supabase.storage.getBucket("product-images"),
    ]);

    tableNames.forEach((tableName, index) => {
      tableChecks[tableName] = tableResults[index];
    });
    storageBucketCheck = bucketResult.error
      ? check("failed", "Storage bucket is missing or cannot be queried.")
      : check("passed", "Storage bucket exists and can be queried.");

    const passed =
      Object.values(tableChecks).every((tableCheck) => tableCheck.status === "passed") &&
      storageBucketCheck.status === "passed";

    return Response.json(
      {
        status: passed ? "connected" : "failed",
        project_id: expectedProjectId,
        checks: {
          configuration: configurationCheck,
          project_url: projectUrlCheck,
          tables: tableChecks,
          storage_bucket: storageBucketCheck,
        },
      },
      { status: passed ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        status: "failed",
        project_id: expectedProjectId,
        checks: {
          configuration: configurationCheck,
          project_url: projectUrlCheck,
          tables: tableChecks,
          storage_bucket: storageBucketCheck,
          connection: check("failed", "Supabase connection could not be established."),
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
