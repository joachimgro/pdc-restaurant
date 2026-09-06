import { describe, expect, it } from "vitest";
import {
  categoriesToImportJson,
  parseMenuImport,
} from "./menu-import";

const FENNEL_OCR = `FENNEL
NEIGHBOURHOOD RESTAURANT

STARTERS
Breads, olive oil, sherry vinegar . . . £4.95
Mixed Mediterranean olives . . . £4.95
Charcuterie plate . . . £8
Boquerones
marinated white anchovies . . . £7
Patatas bravas, aioli . . . £6
Gambas pil pil, Quindella salsa . . . £8
Chorizo, honey, red wine . . . £8
Baked cheese bread,
muhammara, whipped feta . . . £7
Padron peppers, sea salt . . . £7

SHARING BOARD
selection of breads, meats, cheese, olives and dips . . . £25

MEATS
275 gram ribeye Palermo style . . . £36
Harissa lamb, pomegranate, feta salad . . . £32
Steak frites, green peppercorn sauce . . . £23
Roasted bone-in corn-fed chicken,
scorched leeks, mushrooms, cream, tarragon . . . £25

SIDES
Green beans, sauce Vierge . . . £5
Fennel and orange salad . . . £5
Tomato, shallot, caper salad . . . £5
Fries . . . £5
Pangratatto fries, Parmesan, chili,
and truffle mayonnaise . . . £7

VEGETARIAN
Aubergine parmigiano, Parmesan, basil . . . £14
Burrata, heritage tomato salad . . . £12

DESSERTS
Crème Catalan, boozy apricots . . . £8
Basque cheesecake, sherry pepper strawberries . . . £8
Chocolate fondant, clotted cream ice cream . . . £8

Please inform your server of any allergies or dietary requirements.
A discretionary 10% service charge will be added to your bill.
`;

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

  it("accepts seed-style price_pence and kitchen station", () => {
    const menu = parseMenuImport(
      JSON.stringify({
        categories: [
          {
            name: "Starters",
            station: "kitchen",
            items: [
              {
                name: "Boquerones",
                description: "marinated white anchovies",
                price_pence: 700,
              },
            ],
          },
        ],
      })
    );
    expect(menu[0].station).toBe("restaurant");
    expect(menu[0].items[0]).toMatchObject({
      name: "Boquerones",
      description: "marinated white anchovies",
      pricePence: 700,
    });
  });

  it("pulls JSON out of model chatter", () => {
    const menu = parseMenuImport(`Sure, here is the menu:
\`\`\`json
{"categories":[{"name":"Desserts","items":[{"name":"Fondant","pricePence":800}]}]}
\`\`\`
`);
    expect(menu).toHaveLength(1);
    expect(menu[0].items[0]).toMatchObject({
      name: "Fondant",
      pricePence: 800,
    });
  });

  it("parses a Fennel-style printed menu dump", () => {
    const menu = parseMenuImport(FENNEL_OCR);
    const names = menu.map((c) => c.name);
    expect(names).toEqual([
      "STARTERS",
      "SHARING BOARD",
      "MEATS",
      "SIDES",
      "VEGETARIAN",
      "DESSERTS",
    ]);

    const starters = menu[0].items;
    expect(starters[0]).toMatchObject({
      name: "Breads, olive oil, sherry vinegar",
      pricePence: 495,
    });
    const boquerones = starters.find((i) => i.name === "Boquerones");
    expect(boquerones).toMatchObject({
      description: "marinated white anchovies",
      pricePence: 700,
    });

    const chicken = menu[2].items.find((i) =>
      i.name.toLowerCase().includes("chicken")
    );
    expect(chicken?.pricePence).toBe(2500);
    expect(chicken?.description).toMatch(/tarragon/i);

    const itemCount = menu.reduce((n, c) => n + c.items.length, 0);
    expect(itemCount).toBeGreaterThanOrEqual(24);

    expect(menu.some((c) => /fennel/i.test(c.name))).toBe(false);
    const allNames = menu.flatMap((c) => c.items.map((i) => i.name)).join(" ");
    expect(allNames).not.toMatch(/service charge/i);
  });

  it("round-trips judged JSON through the importer", () => {
    const judged = parseMenuImport(FENNEL_OCR);
    const json = categoriesToImportJson(judged);
    const again = parseMenuImport(json);
    expect(again).toEqual(judged);
  });
});
