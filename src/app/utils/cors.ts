import { NextApiRequest, NextApiResponse } from 'next';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export function applyCors(
  req: NextApiRequest,
  res: NextApiResponse,
  options?: {
    methods?: string[];
    origin?: string;
    headers?: string[];
  }
) {
  // Configurações customizadas
  const methods = options?.methods?.join(', ') || 'GET, POST, OPTIONS';
  const headers = options?.headers?.join(', ') || 'Content-Type, Authorization';
  const origin = options?.origin || '*';

  // Set headers
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle OPTIONS method for preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }

  return false;
}