import { beforeEach, describe, expect, it } from 'vitest';
import { clearLogs, getLogsText, log, logger } from '../src/services/logger';

describe('logger', () => {
  beforeEach(() => clearLogs());

  it('records formatted lines with level and timestamp', () => {
    logger.error('something broke', new Error('boom'));
    const text = getLogsText();
    expect(text).toMatch(/\[ERROR\] something broke/);
    expect(text).toContain('Error: boom');
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp prefix
  });

  it('serialises objects and keeps plain strings readable', () => {
    log('info', 'state', { a: 1 });
    expect(getLogsText()).toContain('state {"a":1}');
  });

  it('caps the buffer near 1MB by dropping oldest lines first', () => {
    const chunk = 'x'.repeat(10_000);
    for (let i = 0; i < 150; i += 1) log('info', `line-${i}`, chunk); // ~1.5MB total
    const text = getLogsText();
    expect(text.length).toBeLessThanOrEqual(1_000_000);
    expect(text).not.toContain('line-0 '); // oldest evicted
    expect(text).toContain('line-149'); // newest kept
  });

  it('clearLogs empties the buffer', () => {
    logger.info('hello');
    clearLogs();
    expect(getLogsText()).toBe('');
  });
});
