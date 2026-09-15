export type OperationalRunbook4=
  |'pause_workspace_domain_provider'
  |'complaint_or_bounce_spike'
  |'forged_feedback_verification'
  |'queue_backlog_poisoned_job'
  |'database_failover_restore'
  |'redis_loss_rebuild'
  |'unknown_provider_submissions'
  |'accidental_import_or_consent_error'
  |'compromised_api_key_or_member'
  |'unsubscribe_endpoint_degradation'
  |'dns_authentication_regression';
export const requiredRunbooks4:OperationalRunbook4[]=[
  'pause_workspace_domain_provider','complaint_or_bounce_spike','forged_feedback_verification','queue_backlog_poisoned_job','database_failover_restore','redis_loss_rebuild','unknown_provider_submissions','accidental_import_or_consent_error','compromised_api_key_or_member','unsubscribe_endpoint_degradation','dns_authentication_regression'
];

export type SloIndicator4='authenticated_api_availability'|'read_api_p95_ms'|'mutation_api_p95_ms'|'accepted_event_loss'|'feedback_application_p99_seconds'|'scheduled_dispatch_p99_seconds'|'eligible_to_provider_p95_seconds'|'duplicate_send_count'|'segment_freshness_visible';
export const requiredSloIndicators4:SloIndicator4[]=['authenticated_api_availability','read_api_p95_ms','mutation_api_p95_ms','accepted_event_loss','feedback_application_p99_seconds','scheduled_dispatch_p99_seconds','eligible_to_provider_p95_seconds','duplicate_send_count','segment_freshness_visible'];
export interface SloObservation4{id:string;indicator:SloIndicator4;windowStart:Date;windowEnd:Date;observed:number|boolean;objective:string;passed:boolean;evidence:Record<string,unknown>;recordedAt:Date}
export function validateSloObservation4(x:SloObservation4){if(x.windowEnd.getTime()<x.windowStart.getTime())throw new Error('SLO_WINDOW_INVALID');if(!x.objective.trim())throw new Error('SLO_OBJECTIVE_REQUIRED');return x}
