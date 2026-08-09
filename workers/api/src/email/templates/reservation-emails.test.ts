import { describe, expect, it } from "vitest";
import { reservationConfirmedEmail } from "./reservation-emails";

describe("reservationConfirmedEmail brand", () => {
  const base = {
    guestName: "Joachim",
    reference: "T041AF",
    serviceDate: "2026-08-13",
    startTime: "12:30",
    partySize: 1,
    manageUrl: "https://kitchen.phiof.digital/manage/abc",
    venueName: "The Test Kitchen",
    addressText: "14 Example Street",
    contactPhone: "0161 000 0000",
  };

  it("renders when brand_json has accent+displayName but no venueName", () => {
    const built = reservationConfirmedEmail({
      ...base,
      brand: {
        venueName: undefined as unknown as string,
        accent: "#FF6B6B",
        displayName: "The Test Kitchen",
      } as never,
    });
    expect(built.subject).toContain("The Test Kitchen");
    expect(built.html).toContain("You're booked");
    expect(built.html).toContain("T");
  });

  it("falls back to payload venueName when brand lacks names", () => {
    const built = reservationConfirmedEmail({
      ...base,
      brand: { venueName: "", accent: "#FF6B6B" },
    });
    expect(built.html).toContain("The Test Kitchen");
  });
});
