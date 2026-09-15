export interface ObjectStore {
  put(key:string, content:string|Uint8Array):Promise<void>;
  get(key:string):Promise<Buffer>;
  delete(key:string):Promise<void>;
}
