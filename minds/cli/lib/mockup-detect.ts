/**
 * mockup-detect.ts — Detect design mockup references in tasks.md content.
 *
 * Scans the tasks content for a mockup file path (~/path.html) and a page
 * route path. Returns null if no mockup is referenced — the post-merge
 * visual verification loop is skipped.
 */

export interface MockupInfo {
  /** Absolute-ish path to the mockup HTML file (e.g., ~/Documents/blueprint/configv1.html) */
  mockupPath: string;
  /** The page route to verify (e.g., /config/) */
  routePath: string;
}

/**
 * Detect a mockup reference in tasks.md content.
 *
 * Looks for:
 *   1. A literal file path starting with ~/ and ending in .html
 *   2. A mockup/design context keyword nearby
 *   3. A route path from `produces: route GET /path` or derived from mind name
 */
export function detectMockup(tasksContent: string): MockupInfo | null {
  // Must have mockup/design context
  if (!/mockup|design.*mock|visual.*compar|compare.*design/i.test(tasksContent)) {
    return null;
  }

  // Extract the literal mockup file path (~/something.html)
  const pathMatch = tasksContent.match(/~\/[^\s,)]+\.html/);
  if (!pathMatch) return null;

  const mockupPath = pathMatch[0];

  // Extract the route path from produces: route GET /path annotations
  const routeMatch = tasksContent.match(/produces:\s*route\s+GET\s+(\S+)/i);

  // Or extract from nav path config: path: "/config"
  const navMatch = tasksContent.match(/path:\s*["']([^"']+)["']/);

  // Or derive from the mind name in the section header: ## @config-module Tasks
  const mindMatch = tasksContent.match(/##\s+@(\S+?)-?module\s+Tasks/i)
    ?? tasksContent.match(/##\s+@(\S+)\s+Tasks\s*\(owns:.*tests\/e2e\//);

  let routePath: string;
  if (navMatch) {
    routePath = navMatch[1];
  } else if (routeMatch && routeMatch[1] !== "/") {
    routePath = routeMatch[1];
  } else if (mindMatch) {
    // Derive from mind name: @config-module → /config/
    const name = mindMatch[1].replace(/-module$/, "");
    routePath = `/${name}/`;
  } else {
    routePath = "/";
  }

  // Ensure trailing slash for page routes
  if (!routePath.endsWith("/")) routePath += "/";

  return { mockupPath, routePath };
}
