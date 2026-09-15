export interface WorkspaceReadinessInput {
  legalName?: string;
  businessAddress?: string;
  senderIdentityCount: number;
  verifiedDomainCount: number;
  feedbackReady: boolean;
  unsubscribeReady: boolean;
  profilesReady: boolean;
  emailReady: boolean;
  testSendReady: boolean;
  flowReady: boolean;
}

export interface ReadinessCheck { key: string; passed: boolean; label: string }

export function workspaceReadiness(input: WorkspaceReadinessInput): { ready: boolean; checks: ReadinessCheck[] } {
  const checks: ReadinessCheck[] = [
    { key: "business_identity", passed: Boolean(input.legalName && input.businessAddress), label: "Business identity and physical address" },
    { key: "sender_identity", passed: input.senderIdentityCount > 0, label: "Sender identity configured" },
    { key: "domain", passed: input.verifiedDomainCount > 0, label: "Sending domain verified" },
    { key: "feedback", passed: input.feedbackReady, label: "Bounce/complaint feedback operational" },
    { key: "unsubscribe", passed: input.unsubscribeReady, label: "Unsubscribe path operational" },
    { key: "profiles", passed: input.profilesReady, label: "At least one persisted profile exists" },
    { key: "email", passed: input.emailReady, label: "A preflighted email version is published" },
    { key: "test_send", passed: input.testSendReady, label: "A real test email has been sent" },
    { key: "flow", passed: input.flowReady, label: "A flow has been simulated" },
  ];
  return { ready: checks.every((x) => x.passed), checks };
}
