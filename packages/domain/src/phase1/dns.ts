import { domainToASCII } from "node:url";
import { parse } from "tldts";

export type DnsRecordType = "TXT" | "CNAME" | "MX" | "NS" | "SOA";
export interface ExpectedDnsRecord { type: DnsRecordType; host: string; value: string; required?: boolean; }
export interface ObservedDnsRecord { type: DnsRecordType; host: string; values: string[]; }
export interface DnsCheckResult { status: "verified" | "warning" | "failed"; checks: Array<{record:ExpectedDnsRecord; passed:boolean; observed:string[]}>; }

export function normalizeDomain(input: string): string {
  const raw=input.trim();
  if(raw.includes("@"))throw new Error("EMAIL_USED_INSTEAD_OF_DOMAIN");
  if(/^\w+:\/\//i.test(raw)||raw.includes("/")||raw.includes(":")||raw.startsWith("*."))throw new Error("URL_USED_INSTEAD_OF_DOMAIN");
  const ascii=domainToASCII(raw.toLowerCase().replace(/\.$/,""));
  if(!ascii||ascii.length>253||["localhost","local","internal"].includes(ascii)||/\.(?:localhost|local|internal|invalid|test|example|onion)$/.test(ascii))throw new Error("INVALID_DOMAIN");
  const result=parse(ascii,{allowPrivateDomains:false});
  if(result.isIp||!result.domain||!result.publicSuffix)throw new Error("INVALID_DOMAIN");
  if(result.subdomain&&result.subdomain!=="www")throw new Error("DOMAIN_MUST_BE_REGISTRABLE_ROOT");
  return result.domain;
}

export const canonicalDnsName=(value:string)=>value.trim().toLowerCase().replace(/\.$/,"");
export function sameDnsSet(actual:string[],expected:string[]){
  const a=[...new Set(actual.map(canonicalDnsName))].sort(),e=[...new Set(expected.map(canonicalDnsName))].sort();
  return a.length===e.length&&a.every((value,index)=>value===e[index]);
}

export function rewriteSoaPrimary(value:string,primary:string){
  const parts=value.trim().split(/\s+/);
  if(parts.length<7)throw new Error("SOA_RECORD_INVALID");
  parts[0]=`${canonicalDnsName(primary)}.`;
  return parts.join(" ");
}

export function normalizeTxtContent(values:string|string[]){
  const parts=Array.isArray(values)?values:[values];
  const cleaned=parts.map(value=>value.trim().replace(/^"|"$/g,""));
  cleaned.sort((left,right)=>{
    const leftDkim=/^v=DKIM1/i.test(left),rightDkim=/^v=DKIM1/i.test(right);
    if(leftDkim&&!rightDkim)return -1;
    if(rightDkim&&!leftDkim)return 1;
    return 0;
  });
  return cleaned.join("").replace(/\s+/g," ").trim();
}

/** Route53 TXT records allow at most 255 characters per string; longer values must be split. */
export function route53TxtValues(unquoted:string){
  const text=normalizeTxtContent(unquoted);
  if(!text.length)throw new Error("TXT_VALUE_EMPTY");
  if(text.length<=255)return [`"${text}"`];
  const chunks:string[]=[];
  for(let index=0;index<text.length;index+=255)chunks.push(`"${text.slice(index,index+255)}"`);
  return chunks;
}

export function txtMatches(observed:string[],expected:string){
  const want=normalizeTxtContent(expected).toLowerCase();
  const joined=normalizeTxtContent(observed).toLowerCase();
  if(joined===want)return true;
  return observed.some(value=>normalizeTxtContent(value).toLowerCase()===want);
}

export function evaluateDns(expected: ExpectedDnsRecord[], observed: ObservedDnsRecord[]): DnsCheckResult {
  const checks=expected.map((record)=>{
    const match=observed.find((o)=>o.type===record.type && o.host.toLowerCase()===record.host.toLowerCase());
    const values=match?.values ?? [];
    return {record,passed:values.some((v)=>v.trim().replace(/\.$/,"").toLowerCase()===record.value.trim().replace(/\.$/,"").toLowerCase()),observed:values};
  });
  if (checks.some((c)=>c.record.required!==false && !c.passed)) return {status:"failed",checks};
  if (checks.some((c)=>!c.passed)) return {status:"warning",checks};
  return {status:"verified",checks};
}
