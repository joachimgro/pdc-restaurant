import { describe, expect, it } from "vitest";
import { parseMenuImport } from "./menu-import";

describe("parseMenuImport", () => {
  it("parses markdown categories and prices", () => {
    const menu = parseMenuImport(`## Starters
Soup - £6.50
Garlic Bread - 4.5

## Mains
House Burger - £16.50
Salmon
`);
    expect(menu).toHaveLength(2);
    expect(menu[0].name).toBe("Starters");
    expect(menu[0].items[0]).toMatchObject({ name: "Soup", pricePence: 650 });
    expect(menu[0].items[1]).toMatchObject({
      name: "Garlic Bread",
      pricePence: 450,
    });
    expect(menu[1].items[0].name).toBe("House Burger");
    expect(menu[1].items[1]).toMatchObject({ name: "Salmon", pricePence: 0 });
  });

  it("parses JSON categories", () => {
    const menu = parseMenuImport(
      JSON.stringify({
        categories: [
          {
            name: "Bar",
            station: "bar",
            items: [{ name: "Negroni", pricePence: 950 }],
          },
        ],
      })
    );
    expect(menu[0]).toMatchObject({ name: "Bar", station: "bar" });
    expect(menu[0].items[0].name).toBe("Negroni");
  });
});
