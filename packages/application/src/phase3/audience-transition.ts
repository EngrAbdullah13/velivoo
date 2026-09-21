import { audienceTransitionOccurredAt } from '../../../domain/src/phase3/runtime-time.js';

export function resolveAudienceTransitionTiming(input: {
  joinedAt: Date;
  flowActivatedAt: Date;
}): { occurredAt: Date; eligible: boolean } {
  const occurredAt = audienceTransitionOccurredAt(input.joinedAt, input.flowActivatedAt);
  return { occurredAt, eligible: input.flowActivatedAt.getTime() <= occurredAt.getTime() };
}
