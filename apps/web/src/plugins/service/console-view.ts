import type { ConsoleView } from "./store/service-console-store";

const CONSOLE_VIEWS: ConsoleView[] = ["today", "waitlist", "floor", "calendar"];

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
  if (view === "today" || view === "floor" || view === "waitlist") {
    return `/inbox?view=service&tab=${view}`;
  }
  return `/inbox?view=${view}`;
}
