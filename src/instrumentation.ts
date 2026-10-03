// Next.js server instrumentation (App Router). `register()` runs once per server
// instance; `onRequestError` reports every error Next captures during a request
// (Server Components, Route Handlers, Server Actions) to Sentry — scrubbed via
// beforeSend before it leaves the process.

export async function register() {
  if (process.env.NODE_ENV === "production") {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("./sentry.server.config");
    }
    if (process.env.NEXT_RUNTIME === "edge") {
      await import("./sentry.edge.config");
    }
  }
}

export async function onRequestError(
  err: { digest?: string } & Error,
  request: {
    path: string;
    method: string;
    headers: Record<string, string>;
  },
  context: {
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: "render" | "route" | "action" | "middleware";
    renderSource: "react-server-components" | "server-rendering";
    revalidateReason?: "on-demand" | "stale" | undefined;
    renderType?: "dynamic" | "dynamic-resume";
  },
) {
  if (process.env.NODE_ENV === "production") {
    const { captureRequestError } = await import("@sentry/nextjs");
    return captureRequestError(err, request, context);
  }
}
