import type { ConsoleView } from "./store/service-console-store";

/** Includes legacy `today` so old deep links still parse, then redirect. */
const CONSOLE_VIEWS: ConsoleView[] = ["calendar", "floor", "waitlist", "today"];

export function isConsoleView(value: string): value is ConsoleView {
  return (CONSOLE_VIEWS as string[]).includes(value);
}

/** Deep link: ?view=calendar or ?view=service&tab=waitlist */
export function consoleViewFromParam(
  view: string | null,
  tab: string | null
): ConsoleView | null {
  if (tab && isConsoleView(tab)) return tab;
  if (view && isConsoleView(view)) return view;
  return null;
}

export function serviceConsoleViewUrl(view: ConsoleView): string {
  if (view === "floor" || view === "waitlist") {
    return `/inbox?view=service&tab=${view}`;
  }
  // Calendar is the default service surface; today redirects there.
  if (view === "calendar" || view === "today") {
    return `/inbox?view=calendar`;
  }
  return `/inbox?view=${view}`;
}
