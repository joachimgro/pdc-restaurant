import { z } from "zod";

export const StaffUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  /** Display label — nickname when set, otherwise derived from email. */
  name: z.string(),
  displayName: z.string().optional(),
  needsProfile: z.boolean(),
  canManageTeam: z.boolean(),
  /** Can invite users with admin role (platform operator only; not labeled superadmin). */
  canAssignAdmins: z.boolean(),
});
export type StaffUser = z.infer<typeof StaffUserSchema>;

export const StaffTeamMemberSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  displayName: z.string().optional(),
  role: z.enum(["admin", "member"]),
  status: z.enum(["invited", "active"]),
});
export type StaffTeamMember = z.infer<typeof StaffTeamMemberSchema>;

export const StaffTeamListSchema = z.object({
  members: z.array(StaffTeamMemberSchema),
});
export type StaffTeamList = z.infer<typeof StaffTeamListSchema>;
