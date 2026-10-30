// In-app paths the web app opens with its router (setup-health AC-8, setup-wizard AC-12). Shared by the health report
// (HealthOutcome.href) and the settings presentation attribute `managedBy` so both accept exactly the same paths. Kept
// in its own module because setting-presentation.ts is imported by registry.ts, which health.ts imports.

/** One leading slash, then letters, digits and `/ _ - . ? = &`; no `//`, no `..`, no scheme; at most 200 characters. */
export function isAppHref(href: unknown): href is string {
  return (
    typeof href === 'string' &&
    href.length <= 200 &&
    /^\/(?!\/)[A-Za-z0-9/_.?=&-]*$/.test(href) &&
    !href.includes('..') &&
    !href.includes('//')
  );
}
