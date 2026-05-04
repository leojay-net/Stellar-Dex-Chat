import { z } from 'zod';

export const offlineStatusToastSchema = z.object({
  message: z.string().min(1),
  severity: z.enum(['success', 'error', 'warning', 'info']),
  durationMs: z.number().positive().optional(),
});

export type OfflineStatusToast = z.infer<typeof offlineStatusToastSchema>;
