import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { ObjectStore } from "../../application/src/ports/object-store.js";

export class LocalObjectStore implements ObjectStore {
  private readonly rootPath:string;
  constructor(root:string){this.rootPath=resolve(root)}
  private path(key:string):string{
    if(!key||key.includes("\0"))throw new Error("OBJECT_KEY_INVALID");
    const target=resolve(this.rootPath,key.replaceAll("\\","/"));
    if(target!==this.rootPath&&!target.startsWith(this.rootPath+sep))throw new Error("OBJECT_KEY_OUTSIDE_ROOT");
    return target;
  }
  async put(key:string,content:string|Uint8Array):Promise<void>{const p=this.path(key);await mkdir(dirname(p),{recursive:true});await writeFile(p,content)}
  async get(key:string):Promise<Buffer>{return readFile(this.path(key))}
  async delete(key:string):Promise<void>{await rm(this.path(key),{force:true})}
}
