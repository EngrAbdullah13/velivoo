import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export function issueApiKey(pepper:string){if(pepper.length<32)throw new Error('API_KEY_PEPPER_TOO_SHORT');const secret=`em_${randomBytes(24).toString('base64url')}`;return {secret,prefix:secret.slice(0,10),hash:hashApiKey(secret,pepper)}}
export function hashApiKey(secret:string,pepper:string){return createHmac('sha256',pepper).update(secret).digest('hex')}
export function verifyApiKey(secret:string,expectedHash:string,pepper:string){const actual=Buffer.from(hashApiKey(secret,pepper),'hex'),expected=Buffer.from(expectedHash,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected)}
