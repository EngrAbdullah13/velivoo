import { GetIdentityVerificationAttributesCommand, SESClient, VerifyDomainIdentityCommand } from "@aws-sdk/client-ses";
import { CreateConfigurationSetCommand, CreateConfigurationSetEventDestinationCommand, CreateEmailIdentityCommand, DeleteEmailIdentityCommand, GetAccountCommand, GetConfigurationSetCommand, GetEmailIdentityCommand, PutEmailIdentityConfigurationSetAttributesCommand, PutEmailIdentityDkimSigningAttributesCommand, PutEmailIdentityMailFromAttributesCommand, SESv2Client, UpdateConfigurationSetEventDestinationCommand, type EventDestinationDefinition, type EventType } from "@aws-sdk/client-sesv2";
import type { EmailDomainIdentityState, EmailDomainProvider } from "../../../application/src/ports/email-domain-provider.js";
import type { ManagedDnsRecord } from "../../../application/src/ports/dns-provider.js";
import { dkimPrivateKeyForSes } from "../../../domain/src/phase1/dkim-key.js";

type SesSend=Pick<SESv2Client,"send">;
type SesV1Send=Pick<SESClient,"send">;
function code(error:unknown,operation:string){const name=error&&typeof error==="object"&&"name" in error?String((error as any).name):"",status=Number((error as any)?.$metadata?.httpStatusCode);if(name==="NotFoundException")return new Error("NOT_FOUND");if(name.includes("AccessDenied")||status===403)return new Error("AWS_ACCESS_DENIED");if(["TooManyRequestsException","ThrottlingException"].includes(name)||status===429)return new Error("AWS_THROTTLED");if(["UnrecognizedClientException","InvalidClientTokenId","SignatureDoesNotMatch","CredentialsProviderError"].includes(name))return new Error("PROVIDER_AUTHENTICATION_FAILED");return new Error(`EMAIL_${operation}_FAILED`)}
const missing=(error:unknown)=>{if(!(error instanceof Error))return false;if(error.message==="NOT_FOUND")return true;if("name" in error&&String((error as {name?:string}).name)==="NotFoundException")return true;return /not found/i.test(error.message)};
function ownershipRecord(domain:string,token:string):ManagedDnsRecord{return {type:"TXT",name:`_amazonses.${domain}`,values:[token],ttl:300}}
export class SesEmailDomainProvider implements EmailDomainProvider {
  readonly provider="ses";
  private readonly client:SesSend;
  private readonly classic:SesV1Send|undefined;
  constructor(readonly region:string,client?:SesSend,classic?:SesV1Send){
    if(!region)throw new Error("SES_REGION_NOT_CONFIGURED");
    this.client=client??new SESv2Client({region,maxAttempts:5});
    this.classic=classic??(client?undefined:new SESClient({region,maxAttempts:5}));
  }
  private async raw(domain:string){try{return await this.client.send(new GetEmailIdentityCommand({EmailIdentity:domain}))}catch(error){throw code(error,"IDENTITY_LOOKUP")}}
  private state(domain:string,reference:string,result:any):EmailDomainIdentityState{
    const tokens=(result?.DkimAttributes?.Tokens??[]).filter((value:unknown)=>typeof value==="string");
    const hostedZone=typeof result?.DkimAttributes?.SigningHostedZone==="string"?result.DkimAttributes.SigningHostedZone.replace(/\.$/,""):null;
    const verificationStatus=String(result?.VerificationStatus??"PENDING");
    const verifiedForSending=result?.VerifiedForSendingStatus===true;
    const signingAttributes=result?.DkimAttributes?.SigningAttributes;
    const tokenSelector=Array.isArray(result?.DkimAttributes?.Tokens)&&typeof result.DkimAttributes.Tokens[0]==="string"?result.DkimAttributes.Tokens[0]:null;
    const dkimSigningSelector=typeof signingAttributes?.DomainSigningSelector==="string"?signingAttributes.DomainSigningSelector:typeof result?.DkimAttributes?.DomainSigningSelector==="string"?result.DkimAttributes.DomainSigningSelector:tokenSelector;
    return {
      reference,
      identityVerified:verificationStatus==="SUCCESS"&&verifiedForSending,
      verifiedForSending,
      verificationStatus,
      dkimStatus:String(result?.DkimAttributes?.Status??"PENDING"),
      dkimSigningOrigin:String(result?.DkimAttributes?.SigningAttributesOrigin??""),
      dkimSigningSelector,
      mailFromStatus:String(result?.MailFromAttributes?.MailFromDomainStatus??"PENDING"),
      mailFromDomain:typeof result?.MailFromAttributes?.MailFromDomain==="string"?result.MailFromAttributes.MailFromDomain:null,
      dkimTokens:tokens,
      dkimSigningHostedZone:hostedZone,
      dkimRecords:hostedZone?tokens.map((token:string)=>({type:"CNAME",name:`${token}._domainkey.${domain}`,values:[`${token}.${hostedZone}`],ttl:300})):[],
    };
  }
  private async ownership(domain:string):Promise<{token:string;record:ManagedDnsRecord}>{
    if(!this.classic)throw new Error("EMAIL_IDENTITY_VERIFICATION_TOKEN_MISSING");
    try{
      const result:any=await this.classic.send(new GetIdentityVerificationAttributesCommand({Identities:[domain]}));
      const token=result?.VerificationAttributes?.[domain]?.VerificationToken;
      if(typeof token==="string"&&token.trim())return {token:token.trim(),record:ownershipRecord(domain,token.trim())};
    }catch(error){throw code(error,"OWNERSHIP_LOOKUP")}
    try{
      const created:any=await this.classic.send(new VerifyDomainIdentityCommand({Domain:domain}));
      const token=created?.VerificationToken;
      if(typeof token==="string"&&token.trim())return {token:token.trim(),record:ownershipRecord(domain,token.trim())};
    }catch(error){throw code(error,"OWNERSHIP_CREATE")}
    throw new Error("EMAIL_IDENTITY_VERIFICATION_TOKEN_MISSING");
  }
  private async withOwnership(domain:string,state:EmailDomainIdentityState){
    if(!this.classic)return state;
    const ownership=await this.ownership(domain);
    return {...state,ownershipVerificationToken:ownership.token,ownershipVerificationRecord:ownership.record};
  }
  private async withEasyDkim(domain:string,reference:string){
    let result:any=await this.raw(reference),state=this.state(domain,reference,result);
    if(state.dkimRecords.length===3&&state.dkimSigningHostedZone)return this.withOwnership(domain,state);
    try{await this.client.send(new PutEmailIdentityDkimSigningAttributesCommand({EmailIdentity:reference,SigningAttributesOrigin:"AWS_SES"}))}catch(error){throw code(error,"DKIM_ENABLE")}
    result=await this.raw(reference);return this.withOwnership(domain,this.state(domain,reference,result));
  }
  async ensureIdentity(input:{domain:string;existingReference?:string|null;workspaceId?:string;senderDomainId?:string}){const reference=input.existingReference||input.domain;try{return await this.withEasyDkim(input.domain,reference)}catch(error){if(!missing(error))throw error;try{const created:any=await this.client.send(new CreateEmailIdentityCommand({EmailIdentity:input.domain,Tags:input.workspaceId&&input.senderDomainId?[{Key:"velivoo:workspace",Value:input.workspaceId},{Key:"velivoo:sender-domain",Value:input.senderDomainId}]:undefined}));if(created?.DkimAttributes?.Tokens?.length)return this.withOwnership(input.domain,this.state(input.domain,input.domain,created));return await this.withEasyDkim(input.domain,input.domain)}catch(createError){throw missing(createError)?new Error("EMAIL_IDENTITY_CREATE_FAILED"):createError}}}
  async ensureByodkimIdentity(input:{domain:string;selector:string;privateKeyPem:string;existingReference?:string|null;workspaceId?:string;senderDomainId?:string}){
    const identityName=input.domain;
    const signingAttributes={DomainSigningSelector:input.selector,DomainSigningPrivateKey:dkimPrivateKeyForSes(input.privateKeyPem)};
    let identityExists=false;
    let existing:any=null;
    try{existing=await this.raw(identityName);identityExists=true}catch(error){const mapped=code(error,"IDENTITY_LOOKUP");if(!missing(error)&&!missing(mapped))throw mapped}
    const currentOrigin=String(existing?.DkimAttributes?.SigningAttributesOrigin??"");
    const currentSelector=String(existing?.DkimAttributes?.SigningAttributes?.DomainSigningSelector??existing?.DkimAttributes?.Tokens?.[0]??"");
    const currentStatus=String(existing?.DkimAttributes?.Status??"");
    if(identityExists&&currentOrigin==="EXTERNAL"&&currentSelector===input.selector&&currentStatus==="SUCCESS"){
      return this.getIdentity({domain:input.domain,reference:identityName});
    }
    try{
      if(identityExists){
        await this.client.send(new PutEmailIdentityDkimSigningAttributesCommand({EmailIdentity:identityName,SigningAttributesOrigin:"EXTERNAL",SigningAttributes:signingAttributes}));
      }else{
        await this.client.send(new CreateEmailIdentityCommand({
          EmailIdentity:identityName,
          Tags:input.workspaceId&&input.senderDomainId?[{Key:"velivoo:workspace",Value:input.workspaceId},{Key:"velivoo:sender-domain",Value:input.senderDomainId}]:undefined,
          DkimSigningAttributes:{DomainSigningAttributesOrigin:"EXTERNAL",...signingAttributes},
        }));
      }
    }catch(error){throw code(error,identityExists?"BYODKIM_CONFIGURE":"BYODKIM_CREATE")}
    return this.getIdentity({domain:input.domain,reference:identityName});
  }
  async getIdentity(input:{domain:string;reference?:string|null}){const reference=input.reference||input.domain;return this.withOwnership(input.domain,this.state(input.domain,reference,await this.raw(reference)))}
  async inspectIdentity(emailIdentity:string){const result=await this.raw(emailIdentity);return {region:this.region,emailIdentity,raw:result,state:this.state(emailIdentity,emailIdentity,result)}}
  async configureMailFrom(input:{domain:string;mailFromDomain:string;behaviorOnMxFailure?:"REJECT_MESSAGE"|"USE_DEFAULT_VALUE"}){const behaviorOnMxFailure=input.behaviorOnMxFailure??"REJECT_MESSAGE";try{await this.client.send(new PutEmailIdentityMailFromAttributesCommand({EmailIdentity:input.domain,MailFromDomain:input.mailFromDomain,BehaviorOnMxFailure:behaviorOnMxFailure}))}catch(error){throw code(error,"MAIL_FROM_CONFIGURE")};return [{type:"MX",name:input.mailFromDomain,values:[`10 feedback-smtp.${this.region}.amazonses.com`],ttl:300},{type:"TXT",name:input.mailFromDomain,values:["\"v=spf1 include:amazonses.com ~all\""],ttl:300}] satisfies ManagedDnsRecord[]}
  async ensureWorkspaceConfigurationSet(input:{workspaceId:string;existingName?:string|null;snsTopicArn?:string}){const name=input.existingName||`workspace-${input.workspaceId.replaceAll("-","").slice(0,32)}`;try{await this.client.send(new GetConfigurationSetCommand({ConfigurationSetName:name}))}catch(error){const mapped=code(error,"CONFIGURATION_SET_LOOKUP");if(!missing(mapped))throw mapped;try{await this.client.send(new CreateConfigurationSetCommand({ConfigurationSetName:name,SendingOptions:{SendingEnabled:true}}))}catch(createError){if((createError as any)?.name!=="AlreadyExistsException")throw code(createError,"CONFIGURATION_SET_CREATE")}}
    if(!input.snsTopicArn)return {name,feedbackReady:false};
    const destination:EventDestinationDefinition={Enabled:true,MatchingEventTypes:["SEND","RENDERING_FAILURE","REJECT","DELIVERY","DELIVERY_DELAY","BOUNCE","COMPLAINT"] satisfies EventType[],SnsDestination:{TopicArn:input.snsTopicArn}};
    try{await this.client.send(new CreateConfigurationSetEventDestinationCommand({ConfigurationSetName:name,EventDestinationName:"workspace-feedback",EventDestination:destination}))}catch(error){if((error as any)?.name!=="AlreadyExistsException")throw code(error,"EVENT_DESTINATION_CREATE");try{await this.client.send(new UpdateConfigurationSetEventDestinationCommand({ConfigurationSetName:name,EventDestinationName:"workspace-feedback",EventDestination:destination}))}catch(updateError){throw code(updateError,"EVENT_DESTINATION_UPDATE")}}
    return {name,feedbackReady:true};
  }
  async associateConfigurationSet(input:{domain:string;configurationSetName:string}){try{await this.client.send(new PutEmailIdentityConfigurationSetAttributesCommand({EmailIdentity:input.domain,ConfigurationSetName:input.configurationSetName}))}catch(error){throw code(error,"IDENTITY_CONFIGURATION_SET")}}
  async readQuota(){try{const result:any=await this.client.send(new GetAccountCommand({}));return {max24Hour:result?.SendQuota?.Max24HourSend,maxSendRate:result?.SendQuota?.MaxSendRate,sentLast24Hours:result?.SendQuota?.SentLast24Hours}}catch(error){throw code(error,"QUOTA_LOOKUP")}}
  async removeIdentity(input:{domain:string;reference?:string|null}){const identity=input.reference||input.domain;console.error(JSON.stringify({event:"domain.delete",step:"ses.DeleteEmailIdentity",identity,region:this.region}));try{await this.client.send(new DeleteEmailIdentityCommand({EmailIdentity:identity}));console.error(JSON.stringify({event:"domain.delete",step:"ses.DeleteEmailIdentity.done",identity,region:this.region}));return {}}catch(error){const mapped=code(error,"IDENTITY_DELETE");const alreadyMissing=missing(mapped)||missing(error)||/not found/i.test(error instanceof Error?error.message:String(error));console.error(JSON.stringify({event:"domain.delete",step:alreadyMissing?"ses.DeleteEmailIdentity.already_missing":"ses.DeleteEmailIdentity.failed",identity,region:this.region,code:mapped.message}));if(!alreadyMissing)throw mapped;return {alreadyMissing:true}}}
}
