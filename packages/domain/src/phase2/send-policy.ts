export interface QuietHours { startHour:number; endHour:number; }
export interface SendPolicyConfig {
  version:number;
  frequencyWindowSeconds:number;
  frequencyMax:number;
  quietHours?:QuietHours;
  warmingDailyLimit?:number;
  /** Optional safety gate: once production sending has started, hold when
   * durable provider feedback has not been received inside this window. */
  feedbackStaleAfterSeconds?:number;
}

export function isQuietHour(now:Date, timezone:string, quiet?:QuietHours):boolean{
  if(!quiet)return false;
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:timezone,hour:"2-digit",hour12:false}).formatToParts(now);
  const hour=Number(parts.find(p=>p.type==="hour")?.value??0)%24;
  if(quiet.startHour===quiet.endHour)return true;
  return quiet.startHour<quiet.endHour?hour>=quiet.startHour&&hour<quiet.endHour:hour>=quiet.startHour||hour<quiet.endHour;
}

export function validateSendPolicyConfig(config:SendPolicyConfig):void{
  if(!Number.isInteger(config.version)||config.version<1||!Number.isInteger(config.frequencyWindowSeconds)||config.frequencyWindowSeconds<60||!Number.isInteger(config.frequencyMax)||config.frequencyMax<0)throw new Error("SEND_POLICY_INVALID");
  if(config.warmingDailyLimit!==undefined&&(!Number.isInteger(config.warmingDailyLimit)||config.warmingDailyLimit<1))throw new Error("SEND_POLICY_INVALID");
  if(config.feedbackStaleAfterSeconds!==undefined&&(!Number.isInteger(config.feedbackStaleAfterSeconds)||config.feedbackStaleAfterSeconds<60))throw new Error("SEND_POLICY_INVALID");
  if(config.quietHours&&(!Number.isInteger(config.quietHours.startHour)||!Number.isInteger(config.quietHours.endHour)||config.quietHours.startHour<0||config.quietHours.startHour>23||config.quietHours.endHour<0||config.quietHours.endHour>23))throw new Error("SEND_POLICY_QUIET_HOURS_INVALID");
}

export function frequencyAllowed(currentCount:number, config:SendPolicyConfig):boolean{
  return currentCount < Math.max(0,config.frequencyMax);
}
export function warmingAllowed(sentToday:number,config:SendPolicyConfig):boolean{
  return config.warmingDailyLimit===undefined || sentToday < config.warmingDailyLimit;
}
