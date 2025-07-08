// utils/supabase.ts
import { createClient } from '@supabase/supabase-js';

// Configuração do Supabase
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_KEY!;

// Verificação das variáveis
if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL and API key are required in environment variables');
}

// Cria e exporta o cliente
export const supabase = createClient(supabaseUrl, supabaseKey);