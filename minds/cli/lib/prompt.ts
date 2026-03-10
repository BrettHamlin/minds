/**
 * prompt.ts -- Shared confirmation prompt utility.
 */

import { createInterface } from "readline";

/**
 * Prompt the user for yes/no confirmation.
 * Returns true if the user answers "y" or "yes".
 */
export function promptConfirmation(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}
