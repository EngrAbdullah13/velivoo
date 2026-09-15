import type { SenderDomainProvider } from "../../../application/src/ports/sender-domain-provider.js";
export class FakeSenderDomainProvider implements SenderDomainProvider {
  readonly provider="proof";
  readonly region="proof";
  async provision(context:any){return {expectedRecords:[{type:"CNAME" as const,host:`proof._domainkey.${context.domain}`,value:"proof.dkim.example",required:true}],providerReference:context.domain,providerRegion:this.region,providerStatus:"pending",providerEvidence:{proof:true},dkimStatus:"PENDING",mailFromStatus:"NOT_CONFIGURED"}}
  async check(context:any,expectedRecords:any[]){return {status:"verified" as const,observedRecords:expectedRecords.map(r=>({type:r.type,host:r.host,values:[r.value]})),providerStatus:"verified",providerEvidence:{domain:context.domain,proof:true},dkimStatus:"SUCCESS",mailFromStatus:"NOT_CONFIGURED"}}
  async remove(){/* Proof provider has no external identity to remove. */}
}
