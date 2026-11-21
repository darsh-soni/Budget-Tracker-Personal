import { parseAmountToCents } from './money';

export function cardFields(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  if ('name' in body || !partial) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
    if (!name) errors.push('Name is required');
    else out.name = name;
  }
  if ('last4' in body) {
    const l = typeof body.last4 === 'string' ? body.last4.trim() : '';
    if (l && !/^\d{4}$/.test(l)) errors.push('Last 4 must be four digits');
    out.last4 = l || null;
  }
  if ('color' in body) {
    if (typeof body.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.color)) errors.push('Invalid color');
    else out.color = body.color;
  }
  if ('type' in body) {
    if (body.type !== 'credit' && body.type !== 'debit') errors.push('Type must be credit or debit');
    else out.type = body.type;
  }
  if ('monthly_limit' in body) {
    if (body.monthly_limit === null || body.monthly_limit === '') out.monthly_limit_cents = null;
    else {
      const c = parseAmountToCents(body.monthly_limit);
      if (c === null || c < 0) errors.push('Invalid limit');
      else out.monthly_limit_cents = c;
    }
  }
  if ('archived' in body) out.archived = body.archived === true;
  if ('sort' in body && typeof body.sort === 'number') out.sort = Math.round(body.sort);
  return { out, errors };
}
