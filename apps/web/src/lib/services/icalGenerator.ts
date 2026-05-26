// iCal Feed Generator Service — re-export from @holons/core/calendar.
// Generation lives in `@holons/core/calendar`; browser-only download
// helpers stay here because they need DOM/Blob.

export {
  generateICalFeed,
  generateICal,
  toICalendar,
  mapStatusToICalStatus,
  type HolonEvent,
  type ICalFeedOptions,
} from "@holons/core/calendar";

/** Create a Blob URL for an iCal payload (browser-only). */
export function createICalDownloadUrl(icalContent: string): string {
  const blob = new Blob([icalContent], { type: "text/calendar;charset=utf-8" });
  return URL.createObjectURL(blob);
}

/** Trigger a browser download of an iCal payload (browser-only). */
export function downloadICalFile(
  icalContent: string,
  fileName: string = "calendar.ics",
): void {
  const url = createICalDownloadUrl(icalContent);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
