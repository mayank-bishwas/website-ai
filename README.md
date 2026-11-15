# iSellOnline Website Agent prototype

A desktop-first Next.js and TypeScript prototype for the Shahi Meva Website Assistant. ASK uses a local-development-only API backed by published Supabase inventory, the page-session Knowledge Base, Gemini, and an OpenRouter fallback. Conversation context stays in memory and is cleared when ASK is left or the page is refreshed. EDIT remains a mock workflow.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Run `npm run typecheck` to check TypeScript or `npm run build` to create a production build.

## Supabase setup

The pilot project is `shahi_meva` (`cnewytssajkrtrenvlgz`) at `https://cnewytssajkrtrenvlgz.supabase.co`.

1. The repository root `.env` is Git-ignored. Set `SHAHI_MEVA_SUPABASE_URL` to `https://cnewytssajkrtrenvlgz.supabase.co`. `.env.example` documents the expected variable names and placeholders.
2. In the Supabase Dashboard, open **Project Settings → API Keys** and set `SHAHI_MEVA_SUPABASE_SECRET_KEY` to a secret key in `.env`. The `SHAHI_MEVA_SUPABASE_PUBLISHABLE_KEY` can remain there for future use; the Website Agent does not currently use it. Do not commit `.env` or expose the secret key in client-side code.
3. Set `GEMINI_API_KEY` and `OPENROUTER_API_KEY` in `.env`. ASK uses `GEMINI_MODEL` (default `gemini-3.6-flash`) with `OPENROUTER_MODEL` as its fallback (default `deepseek/deepseek-v4.1-flash-1017`). Provider selection and usage stay server-side and are not shown in the conversation UI. Voice transcription uses Google's `gemini-3.5-transcribe` model with `GEMINI_API_KEY`; it does not use the paid OpenRouter transcription endpoint. Never use a DeepSeek-issued key for OpenRouter. Both keys are only read in server-side modules.
4. For local read-only reporting, set `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` to the base64 encoding of the service account JSON, enable the Google Analytics Data API and Search Console API, grant the service account Viewer access to GA4 and access to the Search Console property, then set `GA4_PROPERTY_ID=560092767` and `GSC_PROPERTY_URL=sc-domain:frenglishpass.store`. `ANALYTICS_PROPERTY_LABEL` is optional. Set `ASK_PRICING_JSON` only when you have confirmed current per-model prices; it accepts a JSON map keyed by `provider/model` with `inputUsdPerMillionTokens`, `outputUsdPerMillionTokens`, and optional `cachedInputUsdPerMillionTokens`. Prices are USD per million tokens; unknown prices remain unavailable, with no defaults assumed. These are FrenglishPass test-property integrations, never Shahi Meva traffic. The service key and OAuth tokens stay server-side; do not put the JSON key in source control or client settings.
5. Restart the Next.js development server after changing environment variables. ASK is deliberately disabled in production and on Vercel until authentication and access control are implemented.
6. Apply `supabase/migrations/20261108120000_initial_shahi_meva_schema.sql` and `supabase/migrations/20261109130000_publish_initial_shahi_meva_inventory.sql` to the pilot project. With the Supabase CLI installed, run:

   ```bash
   supabase link --project-ref cnewytssajkrtrenvlgz
   supabase db push
   ```

   Alternatively, review and run the migration SQL in the Dashboard **SQL Editor**. The initial migration creates the schema, RLS protections, database SKU triggers, and a private `product-images` bucket. The second migration publishes only the initial 15 Shahi Meva SKUs (`01A`–`05C`) and changes the default for future products to published; it is repeatable and does not modify other product fields. Do not apply these migrations to a different project.
7. In **Storage → Buckets**, verify `product-images` is private, with a 5 MiB (5,242,880 byte) per-file limit and JPEG, PNG, WebP, or AVIF allowed. If provisioning the bucket manually instead of applying the migration, create it with those settings and keep object policies closed to anonymous/authenticated roles. The future upload workflow must allow at most two images per product; `image_3` is reserved for possible future use. Browser-side image compression/resizing will be implemented in that upload workflow before storage. No image upload is implemented yet.
8. Open [http://localhost:3000/api/health/supabase](http://localhost:3000/api/health/supabase). The endpoint reports configuration, project URL match, each of the five table checks, and the `product-images` bucket check. It returns no database records, credentials, or raw Supabase errors. All checks must pass for overall status `connected`; failed or skipped checks return HTTP 503.

All five tables have RLS enabled, with no `anon`/`authenticated` policies or table grants. ASK uses the server-side secret key only from a `server-only` module and reads only published, non-archived inventory. The current ASK API does not write or restore conversations from the existing `conversations` and `messages` tables.

The migration allocates family codes `01`–`99` and variant letters `A`–`Z` using transaction-scoped advisory locks. Family codes and SKUs are immutable, and catalog rows must be archived rather than hard-deleted to prevent identifier reuse.

Products default to `publication_status = 'published'`; the only valid states are `draft` and `published`. Import rows can explicitly set `publicationStatus: "draft"` when they should remain unpublished. Publication status is independent of `availability` (`in_stock` / `out_of_stock`). When the public Shahi Meva website is connected to this database, it must display only products whose publication status is `published`.

### Initial inventory import

The repeatable importer reads `/Users/believe/Documents/shahi_meva/inventory-data.js` and image files from that repository without modifying it. Override the source directory with `SHAHI_MEVA_SOURCE_DIR` if needed. It maps legacy SKUs `1A`–`5C` to `01A`–`05C`, maps bilingual source category names into `family_name`, preserves pack labels and source weight together in `variant`, sets `availability` from `inStock`, leaves `entry_notes` null, and imports products as published unless the source explicitly sets `publicationStatus: "draft"`. Image paths are deduplicated and stored in the private bucket under `initial-import/assets/`; each product uses at most `image_1` and `image_2`, leaving `image_3` null.

Run the read-only preflight first:

```bash
npm run inventory:import -- --dry-run
```

The default mode is also dry-run. It checks Supabase for matching family/SKU records, image existence, supported formats, and the 5 MiB limit, then reports its plan without writing data. Only after reviewing and approving that report should a live import be explicitly started with `npm run inventory:import -- --apply`. The apply mode skips already-existing products, refuses conflicting or archived family codes, does not overwrite existing image objects, and writes an `initial_import` audit log for each newly inserted product. The remote sequence is not a single database transaction; if interrupted, rerun the preflight before continuing.

### Manual ASK smoke check

With `.env` configured and the Supabase migrations applied, start `npm run dev` and ask a published inventory question, then ask `How many active users and sessions did FrenglishPass get over the last 7 days?` and `What were its top Search Console queries over the last 7 days?`. Confirm the analytics answer says FrenglishPass test property, reports its date range, and keeps GA4 and Search Console results distinct. Test an unrelated question to confirm ASK redirects to its supported topics. The Google APIs are read-only; if access is not configured, ASK should report that the source is unavailable instead of inventing metrics.

### Manual UX and voice checks

Run these in a real browser; automated tests do not exercise microphone hardware or browser MediaRecorder:

1. On desktop, send several questions and scroll upward while a response is pending. New user messages should bring the thread to the bottom; a response should not pull you down if you have scrolled back to older messages. Check that the composer remains visible.
2. Repeat at a narrow mobile viewport. Ask for a long variant list so the response table must scroll horizontally; confirm it does not widen the page or cover the composer.
3. Click the microphone, grant permission, record briefly, stop, and review the transcript. Test the 60-second countdown and automatic stop, discard a recording, deny permission, and verify that an unsupported browser or failed transcription does not interrupt text ASK.
4. Transcribe English and Hindi speech, edit the transcript, select **Use transcript**, then send it with the ordinary composer. If practical, repeat with another spoken language and check that transcription does not translate it. In Knowledge Base create/edit, record, edit the transcript, add it to existing text, and confirm the entry is not published until **Publish** is confirmed. Voice transcription uses the Google `gemini-3.5-transcribe` model independently of the Gemini Flash / DeepSeek ASK answer path.
6. To investigate the reported hydration warning, open the app in a fresh Incognito/Private window with extensions disabled. If `__processed_<extension-id>__` and `bis_register` disappear there, they were injected by an extension. The app layout contains only a fixed language attribute and the client page defers browser requests to effects; no global hydration-warning suppression was added.

## Available scripts

```bash
npm run dev
```

Run `npm test` for ASK, formatting, diagnostics, voice-validation, analytics-adapter, credential-validation, and inventory-default tests, `npm run typecheck` to check TypeScript, or `npm run build` to create a production build. This repository does not currently define a lint script.

## What's included

- Shared merchant header and one fixed composer for ASK and EDIT.
- ASK conversation with server-generated answers grounded in published inventory and the current page-session Knowledge Base, session-only context, localized thinking state, copy response, and long-message scrolling. Gemini Flash is tried first and DeepSeek through OpenRouter is used only if the primary request fails; provider names, switches, and usage costs are not returned to or displayed by the conversation UI. ASK and Knowledge Base both support browser recording up to 60 seconds and multilingual transcription with Google's `gemini-3.5-transcribe`; transcripts are reviewable, preserve the spoken language, and are never submitted or published automatically.
- EDIT password dialog and guided catalog workflows for adding a product or variant, updating a product, changing availability, and archiving a product.
- Structured product inputs, local image previews (up to two), an application-generated mock SKU, final review, and explicit publish confirmation.
- Search of the active conversation, prototype information, and a merchant website placeholder.

## Remaining mock functionality

- EDIT uses the clearly labelled mock password `shahi123`. It is not authentication or a security boundary.
- Voice capture is local-development-only, accepts browser WebM recordings up to 60 seconds, sends them to Google's `gemini-3.5-transcribe` model for transcription, and never sends audio to OpenRouter or stores audio in Supabase. ASK transcripts are placed in the composer only after review; Knowledge Base transcripts are appended only after review and remain unpublished until the existing confirmation flow completes.
- The Knowledge Base itself is still page-session mock state, not a persisted Supabase source. ASK receives the currently published, non-archived entries with each request; refresh resets entries to the prototype seed data.
- Image previews are read locally in the browser and are not uploaded or stored.
- SKU generation is local application logic. Inventory workflows, availability, archiving, and publishing are simulations and do not persist or change a real catalog.
- The merchant website URL is intentionally not configured.
- The database migration and bucket provisioning are not applied automatically; follow the setup steps above. No live credentials are included in this repository.
