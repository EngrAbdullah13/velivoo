import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { convertHtmlToBlocks } from "../packages/domain/src/phase2/html-import.js";

const hollapicSample = `<!doctype html><html><body>
<div class="preheader">Hidden preheader</div>
<table><tr><td><table width="620"><tr>
<td style="padding:28px;background:#0b0b0b"><a href="https://www.hollapic.com/" style="font-size:24px;font-weight:800;color:#ffffff">HollaPic.</a></td>
</tr><tr><td style="padding:48px;background:#0b0b0b">
<div style="font-size:11px;color:#c9ff3b">Built for ecommerce</div>
<h1 style="font-size:48px;color:#ffffff">Better product images.<br><span style="color:#c9ff3b">Without another photoshoot.</span></h1>
<p style="font-size:17px;color:#c7c7c7">Turn the product photos you already have into polished ecommerce visuals.</p>
</td></tr><tr><td style="padding:38px">
<p style="font-size:16px">Hi {{first_name}},</p>
<p style="font-size:16px">{{custom_line}}</p>
</td></tr><tr><td style="padding:32px">
<a href="{{cta_url}}" style="display:inline-block;padding:15px 23px;background:#111111;color:#ffffff;font-weight:700">See what HollaPic can create →</a>
</td></tr></table></td></tr></table>
</body></html>`;

test("HollaPic-style import yields multiple editable blocks not one custom html blob", () => {
  const { document, report } = convertHtmlToBlocks(hollapicSample);
  const content = document.blocks.filter(block => block.type !== "compliance_footer");
  assert.ok(report.blocksCreated >= 6, `expected at least 6 blocks, got ${report.blocksCreated}`);
  assert.ok(content.some(block => block.type === "heading"), "expected a heading block");
  assert.ok(content.filter(block => block.type === "text").length >= 2, "expected multiple text blocks");
  assert.ok(content.some(block => block.type === "button"), "expected CTA button block");
  assert.equal(content.length === 1 && content[0]?.type === "custom_html", false, "should not be a single custom_html import");
  const heroHeading = content.find(block => block.type === "heading");
  assert.equal(heroHeading && "backgroundColor" in heroHeading ? heroHeading.backgroundColor : undefined, "#0b0b0b");
});
