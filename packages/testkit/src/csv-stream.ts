import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export async function* streamCsvRows(path: string): AsyncGenerator<string[]> {
  const input=createReadStream(path,{encoding:"utf8",highWaterMark:64*1024});const rl=createInterface({input,crlfDelay:Infinity});
  for await(const line of rl){yield parseCsvLine(line);}
}

function parseCsvLine(line:string):string[]{const out:string[]=[];let field="",quoted=false;for(let i=0;i<line.length;i++){const ch=line[i]!;if(ch==='"'){if(quoted&&line[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){out.push(field);field="";}else field+=ch;}out.push(field);return out;}
