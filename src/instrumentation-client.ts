// Client-side Sentry init (Next 16 `instrumentation-client` convention). Runs
// after the HTML loads, before hydration. Uses the NEXT_PUBLIC_ DSN so it can be
// inlined into the browser bundle; stays dormant if that env var is unset.
import { sharedSentryOptions } from "@/lib/observability/sentry-shared";

const options = sharedSentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN);

if (options.enabled) {
  import("@sentry/nextjs").then((Sentry) => {
    Sentry.init(options);
  });
}
