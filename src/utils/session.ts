import { supabase } from "./supabase";

export type SessionStep = 
  | "start" 
  | "aguardando_prompt" 
  | "validando_prompt"
  | "processando" 
  | "completo" 
  | "erro";

export type SessionAction = 
  | "gerar" 
  | "editar" 
  | "visualizar" 
  | null;

export interface SessionData {
  user_phone: string;
  action: SessionAction;
  step: SessionStep;
  invalidsent: boolean;
  metadata?: {
    lastPrompt?: string;
    projectId?: string;
    retryCount?: number;
    requestId?: string;
    error?: string;
  };
  created_at?: string;
  updated_at?: string;
}

export async function getSession(userPhone: string): Promise<SessionData> {
  console.log(`[SESSIONS] Consultando sessão`);
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_phone", userPhone)
    .maybeSingle();

  if (error) {
    console.error("Session fetch error:", error);
    throw new Error("Failed to get session");
  }

  return data || {
    user_phone: userPhone,
    action: null,
    step: "start",
    invalidsent: false,
    metadata: {}
  };
}

export async function updateSession(
  userPhone: string,
  updates: Partial<SessionData>
): Promise<void> {
  console.log(`[SESSIONS] Atualizando sessão`);
  try {
    const { error } = await supabase
      .from("sessions")
      .upsert({
        user_phone: userPhone,
        ...updates,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_phone' // Garante atualização em caso de conflito
      });

    if (error) throw error;
  } catch (error) {
    console.error("Session update error:", error);
    throw new Error("Failed to update session");
  }
}

export async function clearSession(userPhone: string): Promise<void> {
  console.log(`[SESSIONS] Limpando sessão`);
  const { error } = await supabase
    .from("sessions")
    .delete()
    .eq("user_phone", userPhone);

  if (error) {
    console.error("Session clear error:", error);
    throw new Error("Failed to clear session");
  }
}

export function validateTransition(
  current: SessionStep,
  next: SessionStep
): boolean {
  console.log(`[SESSIONS] Validando transição de sessão`);
  const validTransitions: Record<SessionStep, SessionStep[]> = {
    start: ["aguardando_prompt"],
    aguardando_prompt: ["validando_prompt", "start"],
    validando_prompt: ["processando", "aguardando_prompt"],
    processando: ["completo", "erro"],
    completo: ["start", "aguardando_prompt"],
    erro: ["start", "aguardando_prompt"]
  };

  // Adicionar verificação explícita
  if (!validTransitions[current]) return false;
  return validTransitions[current].includes(next);
}