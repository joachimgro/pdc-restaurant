export type KitchenMenuItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  pricePence: number;
  station: string;
  sortOrder: number;
};

export type KitchenMenuCategory = {
  id: string;
  name: string;
  station: string;
  sortOrder: number;
  items: KitchenMenuItem[];
};

export type KitchenTicketItem = {
  id: string;
  menuItemId: string | null;
  name: string;
  qty: number;
  notes: string | null;
  status: string;
};

export type KitchenTicket = {
  id: string;
  locationId: string;
  reservationId: string | null;
  tableLabel: string | null;
  station: string;
  status: string;
  notes: string | null;
  startedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: KitchenTicketItem[];
};
