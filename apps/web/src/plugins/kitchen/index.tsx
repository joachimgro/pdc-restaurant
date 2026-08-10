import { registerPlugin } from "@/plugins/registry";
import { IconKitchen } from "./icons";
import { KitchenWorkspace } from "./KitchenWorkspace";

registerPlugin({
  id: "kitchen",
  label: "Kitchen",
  order: 25,
  railPosition: "top",
  Icon: IconKitchen,
  Workspace: KitchenWorkspace,
});
