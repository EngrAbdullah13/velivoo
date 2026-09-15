# Phase 2 migration intent

This migration directory is allocated for WP2. The Prisma schema now contains the Phase 2 target entities and fields, but the production SQL migration must be generated/reviewed on the developer machine after Phase 1 migrations are applied. Do not hand-run destructive schema rewrites against production data.

Expected additions: email_definition, expanded email_version metadata, send_policy, operational_hold, frequency_reservation, rendered_message_artifact, tracking_link, phase2_gate_evidence.
