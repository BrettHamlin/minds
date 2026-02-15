/**
 * Role service - manages team roles and member assignments
 */

import { db } from '../db/index.js';
import { specRoles, roleMembers } from '../db/schema.js';
import { eq } from 'drizzle-orm';

interface RoleInput {
  name: string;
  rationale: string;
  sortOrder: number;
}

interface MemberInput {
  slackUserId: string;
  displayName: string;
}

export async function createRoles(specId: string, roles: RoleInput[]) {
  const insertedRoles = await db
    .insert(specRoles)
    .values(
      roles.map((role) => ({
        specId,
        name: role.name,
        rationale: role.rationale,
        sortOrder: role.sortOrder,
      }))
    )
    .returning();
  
  return insertedRoles;
}

export async function addRoleMembers(roleId: string, members: MemberInput[]) {
  if (members.length === 0) return [];
  
  const insertedMembers = await db
    .insert(roleMembers)
    .values(
      members.map((member) => ({
        roleId,
        slackUserId: member.slackUserId,
        displayName: member.displayName,
      }))
    )
    .returning();
  
  return insertedMembers;
}

export async function getRolesForSpec(specId: string) {
  const roles = await db.query.specRoles.findMany({
    where: eq(specRoles.specId, specId),
    with: {
      members: true,
    },
    orderBy: (roles, { asc }) => [asc(roles.sortOrder)],
  });
  
  return roles;
}

export async function getAllMemberUserIds(specId: string): Promise<string[]> {
  const roles = await getRolesForSpec(specId);
  const userIds = new Set<string>();
  
  for (const role of roles) {
    for (const member of role.members) {
      userIds.add(member.slackUserId);
    }
  }
  
  return Array.from(userIds);
}
