export const pagination = {
  type: 'object',
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
    offset: { type: 'integer', minimum: 0, maximum: 100000, default: 0 },
  },
};
export const articleId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[a-f0-9]{32}$' } },
};
