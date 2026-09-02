export type KitchenMenuChoiceGroup = {
  label: string;
  required: boolean;
  options: string[];
};

export type KitchenMenuItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  pricePence: number;
  station: string;
  sortOrder: number;
  available: boolean;
  choices: KitchenMenuChoiceGroup[] | null;
};

export type KitchenMenuCategory = {
  id: string;
  name: string;
  station: string;
  sortOrder: number;
  defaultCourse: string | null;
  items: KitchenMenuItem[];
};

export type KitchenTicketItem = {
  id: string;
  menuItemId: string | null;
  name: string;
  qty: number;
  notes: string | null;
  status: string;
  course: string | null;
};

export type KitchenTicket = {
  id: string;
  locationId: string;
  reservationId: string | null;
  tableLabel: string | null;
  station: string;
  status: string;
  notes: string | null;
  serveMode: string | null;
  covers: number | null;
  orderKey: string | null;
  startedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: KitchenTicketItem[];
};
