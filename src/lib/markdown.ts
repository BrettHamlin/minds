/**
 * Markdown to HTML conversion utility
 */

import { marked } from 'marked';

export function markdownToHtml(markdown: string): string {
  const html = marked.parse(markdown);
  return html as string;
}
