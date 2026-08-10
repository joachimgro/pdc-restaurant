import { registerPlugin } from "@/plugins/registry";
import { IconStats } from "./icons";
import { StatsWorkspace } from "./StatsWorkspace";

registerPlugin({
  id: "stats",
  label: "Stats",
  order: 28,
  railPosition: "top",
  Icon: IconStats,
  Workspace: StatsWorkspace,
});
