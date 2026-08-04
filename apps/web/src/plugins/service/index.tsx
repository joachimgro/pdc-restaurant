import { registerPlugin } from "@/plugins/registry";
import { IconService } from "./icons";
import { ServiceWorkspace } from "./ServiceWorkspace";

registerPlugin({
  id: "service",
  label: "Service",
  order: 20,
  railPosition: "top",
  Icon: IconService,
  Workspace: ServiceWorkspace,
});
