import { DateTime } from "luxon";
import { config } from "../config/index.js";

export function nowInZone() {
  return DateTime.now().setZone(config.app.timezone);
}

export function cutoffDate() {
  return nowInZone().minus({ days: Math.max(0, config.arxiv.windowDays - 1) }).startOf("day");
}

export function parseArxivDate(value) {
  return DateTime.fromISO(value, { zone: "utc" }).setZone(config.app.timezone);
}

export function formatDisplayDate(value) {
  if (!value) {
    return "";
  }

  return DateTime.fromISO(value, { zone: config.app.timezone }).toFormat("yyyy-LL-dd HH:mm");
}
