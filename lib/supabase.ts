import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 키가 없어도 앱이 죽지 않도록 방어한다.
// 키가 비어 있으면 supabase = null → store.ts가 인메모리 모드로 동작.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;
if (isSupabaseConfigured) {
  try {
    client = createClient(url!, anonKey!, {
      auth: { persistSession: false },
    });
  } catch (e) {
    console.error("[supabase] 클라이언트 생성 실패:", e);
    client = null;
  }
}

export const supabase = client;
