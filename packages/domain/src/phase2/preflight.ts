import { validateStructuredDocument, type EmailDraft, type PreflightIssue, type PreflightResult, type StructuredBlock } from "./content.js";
import { findUnknownVariableSyntax, parseVariables, variableNeedsFallback } from "./variables.js";

export interface PreflightContext {
  senderDomainReady: boolean;
  workspaceBusinessAddress: string;
  allowHtmlMode: boolean;
  maxMessageBytes?: number;
}

function add(issues:PreflightIssue[],code:string,severity:PreflightIssue["severity"],path:string,message:string){issues.push({code,severity,path,message,title:message.split(".")[0],field:path.split(".").at(-1)})}
function safeHttps(url:string){try{const u=new URL(url);return u.protocol==="https:"}catch{return false}}
function allText(draft:EmailDraft){const b=draft.structuredDocument.blocks.map(blockText).join("\n");return `${draft.subject}\n${draft.preheader}\n${draft.plainText}\n${b}\n${draft.htmlSource??""}`}
function blockText(block:StructuredBlock):string{switch(block.type){case"heading":case"text":return `${block.text} ${block.richText?.runs.map(run=>`${run.text} ${run.link??""}`).join(" ")??""}`;case"header":case"footer":return block.text;case"button":return `${block.label} ${block.url}`;case"image":return `${block.src} ${block.alt} ${block.link??""}`;case"social":return block.links.map(x=>`${x.label} ${x.url}`).join(" ");case"columns":return block.columns.flatMap(column=>column.blocks.map(blockText)).join(" ");default:return""}}
function flattenBlocks(blocks:StructuredBlock[]):StructuredBlock[]{return blocks.flatMap(block=>block.type==="columns"?[block,...block.columns.flatMap(column=>flattenBlocks(column.blocks))]:[block]);}

export function runPreflight(draft:EmailDraft,ctx:PreflightContext):PreflightResult{
  const issues:PreflightIssue[]=[];
  issues.push(...validateStructuredDocument(draft.structuredDocument));
  if(!draft.internalName.trim())add(issues,"MISSING_INTERNAL_NAME","blocking","internalName","Give this email an internal name.");
  if(!draft.subject.trim())add(issues,"MISSING_SUBJECT","blocking","subject","Subject is required.");else add(issues,"SUBJECT_PRESENT","passed","subject","Subject is present.");
  if(/[\r\n]/.test(draft.subject))add(issues,"SUBJECT_HEADER_INJECTION","blocking","subject","Subject cannot contain line breaks.");
  if(!draft.preheader.trim())add(issues,"MISSING_PREHEADER","warning","preheader","Add a preheader for a clearer inbox preview.");
  if(!draft.senderIdentityId)add(issues,"MISSING_SENDER","blocking","senderIdentityId","Select a sender identity.");
  if(!draft.replyTo.trim())add(issues,"MISSING_REPLY_TO","blocking","replyTo","Reply-to is required.");
  else if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.replyTo))add(issues,"REPLY_TO_INVALID","blocking","replyTo","Reply-to must be a valid email address.");
  if(draft.senderIdentityId&&!ctx.senderDomainReady)add(issues,"SENDER_DOMAIN_NOT_READY","blocking","senderIdentityId","The selected sending domain has not finished authentication yet.");
  if(!ctx.workspaceBusinessAddress.trim())add(issues,"MISSING_BUSINESS_ADDRESS","blocking","compliance","Workspace physical business address is required.");
  if(!draft.plainText.trim())add(issues,"MISSING_PLAIN_TEXT","blocking","plainText","Plain-text alternative is required.");
  if(draft.plainTextStale)add(issues,"PLAIN_TEXT_STALE","blocking","plainText","Plain-text content must be refreshed after structured content changed.");
  if(draft.authoringMode==="html"&&!ctx.allowHtmlMode)add(issues,"HTML_MODE_DISABLED","blocking","authoringMode","HTML/source mode is not enabled for this workspace.");
  const footers=draft.structuredDocument.blocks.filter(b=>b.type==="compliance_footer");
  if(draft.authoringMode==="structured"&&footers.length!==1)add(issues,"COMPLIANCE_FOOTER_REQUIRED","blocking","structuredDocument.blocks","Exactly one locked compliance footer is required.");
  for(const [i,b] of flattenBlocks(draft.structuredDocument.blocks).entries()){
    if(b.type==="image"){if(!b.alt.trim())add(issues,"IMAGE_ALT_MISSING","warning",`blocks.${i}.alt`,"Image alt text is recommended.");if(!safeHttps(b.src))add(issues,"IMAGE_URL_UNSAFE","blocking",`blocks.${i}.src`,"Production images must use HTTPS URLs.");if(b.link&&!safeHttps(b.link))add(issues,"IMAGE_LINK_UNSAFE","blocking",`blocks.${i}.link`,"Image links must use HTTPS URLs.")}
    if(b.type==="button"&&!safeHttps(b.url))add(issues,"BUTTON_URL_UNSAFE","blocking",`blocks.${i}.url`,"Button links must use HTTPS URLs.");
    if(b.type==="button"&&!b.label.trim())add(issues,"EMPTY_BUTTON","blocking",`blocks.${i}.label`,"Button label cannot be empty.");
    if(b.type==="social")for(const [j,l] of b.links.entries())if(!safeHttps(l.url))add(issues,"SOCIAL_URL_UNSAFE","blocking",`blocks.${i}.links.${j}.url`,"Social links must use HTTPS URLs.");
    if((b.type==="heading"||b.type==="text")&&b.richText)for(const [j,run] of b.richText.runs.entries())if(run.link&&!safeHttps(run.link))add(issues,"RICH_TEXT_LINK_UNSAFE","blocking",`blocks.${i}.richText.runs.${j}.link`,"Text links must use HTTPS URLs.");
  }
  const text=allText(draft);
  for(const unknown of findUnknownVariableSyntax(text))add(issues,"UNKNOWN_VARIABLE_SYNTAX","blocking","variables",`Unknown variable syntax: ${unknown}`);
  for(const v of parseVariables(text))if(variableNeedsFallback(v))add(issues,"VARIABLE_FALLBACK_REQUIRED","blocking","variables",`${v.raw} requires a safe fallback in Release 1 authoring.`);
  const bytes=Buffer.byteLength(text,"utf8"),limit=ctx.maxMessageBytes??500_000;
  if(bytes>limit)add(issues,"MESSAGE_TOO_LARGE","blocking","message","Draft exceeds the configured message-size ceiling.");else if(bytes>limit*0.8)add(issues,"MESSAGE_SIZE_WARNING","warning","message","Draft is approaching the configured message-size ceiling.");
  const ok=!issues.some(i=>i.severity==="blocking");
  return {ok,checkedAt:new Date().toISOString(),issues,state:ok?(issues.some(i=>i.severity==="warning")?"warnings":"passed"):"blocking"};
}
