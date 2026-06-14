/** Hidden platform operator — never exposed as a role in the API. */
export const SUPERADMIN_EMAIL = "joachim@phiof.digital";

export function isSuperadminEmail(email: string): boolean {
  return email.trim().toLowerCase() === SUPERADMIN_EMAIL;
}

export type StaffRole = "superadmin" | "admin" | "member";

/** Role shown in team lists (superadmin appears as admin). */
export function publicTeamRole(role: StaffRole): "admin" | "member" {
  return role === "member" ? "member" : "admin";
}
