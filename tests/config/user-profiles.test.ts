import { afterEach, describe, expect, it } from 'vitest';
import {
  clearUserProfilesCache,
  formatProfileForToon,
  getUserProfile,
  isUserProfilesLoaded,
  loadUserProfiles,
  loadUserProfilesFromEnv,
  loadUserProfilesFromFile,
  type UserProfilesConfig,
} from '../../src/shared/config/user-profiles.js';

describe('user-profiles', () => {
  afterEach(() => {
    clearUserProfilesCache();
  });

  describe('loadUserProfilesFromEnv', () => {
    it('returns defaults when no JSON provided', () => {
      const config = loadUserProfilesFromEnv(undefined);
      expect(config.profiles).toEqual({});
      expect(config.version).toBe(1);
    });

    it('returns defaults for empty string', () => {
      clearUserProfilesCache();
      const config = loadUserProfilesFromEnv('');
      expect(config.profiles).toEqual({});
    });

    it('parses valid JSON', () => {
      clearUserProfilesCache();
      const json = JSON.stringify({
        version: 1,
        profiles: {
          'test@example.com': {
            role: 'Developer',
            skills: ['TypeScript'],
            focusArea: 'Backend',
          },
        },
      });
      const config = loadUserProfilesFromEnv(json);
      expect(config.profiles['test@example.com'].role).toBe('Developer');
      expect(config.profiles['test@example.com'].skills).toEqual(['TypeScript']);
      expect(config.profiles['test@example.com'].focusArea).toBe('Backend');
    });

    it('returns defaults for invalid JSON', () => {
      clearUserProfilesCache();
      const config = loadUserProfilesFromEnv('not valid json');
      expect(config.profiles).toEqual({});
    });

    it('returns defaults for JSON missing profiles key', () => {
      clearUserProfilesCache();
      const config = loadUserProfilesFromEnv(JSON.stringify({ version: 1 }));
      expect(config.profiles).toEqual({});
    });
  });

  describe('loadUserProfilesFromFile', () => {
    it('returns defaults when file does not exist', () => {
      const config = loadUserProfilesFromFile('./nonexistent-file.json');
      expect(config.profiles).toEqual({});
      expect(isUserProfilesLoaded()).toBe(true);
    });
  });

  describe('loadUserProfiles', () => {
    it('uses env JSON when provided', () => {
      const json = JSON.stringify({
        version: 1,
        profiles: {
          'env@example.com': { role: 'EnvUser' },
        },
      });
      const config = loadUserProfiles({ envJson: json });
      expect(config.profiles['env@example.com'].role).toBe('EnvUser');
    });

    it('falls back to file when no env JSON', () => {
      clearUserProfilesCache();
      const config = loadUserProfiles({ filePath: './nonexistent.json' });
      expect(config.profiles).toEqual({});
    });

    it('caches config after first load', () => {
      const json1 = JSON.stringify({
        version: 1,
        profiles: { 'first@example.com': { role: 'First' } },
      });
      const config1 = loadUserProfiles({ envJson: json1 });
      expect(config1.profiles['first@example.com'].role).toBe('First');

      // Second call with different data should return cached
      const json2 = JSON.stringify({
        version: 1,
        profiles: { 'second@example.com': { role: 'Second' } },
      });
      const config2 = loadUserProfiles({ envJson: json2 });
      expect(config2.profiles['first@example.com'].role).toBe('First');
      expect(config2.profiles['second@example.com']).toBeUndefined();
    });
  });

  describe('getUserProfile', () => {
    const testConfig: UserProfilesConfig = {
      version: 1,
      profiles: {
        'Test@Example.com': {
          role: 'Tech Lead',
          skills: ['TypeScript', 'React'],
          focusArea: 'Frontend',
        },
        'dev@example.com': {
          role: 'Developer',
          focusArea: 'Backend',
        },
      },
      defaults: {
        role: 'Team Member',
        skills: [],
        focusArea: '',
      },
    };

    it('returns profile for matching email (case-insensitive)', () => {
      const profile = getUserProfile(testConfig, 'test@example.com');
      expect(profile.role).toBe('Tech Lead');
      expect(profile.skills).toEqual(['TypeScript', 'React']);
      expect(profile.focusArea).toBe('Frontend');
    });

    it('returns profile for exact case match', () => {
      const profile = getUserProfile(testConfig, 'Test@Example.com');
      expect(profile.role).toBe('Tech Lead');
    });

    it('returns profile for uppercase email', () => {
      const profile = getUserProfile(testConfig, 'TEST@EXAMPLE.COM');
      expect(profile.role).toBe('Tech Lead');
    });

    it('returns defaults when email not found', () => {
      const profile = getUserProfile(testConfig, 'unknown@example.com');
      expect(profile.role).toBe('Team Member');
      expect(profile.skills).toEqual([]);
    });

    it('returns empty object when email is undefined', () => {
      const profile = getUserProfile(testConfig, undefined);
      expect(profile.role).toBe('Team Member');
    });

    it('returns empty object when no defaults configured', () => {
      const configNoDefaults: UserProfilesConfig = {
        version: 1,
        profiles: {},
      };
      const profile = getUserProfile(configNoDefaults, 'unknown@example.com');
      expect(profile).toEqual({});
    });
  });

  describe('formatProfileForToon', () => {
    it('formats role with focus area', () => {
      const result = formatProfileForToon({
        role: 'Tech Lead',
        focusArea: 'Backend infrastructure',
      });
      expect(result).toBe('Tech Lead (Backend infrastructure)');
    });

    it('formats role only', () => {
      const result = formatProfileForToon({ role: 'Developer' });
      expect(result).toBe('Developer');
    });

    it('formats focus area only', () => {
      const result = formatProfileForToon({ focusArea: 'Frontend' });
      expect(result).toBe('(Frontend)');
    });

    it('returns empty string for empty profile', () => {
      const result = formatProfileForToon({});
      expect(result).toBe('');
    });

    it('returns empty string for profile with only skills', () => {
      const result = formatProfileForToon({ skills: ['TypeScript'] });
      expect(result).toBe('');
    });

    it('handles all fields', () => {
      const result = formatProfileForToon({
        role: 'Senior Developer',
        skills: ['TypeScript', 'Node.js'],
        focusArea: 'API development',
      });
      expect(result).toBe('Senior Developer (API development)');
    });
  });

  describe('clearUserProfilesCache', () => {
    it('clears cached config', () => {
      const json = JSON.stringify({
        version: 1,
        profiles: { 'test@example.com': { role: 'Test' } },
      });
      loadUserProfiles({ envJson: json });
      expect(isUserProfilesLoaded()).toBe(true);

      clearUserProfilesCache();
      expect(isUserProfilesLoaded()).toBe(false);
    });

    it('allows reloading after clear', () => {
      const json1 = JSON.stringify({
        version: 1,
        profiles: { 'first@example.com': { role: 'First' } },
      });
      loadUserProfiles({ envJson: json1 });

      clearUserProfilesCache();

      const json2 = JSON.stringify({
        version: 1,
        profiles: { 'second@example.com': { role: 'Second' } },
      });
      const config = loadUserProfiles({ envJson: json2 });
      expect(config.profiles['second@example.com'].role).toBe('Second');
      expect(config.profiles['first@example.com']).toBeUndefined();
    });
  });
});
