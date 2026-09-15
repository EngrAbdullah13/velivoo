import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryPhase2Repository } from "../packages/persistence/src/proof/in-memory-phase2-repository.js";
import { LocalObjectStore } from "../packages/object-store/src/local-object-store.js";
import { FakeEmailProvider } from "../packages/provider-email/src/proof/fake-email-provider.js";
import { Phase2Service } from "../packages/application/src/phase2/phase2-service.js";

const workspaceId="11111111-1111-4111-8111-111111111111",userId="22222222-2222-4222-8222-222222222222";
test("advanced content assets, template approvals, and usage stay tenant-scoped",async()=>{
  const root=await mkdtemp(join(tmpdir(),"content-assets-")),repo=new InMemoryPhase2Repository(),service=new Phase2Service(repo,new LocalObjectStore(root),new FakeEmailProvider(),{publicBaseUrl:"https://mail.example.test",unsubscribeSecret:"u".repeat(32),trackingSecret:"t".repeat(32),maxMessageBytes:500000});
  repo.seedWorkspace({id:workspaceId,businessAddress:"1 Test Street",timezone:"UTC",legalName:"Test Brand"},userId,"owner");
  const actor={workspaceId,userId};
  try{
    const universal=await service.createUniversalBlock(actor,{name:"Promo",blocks:[{id:"copy",type:"text",text:"Use {{ workspace.promo_code }}"}]});
    const media=await service.createMedia(actor,{name:"Logo",url:"https://cdn.example.test/logo.png",altText:"Test logo"});
    const brand=await service.saveBrand(actor,{logoUrl:media.url,primaryColor:"#6846ed",secondaryColor:"#17131c",fontFamily:"Arial, sans-serif"});
    const variable=await service.createCustomVariable(actor,{key:"promo_code",label:"Promo code",defaultValue:"WELCOME",type:"text"});
    assert.equal((await service.universalBlocks(actor)).at(0)?.id,universal.id);assert.equal((await service.media(actor)).at(0)?.id,media.id);assert.equal(brand.primaryColor,"#6846ed");assert.ok((await service.variables(actor)).some(item=>item.key==="workspace.promo_code"));
    const template=await service.createTemplate(actor,{name:"Welcome"});
    await service.updateTemplateContent(actor,template.id,{document:{schemaVersion:1,blocks:[{id:"copy",type:"text",text:"Welcome {{ workspace.promo_code }}"},{id:"compliance",type:"compliance_footer",locked:true}]},subject:"Welcome",preheader:"A welcome",plainText:"Welcome WELCOME"});
    assert.equal((await service.templatePreflight(actor,template.id)).ok,true);
    const approved=await service.approveTemplate(actor,template.id);
    assert.equal(approved.versionNumber,1);assert.equal((await service.templateVersions(actor,template.id))[0]?.contentHash,approved.contentHash);
    const email=await service.createEmail(actor,{internalName:"Campaign from template",templateId:template.id});
    assert.equal((await service.templateUsage(actor,template.id))[0]?.referenceId,email.id);
    const other={workspaceId:"33333333-3333-4333-8333-333333333333",userId:"44444444-4444-4444-8444-444444444444"};repo.seedWorkspace({id:other.workspaceId,businessAddress:"2 Test Street",timezone:"UTC",legalName:"Other"},other.userId,"owner");
    await assert.rejects(()=>service.templateUsage(other,template.id),/TEMPLATE_NOT_FOUND/);
    await service.archiveCustomVariable(actor,variable.id);assert.equal((await service.customVariables(actor)).length,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("system starter templates clone into tenant-owned editable templates and campaigns pin approved snapshots",async()=>{
  const root=await mkdtemp(join(tmpdir(),"starter-templates-")),repo=new InMemoryPhase2Repository(),service=new Phase2Service(repo,new LocalObjectStore(root),new FakeEmailProvider(),{publicBaseUrl:"https://mail.example.test",unsubscribeSecret:"u".repeat(32),trackingSecret:"t".repeat(32),maxMessageBytes:500000});
  repo.seedWorkspace({id:workspaceId,businessAddress:"1 Test Street",timezone:"UTC",legalName:"Test Brand"},userId,"owner");
  const actor={workspaceId,userId};
  try{
    const library=await service.templates(actor);
    assert.equal(library.systemTemplates.length,5);
    const starter=library.systemTemplates.find(template=>template.id==="saas-product-launch")!;
    assert.ok(starter.document.blocks.some(block=>block.type==="button"));
    const clone=await service.useSystemTemplate(actor,starter.id);
    assert.equal(clone.workspaceId,workspaceId);assert.equal(clone.settings?.systemTemplateId,starter.id);
    await service.setTemplateFavorite(actor,clone.id,true);assert.equal((await service.template(actor,clone.id)).settings?.favorite,true);
    const approved=await service.approveTemplate(actor,clone.id);
    const campaign=await service.createCampaignFromApprovedTemplate(actor,clone.id,{internalName:"Launch campaign"});
    assert.equal(campaign.subject,starter.subject);assert.equal((await service.templateUsage(actor,clone.id))[0]?.templateVersionId,approved.id);
    const other={workspaceId:"33333333-3333-4333-8333-333333333333",userId:"44444444-4444-4444-8444-444444444444"};repo.seedWorkspace({id:other.workspaceId,businessAddress:"2 Test Street",timezone:"UTC",legalName:"Other"},other.userId,"owner");
    await assert.rejects(()=>service.useSystemTemplate(other,"not-a-starter"),/SYSTEM_TEMPLATE_NOT_FOUND/);
    await assert.rejects(()=>service.setTemplateFavorite(other,clone.id,true),/TEMPLATE_NOT_FOUND/);
  }finally{await rm(root,{recursive:true,force:true});}
});
