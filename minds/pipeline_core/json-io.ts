/**
 * json-io.ts — JSON file read/write utilities.
 */

import * as fs from "fs";
import { emitStatusEvent } from "./status-emitter";

export function readJsonFile(filePath: string): any | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function writeJsonAtomic(filePath: string, data: any): void {
  const previous = readJsonFile(filePath);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, filePath);
  if (data && typeof data === "object" && data.ticket_id) {
    emitStatusEvent(filePath, previous, data);
  }
}
