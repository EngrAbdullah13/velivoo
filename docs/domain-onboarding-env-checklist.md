# Domain onboarding environment checklist

Status checked on 2026-09-02. Secret values are intentionally not shown.

| Required key / item | Why it is needed | Required for | Current status |
|---|---|---|---|
| `AWS_REGION` | AWS SDK default region, including Route 53 client initialization | Domain onboarding | Configured: `eu-north-1` |
| `AWS_SES_REGION` | SES identity, DKIM, MAIL FROM, and sending region | Domain onboarding and sending | Configured: `eu-north-1` |
| `EMAIL_PROVIDER` | Selects SES as the email provider | Domain onboarding and sending | Configured: `ses` |
| `EMAIL_PLATFORM_SES_DOMAIN_SETUP_ENABLED` | Enables SES domain identity provisioning | Domain onboarding | Configured: enabled |
| `DNS_PROVIDER` | Selects Route 53 DNS orchestration | Domain onboarding | Configured: `route53` |
| `ROUTE53_DNS_ENABLED` | Enables Route 53 child-zone provisioning | Domain onboarding | Configured: enabled |
| `ROUTE53_BRANDED_NS_DOMAIN` | Validates the Velivoo vanity nameserver suffix | Domain onboarding | Configured: `velivoo.com` |
| `ROUTE53_DELEGATION_SET_ID` | Reuses the shared Route 53 delegation set for every child zone | Domain onboarding | Configured and verified |
| `ROUTE53_EXPECTED_NAME_SERVERS` | Customer-facing `ns1`–`ns4` nameservers | Domain onboarding | Configured |
| `ROUTE53_VANITY_NS_MAPPING` | Maps each Velivoo vanity NS to the matching AWS NS | Domain onboarding | Configured and verified |
| IAM role / AWS credentials | Allows the server to call Route 53 and SES APIs | Domain onboarding and sending | Configured enough for read-only Route 53/SES checks; confirm write permissions before production |
| `EMAIL_PLATFORM_SNS_TOPIC_ARN` | Receives SES delivery, bounce, complaint, reject, and delay events | Production feedback/readiness | **Missing** |
| SNS HTTPS subscription | Delivers SNS feedback to Velivoo's public feedback endpoint | Production feedback/readiness | **Missing**: existing topic has no subscription |
| `EMAIL_PLATFORM_PUBLIC_BASE_URL` | Public HTTPS address for feedback, unsubscribe, and tracking links | Production feedback/readiness | **Needs change**: currently localhost only |
| SES production access | Lets SES send to addresses beyond verified sandbox recipients | Production sending | **Missing externally**: AWS reports production access is disabled |
| `EMAIL_PLATFORM_RUNTIME_MODE` | Enables production operational behavior | Production deployment | **Needs change**: currently `proof` |
| `EMAIL_PLATFORM_DELIVERY_QUEUE_ENABLED` | Runs durable production delivery workers | Production deployment | **Needs change**: currently disabled |
| `REDIS_URL` | Queue/worker coordination when delivery queue is enabled | Production deployment | Configured; verify Redis is reachable in the deployment environment |
| `EMAIL_PLATFORM_UNSUBSCRIBE_SIGNING_SECRET` | Signs unsubscribe links | Production feedback/readiness | Configured |
| `EMAIL_PLATFORM_TRACKING_SIGNING_SECRET` | Signs tracking links | Production tracking | Configured |
| `TRACKING_DOMAIN_MODE` | Chooses platform or CloudFront branded tracking | Initial sending | Configured: `platform` |
| `CLOUDFRONT_MULTI_TENANT_DISTRIBUTION_ID` | Shared distribution for `click.send.customer.com` | Optional branded tracking | Not configured |
| `CLOUDFRONT_CONNECTION_GROUP_ID` | Routes branded tracking tenants | Optional branded tracking | Not configured |

## Next required actions

1. Create or select an SNS feedback topic, create its confirmed HTTPS subscription to the Velivoo public feedback endpoint, then set `EMAIL_PLATFORM_SNS_TOPIC_ARN`.
2. Replace `EMAIL_PLATFORM_PUBLIC_BASE_URL` with the public HTTPS domain before production.
3. Request SES production access in `eu-north-1`.
4. Before production, set `EMAIL_PLATFORM_RUNTIME_MODE=production` and `EMAIL_PLATFORM_DELIVERY_QUEUE_ENABLED=true`, then verify Redis.
5. Configure CloudFront only when branded tracking is required; otherwise keep `TRACKING_DOMAIN_MODE=platform`.
