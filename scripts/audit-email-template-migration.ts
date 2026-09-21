import { PrismaClient } from "@prisma/client";
import { planLegacyTemplateMigration } from "../packages/domain/src/phase2/template-document-v2.js";

const db = new PrismaClient();

try {
  const templates = await db.emailTemplate.findMany({
    select: {
      templateType: true,
      conversionStatus: true,
      importMethod: true,
      documentJson: true,
      settingsJson: true,
      originalSourceHtml: true,
      sanitizedHtml: true,
    },
  });
  const summary = { total: templates.length, visual: 0, html: 0, review: 0, reviewReasons: {} as Record<string, number> };
  for (const template of templates) {
    const plan = planLegacyTemplateMigration({
      templateType: template.templateType,
      conversionStatus: template.conversionStatus,
      importMethod: template.importMethod,
      document: template.documentJson,
      settings: template.settingsJson,
      originalSourceHtml: template.originalSourceHtml,
      sanitizedHtml: template.sanitizedHtml,
    });
    summary[plan.disposition]++;
    if (plan.disposition === "review") {
      for (const reason of plan.reasons) summary.reviewReasons[reason] = (summary.reviewReasons[reason] ?? 0) + 1;
    }
  }
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await db.$disconnect();
}
