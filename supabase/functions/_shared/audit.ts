import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.115.0';

export async function writeAudit(
  admin: SupabaseClient,
  actor: { userId?: string; displayName?: string },
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from('audit_log').insert({
    actor_user_id: actor.userId || null,
    actor_display: actor.displayName || null,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata,
  });
  if (error) throw error;
}
