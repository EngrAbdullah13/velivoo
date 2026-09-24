import test from "node:test";
import assert from "node:assert/strict";
import { analyticsRecipients, analyticsRecipientsExport } from "../backend/api/src/analytics-dashboard.js";
import { analyticsRecipientsCsv } from "../backend/api/src/analytics-recipient-csv.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function database() {
  const queries: { sql: string; values: unknown[] }[] = [];
  const prisma = {
    workspaceMember: { findUnique: async () => ({ role: "owner", status: "active" }) },
    senderDomain: { findMany: async () => [] },
    $queryRaw: async (query: { sql: string; values: unknown[] }) => {
      queries.push({ sql: query.sql, values: query.values });
      if (query.sql.includes('AS "matchingCount"')) return [{ total: 2n, opened: 1n, notOpened: 1n, clicked: 1n, notClicked: 1n, matchingCount: 2n }];
      return [
        { messageId: "m1", profileId: "p1", name: "Ada", phone: "+15551234567", email: "ada@example.com", emailName: "Welcome", unsubscribed: false, openCount: 1n, clickCount: 0n },
        { messageId: "m2", profileId: "p2", name: "Ben", phone: null, email: "ben@example.com", emailName: "Reminder", unsubscribed: true, openCount: 0n, clickCount: 1n },
      ];
    },
  };
  return { prisma, queries };
}

test("recipient analytics keeps opens and clicks separate for each sent message", async () => {
  const { prisma, queries } = database();
  const report = await analyticsRecipients({ prisma, workspaceId, userId, range: "7", recipientStatus: "all" });
  assert.equal(report.total, 2);
  assert.deepEqual(report.counts, { opened: 1, notOpened: 1, clicked: 1, notClicked: 1 });
  assert.deepEqual(report.items.map(item => [item.email, item.opened, item.clicked]), [["ada@example.com", true, false], ["ben@example.com", false, true]]);
  assert.ok(queries.every(query => query.sql.includes("m.submitted_at>=")));
  assert.ok(queries.every(query => query.sql.includes("t.aggregate_id=m.id")));
  assert.ok(queries.every(query => query.sql.includes("m.source_type")));
  assert.ok(queries.every(query => query.sql.includes('sub.current_status=\'withdrawn\'')));
  assert.ok(queries.every(query => query.sql.includes('profile_identifier')));
});

test("recipient report filters unrecorded clicks and exports the same cohort", async () => {
  const { prisma, queries } = database();
  await analyticsRecipients({ prisma, workspaceId, userId, recipientStatus: "not_clicked", search: "ada" });
  const report = await analyticsRecipientsExport({ prisma, workspaceId, userId, recipientStatus: "not_clicked", search: "ada" });
  assert.equal(report.status, "not_clicked");
  assert.ok(queries.some(query => query.sql.includes('r."clickCount"=0')));
  assert.ok(queries.some(query => query.values.includes("ada")));
  assert.ok(queries.some(query => query.sql.includes("LIMIT 100001")));
});

test("recipient report combines open and click selections for table and export", async () => {
  const { prisma, queries } = database();
  const filters = { prisma, workspaceId, userId, openStatus: "not_opened", clickStatus: "clicked" };
  const table = await analyticsRecipients(filters);
  const exportReport = await analyticsRecipientsExport(filters);
  assert.deepEqual(table.openStatuses, ["not_opened"]);
  assert.deepEqual(table.clickStatuses, ["clicked"]);
  assert.deepEqual(exportReport.openStatuses, table.openStatuses);
  assert.deepEqual(exportReport.clickStatuses, table.clickStatuses);
  assert.ok(queries.some(query => query.sql.includes('WHERE (r."openCount"=0) AND (r."clickCount">0)')));
  assert.ok(analyticsRecipientsCsv(exportReport).includes("name,phone_number,email,email_opened,link_clicked,unsubscribed"));
});

test("selecting both options in one pair includes either outcome", async () => {
  const { prisma, queries } = database();
  const report = await analyticsRecipients({ prisma, workspaceId, userId, openStatus: "opened,not_opened", clickStatus: "not_clicked" });
  assert.deepEqual(report.openStatuses, ["opened", "not_opened"]);
  assert.ok(queries.some(query => query.sql.includes('WHERE (true) AND (r."clickCount"=0)')));
});

test("recipient report rejects unknown filters and unauthorized access", async () => {
  const { prisma } = database();
  await assert.rejects(analyticsRecipients({ prisma, workspaceId, userId, recipientStatus: "everyone" }), /ANALYTICS_RECIPIENT_STATUS_INVALID/);
  await assert.rejects(analyticsRecipients({ prisma, workspaceId, userId, openStatus: "clicked" }), /ANALYTICS_RECIPIENT_STATUS_INVALID/);
  await assert.rejects(analyticsRecipients({ prisma, workspaceId, userId, clickStatus: "clicked,clicked" }), /ANALYTICS_RECIPIENT_STATUS_INVALID/);
  const blocked = { ...prisma, workspaceMember: { findUnique: async () => null } };
  await assert.rejects(analyticsRecipients({ prisma: blocked, workspaceId, userId }), /FORBIDDEN:analytics.read/);
});

test("recipient CSV puts the six requested fields first and protects spreadsheet cells", async () => {
  const { prisma } = database();
  const report = await analyticsRecipientsExport({ prisma, workspaceId, userId });
  report.rows[0]!.name = '=HYPERLINK("https://example.test","open")';
  const csv = analyticsRecipientsCsv(report);
  assert.ok(csv.startsWith("\uFEFFname,phone_number,email,email_opened,link_clicked,unsubscribed,email_name,sent_at"));
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.test"",""open"")"'));
  assert.ok(csv.includes("ada@example.com"));
  assert.ok(csv.includes("+15551234567"));
  assert.ok(csv.includes("Ben,,ben@example.com,no,yes,yes"));
  assert.equal(csv.split("\r\n").length, 3);
});
