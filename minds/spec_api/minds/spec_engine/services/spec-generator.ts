/**
 * Spec generation service - creates formatted specification documents
 */

import { getSpec } from './spec.js';

export async function generateSpecContent(specId: string) {
  const spec = await getSpec(specId);

  if (!spec) {
    throw new Error('Spec not found');
  }

  throw new Error('LLM service removed — spec generation not available');
}

export function getSpecUrl(specId: string): string {
  return `${process.env.SPEC_BASE_URL}/spec/${specId}`;
}
