export type TicketLine = {
  key: string;
  menuItemId: string;
  name: string;
  qty: number;
  notes: string;
  course: string | null;
  pricePence: number;
};

export type ServeMode = "courses" | "as_it_comes" | "all_together";

export type CourseId = "starter" | "main" | "dessert";
