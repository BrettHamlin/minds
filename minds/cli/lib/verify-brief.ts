/**
 * verify-brief.ts — Build DRONE-BRIEF.md for the visual verification drone.
 *
 * Embeds the compare-design logic directly in the brief so the drone can
 * execute it without running a slash command. The drone fetches the live page
 * HTML, reads the mockup HTML from disk, extracts structural elements from
 * both, compares them, and writes findings to VERIFICATION-FINDINGS.md.
 */

export interface VerifyBriefParams {
  serverUrl: string;    // e.g., http://localhost:54321
  routePath: string;    // e.g., /config/
  mockupPath: string;   // e.g., ~/Documents/blueprint/configv1.html
  ticketId: string;
  busUrl: string;
  channel: string;
}

/**
 * Build the DRONE-BRIEF.md content for a visual verification drone.
 */
export function buildVerifyBrief(params: VerifyBriefParams): string {
  const { serverUrl, routePath, mockupPath, ticketId, busUrl, channel } = params;
  const pageUrl = `${serverUrl}${routePath}`;

  return `---
name: Verification Drone Brief
role: Visual comparison of implemented page against design mockup
scope: Read-only verification — compare, report findings, signal completion
---

# Visual Verification: ${ticketId}

## Your Job

Compare the live page at **${pageUrl}** against the design mockup at **${mockupPath}**.
Report ALL differences. Do not fix anything — just identify what's different.

## Steps

### Step 1: Fetch Both HTML Sources

**Live page:**
\`\`\`bash
curl -sf "${pageUrl}" -o /tmp/verify-live.html
\`\`\`

**Mockup:** Read the file at \`${mockupPath}\` (expand \`~\` to your home directory).

If either fetch fails, write that as a finding and skip to Step 4.

### Step 2: Extract Structural Elements

From BOTH HTML files, extract and list:

1. **All \`id="..."\` attributes** — these are the page's structural anchors
2. **Section headings** — all h1, h2, h3 text content
3. **Sidebar/navigation items** — every nav link or menu item, with text and any icons/descriptions
4. **Form controls** — all input, select, textarea, button elements with their labels
5. **Panel/card structure** — distinct sections, their titles, and what's inside them
6. **Header/footer bars** — top bar content (title, buttons), bottom bar content (save/discard)
7. **CSS class patterns** — major layout classes that indicate design structure
8. **Icons and visual indicators** — any SVG icons, status dots, badges

### Step 3: Compare

For each element in the mockup, check if it exists in the live page. Note:

- **Missing elements** — in mockup but not in live page
- **Extra elements** — in live page but not in mockup (less critical, but note them)
- **Structural differences** — same element exists but in wrong location or with wrong nesting
- **Content differences** — text, labels, or descriptions that don't match
- **Layout differences** — sidebar groupings, section ordering, panel arrangement

### Step 4: Write Findings

Write your findings to \`VERIFICATION-FINDINGS.md\` in the repo root:

\`\`\`markdown
# Visual Verification Findings

## Summary
[X findings | or "NO_FINDINGS" if everything matches]

## Findings

### Finding 1: [Short description]
- **Mockup has:** [what the mockup shows]
- **Live page has:** [what the live page shows, or "missing"]
- **Likely file to fix:** [template file path, e.g., packages/modules/config/templates/sidebar.ts]
- **Mind:** [@mind-name that owns the file]

### Finding 2: ...
\`\`\`

If there are no differences, write:
\`\`\`markdown
# Visual Verification Findings

## Summary
NO_FINDINGS — live page matches the design mockup.
\`\`\`

### Step 5: Signal Completion

\`\`\`bash
BUS_URL="${busUrl}" bun .minds/transport/minds-publish.ts --channel "${channel}" --type HOOK_Stop --payload '{"source":"drone:verify-visual"}'
\`\`\`

Do NOT use \`/exit\`. The supervisor will handle session cleanup.

## Important Rules

- Do NOT modify any source files. This is read-only verification.
- Do NOT try to fix issues. Just report them.
- Be thorough — check every section, every sidebar item, every button.
- Include the file path that likely needs to change for each finding.
- Include the @mind-name that owns each file.
`;
}
