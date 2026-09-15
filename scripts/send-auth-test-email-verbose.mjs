import { SESv2Client, SendEmailCommand, GetEmailIdentityCommand } from "@aws-sdk/client-sesv2";
import { loadEmailPlatformConfig } from "../packages/config/src/env.ts";

const toEmail = process.argv[2] ?? "abdullahjatt315@gmail.com";
const cfg = loadEmailPlatformConfig();
const region = cfg.awsSesRegion ?? "eu-north-1";
const client = new SESv2Client({ region });
const fromEmail = "engr@lahorixsolutions.com";
const rawMime = [
  `From: ${fromEmail}`,
  `To: ${toEmail}`,
  `Subject: [Velivoo auth test verbose] ${new Date().toISOString()}`,
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=UTF-8",
  "",
  "Inspect Authentication-Results and DKIM-Signature.",
  "",
].join("\r\n");

const identity = await client.send(new GetEmailIdentityCommand({ EmailIdentity: "lahorixsolutions.com" }));
console.log(
  JSON.stringify(
    {
      identity: {
        VerificationStatus: identity.VerificationStatus,
        VerifiedForSendingStatus: identity.VerifiedForSendingStatus,
        Dkim: identity.DkimAttributes,
        MailFrom: identity.MailFromAttributes,
      },
    },
    null,
    2,
  ),
);

try {
  const out = await client.send(
    new SendEmailCommand({
      Content: { Raw: { Data: Buffer.from(rawMime) } },
    }),
  );
  console.log(JSON.stringify({ ok: true, messageId: out.MessageId }, null, 2));
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        name: error?.name,
        message: error?.message,
        httpStatusCode: error?.$metadata?.httpStatusCode,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
