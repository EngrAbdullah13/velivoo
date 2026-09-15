import { resolveTxt, resolveCname, resolveMx } from "node:dns/promises";
import type { DnsResolver } from "../../../application/src/ports/dns-resolver.js";
import type { ExpectedDnsRecord, ObservedDnsRecord } from "../../../domain/src/phase1/dns.js";
export class NodeDnsResolver implements DnsResolver {
  async resolve(records:ExpectedDnsRecord[]):Promise<ObservedDnsRecord[]>{const out:ObservedDnsRecord[]=[];for(const r of records){try{if(r.type==="TXT"){const rows=await resolveTxt(r.host);out.push({type:"TXT",host:r.host,values:rows.map(parts=>parts.join(""))})}else if(r.type==="CNAME"){out.push({type:"CNAME",host:r.host,values:await resolveCname(r.host)})}else{const rows=await resolveMx(r.host);out.push({type:"MX",host:r.host,values:rows.map(x=>`${x.priority} ${x.exchange}`)})}}catch{out.push({type:r.type,host:r.host,values:[]})}}return out}
}
