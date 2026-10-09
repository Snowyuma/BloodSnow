import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("panneaux : règlement idempotent, choix réversible, faux panneau et rôle dangereux refusés", async () => {
 const dir=await mkdtemp(join(tmpdir(),"bloodsnow-panels-"));
 Object.assign(process.env,{DATA_DIR:dir,DISCORD_TOKEN:"test",CLIENT_ID:"1",GUILD_ID:"2",MOD_LOG_CHANNEL_ID:"3"});
 const {handleRoleButton}=await import("../src/role-panels.js");
 let has=false, dangerous=false; const changes:string[]=[], replies:string[]=[], logs:any[]=[];
 const role={id:"role",name:"choix",managed:false,permissions:{any:()=>dangerous}};
 const member={roles:{cache:{has:()=>has},add:async()=>{has=true;changes.push("add");},remove:async()=>{has=false;changes.push("remove");}}};
 const guild={id:"2",members:{fetch:async()=>member,fetchMe:async()=>({permissions:{has:()=>true},roles:{highest:{comparePositionTo:()=>1}}})},roles:{fetch:async()=>role}};
 const i:any={customId:"bloodsnow:role:accept",guild,guildId:"2",channelId:"channel",user:{id:"user"},client:{user:{id:"1"}},message:{id:"message",author:{id:"1"},url:"message-url"},deferReply:async(p:any)=>assert.equal(p.flags,64),editReply:async(s:string)=>replies.push(s)};
 const save=async(kind:string)=>writeFile(join(dir,"role-panels.json"),JSON.stringify([{guildId:"2",channelId:"channel",messageId:"message",kind,buttons:[{id:"accept",roleId:"role",label:"Accepter"}]}]));
 try {
  await save("rules");await handleRoleButton(i,async(...v)=>{logs.push(v);}); await handleRoleButton(i,async(...v)=>{logs.push(v);});assert.deepEqual(changes,["add"]);assert.equal(logs.length,1);
  await save("roles");await handleRoleButton(i,async()=>{});await handleRoleButton(i,async()=>{});assert.deepEqual(changes,["add","remove","add"]);
  i.message.id="forged";await handleRoleButton(i,async()=>{});assert.equal(changes.length,3);assert.match(replies.at(-1)!,/plus actif/);
  i.message.id="message";dangerous=true;await handleRoleButton(i,async()=>{});assert.equal(changes.length,3);assert.match(replies.at(-1)!,/ne peux pas/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
