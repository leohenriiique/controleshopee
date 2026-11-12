import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon"
);

/** Lança erro do Supabase como exceção para simplificar os handlers. */
export async function q<T = any>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) {
    alert("Erro: " + error.message);
    throw error;
  }
  return data;
}
