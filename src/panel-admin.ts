import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, Guild, PermissionFlagsBits } from "discord.js";
import { loadRolePanels, RolePanel, dangerousRolePermissions } from "./role-panels.js";
import { getGuildConfig } from "./config.js";
let queue: Promise<unknown> = Promise.resolve();
export function serializePanelChange<T>(fn:()=>Promise<T>):Promise<T> {
 const run=queue.then(fn,fn);queue=run.catch(()=>{});return run;
}
export async function saveRolePanels(panels:RolePanel[]) {
 const dir=process.env.DATA_DIR??"./data";await mkdir(dir,{recursive:true});
 const path=join(dir,"role-panels.json"), tmp=path+".tmp";
 await writeFile(tmp,JSON.stringify(panels,null,2));await rename(tmp,path);
}
export function panelComponents(panel:RolePanel) {
 const rows:ActionRowBuilder<ButtonBuilder>[]=[];
 for(let n=0;n<panel.buttons.length;n+=5) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(panel.buttons.slice(n,n+5).map(b=>new ButtonBuilder().setCustomId(`bloodsnow:role:${b.id}`).setLabel(b.label).setStyle(b.style??ButtonStyle.Primary))));
 return rows;
}
export async function handlePanelCommand(i:ChatInputCommandInteraction,journal:(g:Guild,t:string,b:string,c:number)=>Promise<unknown>) {
 if(!i.guild || !getGuildConfig(i.guild.id) || !i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return i.editReply("Commande réservée aux administrateurs du serveur configuré.");
 return serializePanelChange(async()=>{
 const guild=i.guild!, panels=await loadRolePanels(), action=i.options.getSubcommand();
 if(action==="lister") {
 const mine=panels.filter(p=>p.guildId===guild.id);
 const text=mine.map(p=>`• ${p.messageId} — ${p.buttons.length} bouton(s) — https://discord.com/channels/${p.guildId}/${p.channelId}/${p.messageId}`).join("\n");
 return text.length<=1900 ? i.editReply(text||"Aucun panneau enregistré.") : i.editReply({content:`${mine.length} panneaux enregistrés.`,files:[{attachment:Buffer.from(text),name:"panneaux.txt"}]});
 }
 const id=i.options.getString("message_id"), panel=panels.find(p=>p.guildId===guild.id&&p.messageId===id);
 if(action!=="creer"&&!panel) return i.editReply("Panneau inconnu. Utilise /panneau lister pour obtenir son identifiant.");
 const channelId=panel?.channelId??i.options.getChannel("salon")?.id??i.channelId;
 const channel=await guild.channels.fetch(channelId);
 if(!channel?.isTextBased() || !("send" in channel)) return i.editReply("Choisis un salon textuel accessible.");
 const me=await guild.members.fetchMe(), permissions=channel.permissionsFor(me);
 const sendPermission=channel.isThread()?PermissionFlagsBits.SendMessagesInThreads:PermissionFlagsBits.SendMessages;
 if(!permissions?.has([PermissionFlagsBits.ViewChannel,sendPermission,PermissionFlagsBits.ReadMessageHistory])) return i.editReply("Il me manque les permissions de voir le salon, écrire ou lire son historique.");
 const message=panel?await channel.messages.fetch(panel.messageId).catch(()=>null):null;
 if(panel&&(!message||message.author.id!==i.client.user.id)) return i.editReply("Le message est introuvable ou n’appartient pas à BloodSnow.");
 const content=i.options.getString("contenu")?.replace(/\\n/g,"\n"), title=i.options.getString("titre"), image=i.options.getString("image_url");
 if(image&&image!=="aucune") {try{if(new URL(image).protocol!=="https:")throw Error();}catch{return i.editReply("L’image doit être une URL HTTPS (ou aucune pour la retirer).");}}
 let result=message;
 if(action==="creer"||action==="modifier") {
  if(action==="modifier"&&content===undefined&&title===null&&image===null) return i.editReply("Indique au moins un contenu, un titre ou une image à modifier.");
  const embedded=!!title||!!image||!!message?.embeds.length;
  if(embedded&&!permissions.has(PermissionFlagsBits.EmbedLinks))return i.editReply("Il me manque la permission Intégrer des liens.");
  const embed=embedded?(message?.embeds[0]?EmbedBuilder.from(message.embeds[0]):new EmbedBuilder().setColor(0x8bd3f7)):null;
  if(embed) { if(title)embed.setTitle(title);if(content!==undefined)embed.setDescription(content);else if(!message?.embeds.length&&message?.content)embed.setDescription(message.content);if(image)embed.setImage(image==="aucune"?null:image); }
  const payload={content:embed?"":content??message?.content??"",embeds:embed?[embed]:[],allowedMentions:{parse:[] as []}};
  if(action==="creer") {
   result=await channel.send(payload);panels.push({guildId:guild.id,channelId:channel.id,messageId:result.id,kind:"roles",buttons:[]});
   try{await saveRolePanels(panels);}catch(error){await result.delete().catch(()=>{});throw error;}
  } else {await message!.edit(payload);}
 } else {
  const roleId=i.options.getRole("role",true).id;
  if(action==="retirer") {
   if(!panel!.buttons.some(b=>b.roleId===roleId))return i.editReply("Ce rôle n’a pas de bouton sur ce panneau.");
   panel!.buttons=panel!.buttons.filter(b=>b.roleId!==roleId);
  } else {
   const role=await guild.roles.fetch(roleId), actor=await guild.members.fetch(i.user.id);
   if(!role||role.id===guild.id||role.managed||role.permissions.any(dangerousRolePermissions)||!me.permissions.has(PermissionFlagsBits.ManageRoles)||me.roles.highest.comparePositionTo(role)<=0||(guild.ownerId!==i.user.id&&actor.roles.highest.comparePositionTo(role)<=0))return i.editReply("Rôle refusé : rôle privilégié, géré par une application ou trop haut dans la hiérarchie.");
   const old=panel!.buttons.find(b=>b.roleId===roleId);
   if(!old&&panel!.buttons.length>=25)return i.editReply("Maximum de 25 boutons atteint. Retire un bouton avant d’en ajouter un.");
   const b={id:old?.id??randomUUID(),roleId,label:i.options.getString("texte",true),mode:(i.options.getString("mode")??old?.mode??(panel!.kind==="rules"?"add":"toggle")) as "add"|"toggle",style:i.options.getInteger("couleur")??old?.style??1};
   if(old)Object.assign(old,b);else panel!.buttons.push(b);
  }
  // Persist first: a removed button fails closed even if Discord refuses the edit.
  await saveRolePanels(panels);await message!.edit({components:panelComponents(panel!)});
 }
 await i.editReply(`Panneau ${action==="creer"?"créé":"mis à jour"} : ${result!.url}\nIdentifiant : ${result!.id}`);
 await journal(guild,`Panneau : ${action}`,`Administrateur : ${i.user} (${i.user.id})\nMessage : ${result!.url}`,0x8bd3f7);
 });
}
