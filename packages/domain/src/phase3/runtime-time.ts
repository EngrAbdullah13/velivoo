/**
 * Returns the next real instant whose wall-clock hour/minute in `timeZone` matches the target.
 * A bounded minute scan intentionally favors determinism over clever DST math: DST gaps are skipped,
 * overlaps resolve to the earliest future matching instant, and the chosen instant is auditable.
 */
export function nextLocalWallClockInstant(input:{after:Date;timeZone:string;hour:number;minute:number}):Date{
  const {after,timeZone,hour,minute}=input;
  if(hour<0||hour>23||minute<0||minute>59)throw new Error('WAIT_TIME_INVALID');
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const start=Math.floor(after.getTime()/60000)*60000+60000;
  const max=start+72*60*60000;
  for(let t=start;t<=max;t+=60000){
    const parts=Object.fromEntries(fmt.formatToParts(new Date(t)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    if(Number(parts.hour)===hour&&Number(parts.minute)===minute)return new Date(t);
  }
  throw new Error('WAIT_TIME_UNRESOLVABLE');
}

/**
 * Resolves a one-time calendar date at a local wall-clock time. The date is
 * deliberately interpreted as a calendar value (UTC year/month/day), then
 * resolved in the recipient's timezone by scanning real instants. This gives
 * the same explicit DST behavior as Wait Until: gaps are skipped and repeated
 * minutes use the earliest matching instant.
 */
export function localCalendarDateInstant(input:{date:Date;timeZone:string;hour:number;minute:number}):Date{
  const {date,timeZone,hour,minute}=input;
  if(hour<0||hour>23||minute<0||minute>59)throw new Error('DATE_TRIGGER_TIME_INVALID');
  const target={year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()};
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const start=Date.UTC(target.year,target.month-1,target.day-1,hour,minute);
  const end=start+72*60*60*1000;
  for(let t=start;t<=end;t+=60000){
    const parts=Object.fromEntries(fmt.formatToParts(new Date(t)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    if(Number(parts.year)===target.year&&Number(parts.month)===target.month&&Number(parts.day)===target.day&&Number(parts.hour)===hour&&Number(parts.minute)===minute)return new Date(t);
  }
  throw new Error('DATE_TRIGGER_TIME_UNRESOLVABLE');
}
