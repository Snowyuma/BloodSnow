import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commands } from "../src/commands.js";
import { PermissionFlagsBits } from "discord.js";
test("panneau : autorisations, publication, sauvegarde, modification et retrait",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"bloodsnow-admin-"));
 Object.assign(process.env,{DATA_DIR:dir,DISCORD_TOKEN:"test",CLIENT_ID:"bot",GUILD_ID:"guild",MOD_LOG_CHANNEL_ID:"log"});
 const {handlePanelCommand,panelComponents}=await import("../src/panel-admin.js");const {loadRolePanels}=await import("../src/role-panels.js");
 let admin=false, action="creer", privileged=false;let opts:Record<string,any>={contenu:"Bonjour\\nTout le monde"};const sent:any[]=[],edits:any[]=[],replies:any[]=[];
 const message:any={id:"message",url:"message-url",author:{id:"bot"},content:"Bonjour",embeds:[],edit:async(p:any)=>{edits.push(p);Object.assign(message,p);return message;},delete:async()=>{}};
 const role={id:"role",managed:false,permissions:{any:()=>privileged}};
 const channel:any={id:"channel",isTextBased:()=>true,isThread:()=>false,permissionsFor:()=>({has:()=>true}),messages:{fetch:async()=>message},send:async(p:any)=>{sent.push(p);Object.assign(message,p);return message;}};
 const guild:any={id:"guild",ownerId:"owner",channels:{fetch:async()=>channel},roles:{fetch:async()=>role},members:{fetchMe:async()=>({permissions:{has:()=>true},roles:{highest:{comparePositionTo:()=>1}}}),fetch:async()=>({roles:{highest:{comparePositionTo:()=>1}}})}};
 const i:any={guild,channelId:"channel",client:{user:{id:"bot"}},user:{id:"owner"},memberPermissions:{has:()=>admin},options:{getSubcommand:()=>action,getString:(n:string)=>opts[n]??null,getInteger:(n:string)=>opts[n]??null,getChannel:()=>null,getRole:()=>role},editReply:async(p:any)=>replies.push(p)};
 try{
  await handlePanelCommand(i,async()=>{});assert.equal(sent.length,0);
  admin=true;await handlePanelCommand(i,async()=>{});assert.equal(sent[0].content,"Bonjour\nTout le monde");assert.deepEqual(sent[0].allowedMentions,{parse:[]});assert.equal((await loadRolePanels()).length,1);
  action="bouton";opts={message_id:"message",texte:"Accepter",mode:"add",couleur:3};privileged=true;await handlePanelCommand(i,async()=>{});assert.equal((await loadRolePanels())[0].buttons.length,0);
  privileged=false;await handlePanelCommand(i,async()=>{});let p=(await loadRolePanels())[0];assert.equal(p.buttons[0].mode,"add");assert.equal(panelComponents(p)[0].toJSON().components[0].custom_id,`bloodsnow:role:${p.buttons[0].id}`);
  opts.texte="Autre nom";await handlePanelCommand(i,async()=>{});assert.equal((await loadRolePanels())[0].buttons.length,1);
  action="modifier";opts={message_id:"message",contenu:"Nouveau texte"};await handlePanelCommand(i,async()=>{});assert.equal(edits.at(-1).content,"Nouveau texte");assert.equal((await loadRolePanels())[0].buttons.length,1);
  action="retirer";await handlePanelCommand(i,async()=>{});assert.equal((await loadRolePanels())[0].buttons.length,0);assert.deepEqual(edits.at(-1).components,[]);
  opts.message_id="étranger";const count=edits.length;await handlePanelCommand(i,async()=>{});assert.equal(edits.length,count);
  const schema=commands.find(c=>c.name==="panneau")!;assert.equal(schema.default_member_permissions,String(PermissionFlagsBits.Administrator));
 }finally{await rm(dir,{recursive:true,force:true});}
});
