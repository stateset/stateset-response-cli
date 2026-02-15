import { describe, it, expect } from 'vitest';
import { redactPii } from '../integrations/redact.js';

describe('redactPii', () => {
  it('redacts email fields', () => {
    const result = redactPii({ email: 'user@example.com', name: 'John' }) as Record<
      string,
      unknown
    >;
    expect(result.email).toBe('[redacted]');
    expect(result.name).toBe('John');
  });

  it('redacts phone fields', () => {
    const result = redactPii({ phone: '555-1234' }) as Record<string, unknown>;
    expect(result.phone).toBe('[redacted]');
  });

  it('redacts address fields', () => {
    const result = redactPii({ address: '123 Main St' }) as Record<string, unknown>;
    expect(result.address).toBe('[redacted]');
  });

  it('redacts customer_ prefixed PII fields', () => {
    const result = redactPii({
      customer_email: 'a@b.com',
      customer_phone: '555',
      customer_name: 'Jane',
    }) as Record<string, unknown>;
    expect(result.customer_email).toBe('[redacted]');
    expect(result.customer_phone).toBe('[redacted]');
    expect(result.customer_name).toBe('[redacted]');
  });

  it('redacts first_name and last_name', () => {
    const result = redactPii({ first_name: 'John', last_name: 'Doe' }) as Record<string, unknown>;
    expect(result.first_name).toBe('[redacted]');
    expect(result.last_name).toBe('[redacted]');
  });

  it('redacts ssn and social_security fields', () => {
    const result = redactPii({ ssn: '123-45-6789', social_security: '987-65-4321' }) as Record<
      string,
      unknown
    >;
    expect(result.ssn).toBe('[redacted]');
    expect(result.social_security).toBe('[redacted]');
  });

  it('redacts credit_card and card_number fields', () => {
    const result = redactPii({
      credit_card: '4111111111111111',
      card_number: '5500000000000004',
    }) as Record<string, unknown>;
    expect(result.credit_card).toBe('[redacted]');
    expect(result.card_number).toBe('[redacted]');
  });

  it('redacts cvv and cvc fields', () => {
    const result = redactPii({ cvv: '123', cvc: '456' }) as Record<string, unknown>;
    expect(result.cvv).toBe('[redacted]');
    expect(result.cvc).toBe('[redacted]');
  });

  it('redacts password and secret fields', () => {
    const result = redactPii({
      password: 'hunter2',
      passwd: 'abc',
      secret: 'shhh',
    }) as Record<string, unknown>;
    expect(result.password).toBe('[redacted]');
    expect(result.passwd).toBe('[redacted]');
    expect(result.secret).toBe('[redacted]');
  });

  it('redacts api_key and access_token fields', () => {
    const result = redactPii({
      api_key: 'sk-123',
      apikey: 'pk-456',
      access_token: 'tok-789',
    }) as Record<string, unknown>;
    expect(result.api_key).toBe('[redacted]');
    expect(result.apikey).toBe('[redacted]');
    expect(result.access_token).toBe('[redacted]');
  });

  it('redacts date_of_birth, dob, and birth_date fields', () => {
    const result = redactPii({
      date_of_birth: '1990-01-01',
      dob: '1985-06-15',
      birth_date: '2000-12-25',
    }) as Record<string, unknown>;
    expect(result.date_of_birth).toBe('[redacted]');
    expect(result.dob).toBe('[redacted]');
    expect(result.birth_date).toBe('[redacted]');
  });

  it('redacts ip_address, tax_id, national_id fields', () => {
    const result = redactPii({
      ip_address: '192.168.1.1',
      tax_id: '12-3456789',
      national_id: 'AB123456',
    }) as Record<string, unknown>;
    expect(result.ip_address).toBe('[redacted]');
    expect(result.tax_id).toBe('[redacted]');
    expect(result.national_id).toBe('[redacted]');
  });

  it('redacts passport, driver_license, bank_account, routing_number fields', () => {
    const result = redactPii({
      passport: 'C12345678',
      driver_license: 'DL-987654',
      bank_account: '000123456789',
      routing_number: '021000021',
    }) as Record<string, unknown>;
    expect(result.passport).toBe('[redacted]');
    expect(result.driver_license).toBe('[redacted]');
    expect(result.bank_account).toBe('[redacted]');
    expect(result.routing_number).toBe('[redacted]');
  });

  it('preserves non-PII fields', () => {
    const result = redactPii({ id: '123', status: 'active', created_at: '2024-01-01' }) as Record<
      string,
      unknown
    >;
    expect(result.id).toBe('123');
    expect(result.status).toBe('active');
    expect(result.created_at).toBe('2024-01-01');
  });

  it('handles nested objects recursively', () => {
    const result = redactPii({
      order: { email: 'test@test.com', total: 100 },
    }) as Record<string, unknown>;
    const order = result.order as Record<string, unknown>;
    expect(order.email).toBe('[redacted]');
    expect(order.total).toBe(100);
  });

  it('handles arrays of objects', () => {
    const result = redactPii([
      { email: 'a@b.com', id: 1 },
      { phone: '555', id: 2 },
    ]) as Array<Record<string, unknown>>;
    expect(result[0].email).toBe('[redacted]');
    expect(result[0].id).toBe(1);
    expect(result[1].phone).toBe('[redacted]');
    expect(result[1].id).toBe(2);
  });

  it('returns primitives unchanged', () => {
    expect(redactPii(42)).toBe(42);
    expect(redactPii('hello')).toBe('hello');
    expect(redactPii(true)).toBe(true);
    expect(redactPii(null)).toBe(null);
    expect(redactPii(undefined)).toBe(undefined);
  });

  // Value-based PII detection tests
  it('redacts SSN patterns in arbitrary field values', () => {
    const result = redactPii({ notes: 'SSN is 123-45-6789 on file' }) as Record<string, unknown>;
    expect(result.notes).toBe('[redacted]');
  });

  it('redacts credit card patterns in arbitrary field values', () => {
    const result = redactPii({
      comment: 'Card: 4111 1111 1111 1111',
    }) as Record<string, unknown>;
    expect(result.comment).toBe('[redacted]');
  });

  it('redacts credit card with dashes in arbitrary field values', () => {
    const result = redactPii({
      info: 'Pay with 5500-0000-0000-0004',
    }) as Record<string, unknown>;
    expect(result.info).toBe('[redacted]');
  });

  it('redacts IPv4 addresses in arbitrary field values', () => {
    const result = redactPii({ log_entry: 'Request from 192.168.1.1' }) as Record<string, unknown>;
    expect(result.log_entry).toBe('[redacted]');
  });

  it('does not redact normal short numbers', () => {
    const result = redactPii({ quantity: '12345', port: '8080' }) as Record<string, unknown>;
    expect(result.quantity).toBe('12345');
    expect(result.port).toBe('8080');
  });

  it('does not redact normal text', () => {
    const result = redactPii({
      description: 'This is a normal product description',
      title: 'Order Summary',
    }) as Record<string, unknown>;
    expect(result.description).toBe('This is a normal product description');
    expect(result.title).toBe('Order Summary');
  });

  it('does not redact non-string values even if they look like PII patterns', () => {
    const result = redactPii({ count: 1234567890123456 }) as Record<string, unknown>;
    expect(result.count).toBe(1234567890123456);
  });
});
