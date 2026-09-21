/**
 * Release-one safety limit for production provider submissions.
 *
 * The database capacity bucket is authoritative. Redis retries keep messages
 * durable while they wait for the next available one-second workspace window.
 */
export const WORKSPACE_EMAILS_PER_SECOND = 1;
export const DELIVERY_QUEUE_RETRY_DELAY_MS = 1_000;
export const DELIVERY_QUEUE_MAX_ATTEMPTS = 604_800; // Seven days at one retry/second.

