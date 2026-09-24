import { apiBaseUrl } from "./api-url";

export async function phase4Api(path:string,init?:RequestInit){const base=apiBaseUrl();const r=await fetch(`${base}${path}`,{...init,credentials:'include',headers:{'content-type':'application/json','x-dev-user':process.env.NEXT_PUBLIC_DEV_USER??'dev-owner',...(init?.headers??{})},cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error?.message??data.error??`HTTP_${r.status}`);return data}
