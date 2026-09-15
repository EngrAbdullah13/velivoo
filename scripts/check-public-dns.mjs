import { Resolver } from "node:dns/promises";
import { loadEmailPlatformConfig } from "../packages/config/src/env.js";
import { staticBrandedDkimSelectorHost } from "../packages/domain/src/phase1/static-branded-dns.js";

const routingId = process.argv[2] ?? "d_1a470daf";
const cfg = loadEmailPlatformConfig();
const r = new Resolver();
r.setServers(["1.1.1.1", "8.8.8.8"]);

const vm1Host = staticBrandedDkimSelectorHost(routingId, "vm1", cfg.velivooStaticDnsDomain);
const vm2Host = staticBrandedDkimSelectorHost(routingId, "vm2", cfg.velivooStaticDnsDomain);

for (const host of [vm1Host, vm2Host, `send.lahorixsolutions.com`, `vm1._domainkey.lahorixsolutions.com`]) {
  try {
    const cname = await r.resolveCname(host).catch(() => null);
    const txt = await r.resolveTxt(host).catch(() => null);
    console.log(host, { cname, txt: txt?.map(parts => parts.join("")) });
  } catch (error) {
    console.log(host, error.code ?? error.message);
  }
}
