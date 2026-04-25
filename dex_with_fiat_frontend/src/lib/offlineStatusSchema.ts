import { z } from 'zod';

export const offlineStatusToastSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty'),
  severity: z.enum(['success', 'error', 'info', 'warning']).default('info'),
  durationMs: z.number().positive().default(3000),
});

export type OfflineStatusToast = z.infer<typeof offlineStatusToastSchema>;
