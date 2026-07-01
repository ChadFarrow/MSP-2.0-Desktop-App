import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isEmailConfigured } from './sendEmail';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.MSP_EMAIL_FROM;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('isEmailConfigured', () => {
  it('is false when neither RESEND_API_KEY nor MSP_EMAIL_FROM is set', () => {
    expect(isEmailConfigured()).toBe(false);
  });

  it('is false when only one of the two is set', () => {
    process.env.RESEND_API_KEY = 're_test';
    expect(isEmailConfigured()).toBe(false);
    delete process.env.RESEND_API_KEY;
    process.env.MSP_EMAIL_FROM = 'noreply@musicsideproject.com';
    expect(isEmailConfigured()).toBe(false);
  });

  it('is true when both are set', () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.MSP_EMAIL_FROM = 'noreply@musicsideproject.com';
    expect(isEmailConfigured()).toBe(true);
  });
});
