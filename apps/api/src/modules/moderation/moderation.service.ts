import { Injectable } from '@nestjs/common';

const BANNED_TERMS = ['spam', 'scam', 'hack', 'cheat', 'exploit'];
const URL_PATTERN = /https?:\/\/|www\./i;

export interface ModerationResult {
  allowed: boolean;
  reason?: 'too_long' | 'banned_term' | 'blocked_url' | 'empty';
}

@Injectable()
export class ModerationService {
  validate(message: string): ModerationResult {
    const trimmed = message.trim();
    if (!trimmed.length) return { allowed: false, reason: 'empty' };
    if (trimmed.length > 256) return { allowed: false, reason: 'too_long' };
    if (URL_PATTERN.test(trimmed)) return { allowed: false, reason: 'blocked_url' };
    const lower = trimmed.toLowerCase();
    for (const term of BANNED_TERMS) {
      if (lower.includes(term)) return { allowed: false, reason: 'banned_term' };
    }
    return { allowed: true };
  }
}
