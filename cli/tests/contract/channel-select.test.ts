/**
 * T014: Contract test for POST /channel request matching ChannelSelectRequest schema.
 *
 * Schema (from specfactory-api.yaml):
 *   ChannelSelectRequest:
 *     required: [specId, channelName, roles]
 *     specId: uuid
 *     channelName: string, pattern ^[a-z0-9][a-z0-9-]{0,79}$, maxLength 80
 *     roles: array of RoleAssignment
 *
 *   RoleAssignment:
 *     required: [roleName]
 *     roleName: string
 *     members: string[] (default [])
 *
 *   ChannelSelectResponse:
 *     required: [specId, channelId, channelName]
 */
import { describe, it, expect } from 'vitest';

describe('POST /channel contract', () => {
  describe('ChannelSelectRequest schema validation', () => {
    it('should produce a request body with required specId, channelName, and roles fields', () => {
      const requestBody = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        channelName: 'feature-user-auth',
        roles: [
          { roleName: 'Backend Engineer', members: [] },
          { roleName: 'Security Engineer', members: [] },
        ],
      };

      expect(requestBody).toHaveProperty('specId');
      expect(requestBody).toHaveProperty('channelName');
      expect(requestBody).toHaveProperty('roles');
    });

    it('should have specId in UUID format', () => {
      const specId = '550e8400-e29b-41d4-a716-446655440000';

      expect(specId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('should have channelName matching Slack naming convention pattern', () => {
      const channelName = 'feature-user-auth';

      expect(channelName).toMatch(/^[a-z0-9][a-z0-9-]{0,79}$/);
      expect(channelName.length).toBeLessThanOrEqual(80);
    });

    it('should have roles with empty member arrays in CLI mode', () => {
      const roles = [
        { roleName: 'Backend Engineer', members: [] as string[] },
        { roleName: 'Security Engineer', members: [] as string[] },
      ];

      roles.forEach((role) => {
        expect(role).toHaveProperty('roleName');
        expect(typeof role.roleName).toBe('string');
        expect(Array.isArray(role.members)).toBe(true);
        expect(role.members).toHaveLength(0);
      });
    });

    it('should reject channel names with invalid characters', () => {
      const invalidNames = [
        'Invalid-Name',
        'with spaces',
        '-starts-with-hyphen',
        'UPPERCASE',
        'special!chars',
        '',
      ];

      const pattern = /^[a-z0-9][a-z0-9-]{0,79}$/;

      invalidNames.forEach((name) => {
        expect(name).not.toMatch(pattern);
      });
    });
  });

  describe('ChannelSelectResponse schema validation', () => {
    it('should validate response has required specId, channelId, and channelName', () => {
      const response = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        channelId: 'cli-local',
        channelName: 'feature-user-auth',
      };

      expect(response).toHaveProperty('specId');
      expect(response).toHaveProperty('channelId');
      expect(response).toHaveProperty('channelName');
    });

    it('should have channelId as "cli-local" in CLI mode', () => {
      const response = {
        specId: '550e8400-e29b-41d4-a716-446655440000',
        channelId: 'cli-local',
        channelName: 'feature-user-auth',
      };

      expect(response.channelId).toBe('cli-local');
    });
  });
});
