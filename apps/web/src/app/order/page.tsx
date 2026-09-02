export const dynamic = "force-dynamic";
export const revalidate = 0;

import { OrderWorkspace } from "@/plugins/order/OrderWorkspace";

export default function OrderPage() {
  return <OrderWorkspace />;
}
