/**
 * validation.ts — CLI argument validation.
 */

export function validateTicketIdArg(args: string[], scriptName: string): void {
  if (args.length >= 1 && args[0].startsWith("--")) {
    console.error(
      `Error: First argument must be a ticket ID, not a flag.\n` +
      `Got: "${args[0]}"\n\n` +
      `Usage: ${scriptName} <TICKET_ID> ...`
    );
    process.exit(1);
  }
}
