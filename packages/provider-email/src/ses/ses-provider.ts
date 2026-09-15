// Real SES provider adapter. Requires `npm install` and AWS credentials.
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { EmailDeliveryProvider, ProviderLookupResult, ProviderSubmitInput, ProviderSubmitResult } from "../../../application/src/ports/email-delivery-provider.js";
export class SesEmailProvider implements EmailDeliveryProvider {
  readonly name="ses"; private clients=new Map<string,SESv2Client>();
  constructor(private region:string, private configurationSet?:string, private supportedRegions:readonly string[]=[region]){if(!region.trim())throw new Error("SES_REGION_NOT_CONFIGURED");}
  private client(region?:string){const selected=region?.trim()||this.region;if(!this.supportedRegions.includes(selected))throw new Error("SES_REGION_NOT_SUPPORTED");let client=this.clients.get(selected);if(!client){client=new SESv2Client({region:selected});this.clients.set(selected,client)}return client}
  async submit(input:ProviderSubmitInput):Promise<ProviderSubmitResult>{
    try{const tags=[{Name:"platformMessageId",Value:input.messageId},{Name:"requestFingerprint",Value:input.requestFingerprint.slice(0,64)},...(input.workspaceId?[{Name:"workspaceId",Value:input.workspaceId}]:[]),...(input.senderDomainId?[{Name:"senderDomainId",Value:input.senderDomainId}]:[]),...(input.routeId?[{Name:"deliveryRouteId",Value:input.routeId}]:[])];const out=await this.client(input.providerRegion).send(new SendEmailCommand({Content:{Raw:{Data:Buffer.from(input.rawMime)}},ConfigurationSetName:input.configurationSetName??this.configurationSet,EmailTags:tags}));if(!out.MessageId)return{status:"unknown"};return{status:"submitted",providerMessageId:out.MessageId};}
    catch(error:any){if(error?.message==="SES_REGION_NOT_SUPPORTED")return{status:"failed",code:"SES_REGION_NOT_SUPPORTED",retryable:false};if(error?.name==="TimeoutError"||error?.$metadata?.httpStatusCode===undefined)return{status:"unknown"};const message=String(error?.message??"").toLowerCase();const code=error?.name==="MessageRejected"&&message.includes("not verified")?"SES_IDENTITY_NOT_VERIFIED":String(error?.name??"SES_ERROR");return{status:"failed",code,retryable:[429,500,502,503,504].includes(Number(error?.$metadata?.httpStatusCode))};}
  }
  async lookupSubmission(_requestFingerprint:string):Promise<ProviderLookupResult>{return{status:"unknown"};}
}
