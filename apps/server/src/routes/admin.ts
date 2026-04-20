/**
 * Settings management only.
 * No HTTP routes exposed — settings are loaded at startup from app-settings.json.
 */

import fs from 'fs';
import path from 'path';

const SETTINGS_PATH = path.join(__dirname, '../../app-settings.json');

const DEFAULT_SETTINGS = {
  registrationPassword: '',
  requireRegistrationPassword: false,
  enableRegistration: true,
  maxFileSize: 50,
  maxGroupSize: 500,
  messageRetentionDays: 0,
  storyExpirationHours: 24,
  enableFileUpload: true,
  enableStories: true,
  enableVoiceMessages: true,
  enableReactions: true,
  enableForwarding: true,
  enableScheduledMessages: true,
};

export function loadSettings(): typeof DEFAULT_SETTINGS {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: typeof DEFAULT_SETTINGS): boolean {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
}
