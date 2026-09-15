import { stableContentHash, type EmailDraft, type EmailTextStyle, type RichTextRun, type StructuredBlock } from "../../domain/src/phase2/content.js";
import { htmlToPlainText } from "../../domain/src/phase2/html-import.js";
import { parseVariables } from "../../domain/src/phase2/variables.js";

function esc(v:string){return v.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]!))}
function attr(v:string){return esc(v)}
function escTemplate(v:string){
  const tokens:string[]=[];
  const protectedValue=v.replace(/\{\{\s*(?:profile|workspace|event|system)\.[^}]+\}\}/g,(m)=>{const key=`__VAR_${tokens.length}__`;tokens.push(m);return key});
  let out=esc(protectedValue);
  tokens.forEach((token,i)=>{out=out.replace(`__VAR_${i}__`,token)});
  return out;
}
function css(style:EmailTextStyle|undefined,align?:string,spacing?:{top?:number;bottom?:number}){const parts=[`text-align:${align??"left"}`,`margin:${spacing?.top??0}px 0 ${spacing?.bottom??16}px`];if(style?.fontFamily)parts.push(`font-family:${style.fontFamily}`);if(style?.color)parts.push(`color:${style.color}`);if(style?.fontSize)parts.push(`font-size:${style.fontSize}px`);parts.push(`line-height:${style?.lineHeight??1.5}`);if(style?.fontWeight)parts.push(`font-weight:${style.fontWeight}`);if(style?.italic)parts.push("font-style:italic");if(style?.underline||style?.strike)parts.push(`text-decoration:${[style.underline?"underline":"",style.strike?"line-through":""].filter(Boolean).join(" ")}`);return parts.join(";")}
function wrapSurface(inner:string,backgroundColor?:string){return backgroundColor?`<div style="background:${backgroundColor};padding:18px 20px;margin:0">${inner}</div>`:inner}
function renderRun(run:RichTextRun,linkColor?:string){let out=escTemplate(run.text).replace(/\n/g,"<br>");if(run.bold)out=`<strong>${out}</strong>`;if(run.italic)out=`<em>${out}</em>`;if(run.underline||run.strike)out=`<span style="text-decoration:${[run.underline?"underline":"",run.strike?"line-through":""].filter(Boolean).join(" ")}">${out}</span>`;if(run.color)out=`<span style="color:${run.color}">${out}</span>`;if(run.link)out=`<a href="${attr(run.link)}"${linkColor?` style="color:${linkColor}"`:""}>${out}</a>`;return out}
function rich(b:Extract<StructuredBlock,{type:"heading"|"text"}>){return b.richText?.runs.length?b.richText.runs.map(run=>renderRun(run,b.style?.linkColor)).join(""):escTemplate(b.text).replace(/\n/g,"<br>")}
function renderBlock(b:StructuredBlock):string{switch(b.type){
  case"heading":return wrapSurface(`<h${b.level} style="${css(b.style,b.align,b.spacing)}">${rich(b)}</h${b.level}>`,b.backgroundColor);
  case"text":return wrapSurface(`<p style="${css(b.style,b.align,b.spacing)}">${rich(b)}</p>`,b.backgroundColor);
  case"header":return wrapSurface(`<div style="${css(b.style,b.align,b.spacing)}">${escTemplate(b.text)}</div>`,b.backgroundColor);
  case"footer":return wrapSurface(`<div style="${css(b.style,b.align,b.spacing)}">${escTemplate(b.text)}</div>`,b.backgroundColor);
  case"image":{const image=`<img src="${attr(b.src)}" alt="${attr(b.alt)}"${b.width?` width="${Math.max(1,Math.min(1200,b.width))}"`:""} style="max-width:100%;height:auto${b.borderRadius!==undefined?`;border-radius:${Math.max(0,Math.min(80,b.borderRadius))}px`:""}">`;return `<p style="${css(undefined,b.align,b.spacing)}">${b.link?`<a href="${attr(b.link)}">${image}</a>`:image}</p>`}
  case"button":return `<p style="${css(undefined,b.align,b.spacing)}"><a href="${attr(b.url)}" style="display:inline-block;padding:12px 18px;border:1px solid ${b.borderColor??"#111111"};background:${b.backgroundColor??"transparent"};color:${b.textColor??"#111111"};text-decoration:none">${esc(b.label)}</a></p>`;
  case"divider":return `<hr style="border:0;border-top:1px ${b.style??"solid"} ${b.color??"#cccccc"};margin:${b.spacing?.top??20}px 0 ${b.spacing?.bottom??20}px">`;
  case"spacer":return `<div style="height:${Math.max(0,Math.min(120,b.height))}px;line-height:${Math.max(0,Math.min(120,b.height))}px">&nbsp;</div>`;
  case"social":return `<p style="margin:0 0 16px">${b.links.map(l=>`<a href="${attr(l.url)}">${esc(l.label)}</a>`).join(" &nbsp; ")}</p>`;
  case"columns":return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:${b.spacing?.top??0}px 0 ${b.spacing?.bottom??16}px"><tbody><tr>${b.columns.map(column=>`<td valign="top" width="${Math.floor(100/b.columns.length)}%">${column.blocks.map(renderBlock).join("")}</td>`).join("")}</tr></tbody></table>`;
  case"custom_html":return `<div data-custom-html="${attr(b.id)}" style="margin:${b.spacing?.top??0}px 0 ${b.spacing?.bottom??0}px">${b.html}</div>`;
  case"compliance_footer":return `{{ system.compliance_footer }}`;
}}

function plainBlock(block:StructuredBlock):string{switch(block.type){
  case"heading":case"text":case"header":case"footer":return block.text;
  case"button":return `${block.label}: ${block.url}`;
  case"image":return block.alt||"Image";
  case"social":return block.links.map(link=>`${link.label}: ${link.url}`).join("\n");
  case"columns":return block.columns.flatMap(column=>column.blocks.map(plainBlock)).filter(Boolean).join("\n\n");
  case"custom_html":return htmlToPlainText(block.html);
  case"compliance_footer":return "{{ system.compliance_footer_text }}";
  case"divider":case"spacer":return "";
}}

export function compileStructuredDraft(draft:EmailDraft){
  const html=draft.structuredDocument.blocks.map(renderBlock).join("\n");
  const generated=draft.structuredDocument.blocks.map(plainBlock).filter(Boolean).join("\n\n");
  const text=draft.plainTextMode==="auto" ? generated : draft.plainText;
  return {htmlTemplate:html,textTemplate:text,compilerVersion:"phase2-structured-v1",contentHash:stableContentHash([draft.subject,draft.preheader,html,text])};
}

export interface RenderContext {profile?:Record<string,unknown>;workspace:Record<string,unknown>;event?:Record<string,unknown>;system:Record<string,string>}
function get(obj:unknown,path:string):unknown{let cur:any=obj;for(const part of path.split(".")){if(cur==null||typeof cur!=="object")return undefined;cur=cur[part]}return cur}
export function resolveTemplate(template:string,ctx:RenderContext,htmlContext=true){return template.replace(/\{\{\s*(profile|workspace|event|system)\.([a-zA-Z0-9_.]+)(?:\s*\|\s*default:\s*"([^"]*)")?\s*\}\}/g,(_raw,ns,path,fallback)=>{const value=get((ctx as any)[ns],path);const out=value==null||value===""?(fallback??""):String(value);if(htmlContext&&ns==="system"&&path==="compliance_footer")return out;return htmlContext?esc(out):out})}
