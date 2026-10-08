# BloodSnow

Bot Discord de modération dérivé d’Avrilou, en TypeScript et discord.js.

## Installation

Node.js 22.12 minimum (24 recommandé). Dans VS Code, ouvrir ce dossier.

```powershell
npm install
Copy-Item .env.example .env
# Compléter .env localement
npm run check:setup
npm run check
npm run build
npm run deploy:commands
npm run start:prod
```

`pnpm install --frozen-lockfile` convient également. Ne lancer qu’une instance par dossier de données.

Dans le portail Discord, créer **BloodSnow**, activer **Server Members Intent** et **Message Content Intent**, puis inviter avec les scopes `bot` et `applications.commands`. Permissions nécessaires : voir les salons, lire l’historique, envoyer des messages, intégrer des liens, joindre des fichiers, gérer les messages/salons, voir le journal d’audit, bannir/expulser/modérer des membres. Placer le rôle BloodSnow au-dessus des membres à modérer. Le bot n’a pas besoin d’Administrateur.

Renseigner le token du **nouveau** bot, son Application ID (`CLIENT_ID`), le serveur et les salons dans `.env`. Ne jamais publier ce fichier. Le salon des logs doit être réservé au staff : les logs peuvent contenir les messages supprimés et les raisons de sanction. Aucun ancien serveur, token ou historique personnel d’Avrilou n’est copié.

## Commandes

- `/ban`, `/unban` : bans permanents ou temporaires (`30m`, `12h`, `7j`). Échéances persistantes ; nouvelle tentative après échec d’un déban.
- `/expulser`, `/exclu`, `/unexclu` : kick et timeout.
- `/avertissement`, `/avertissements`, `/retireravertissement` : historique persistant.
- `/mp`, `/testmp` : message privé et test des MP.
- `/annonces` : titre, texte, image facultative, date, encadré rouge ; salons autorisés configurables, mentions désactivées.
- `/nettoyer` : ban d’un ID et suppression de ses messages dans les salons accessibles et fils actifs ; signale les parcours incomplets. Les fils archivés ne sont pas parcourus.
- `/export`, `/exportmembres` : administrateurs uniquement, fichiers exclusivement par MP. Si les MP sont fermés, aucun envoi dans le salon. Logs TXT et membres CSV avec protection contre les formules CSV.
- `/lockdown`, `/antiraid` : verrouillage manuel et état des protections.
- Menu membre → Informations du compte.

Les permissions sont contrôlées à l’exécution. La hiérarchie du modérateur et celle du bot limitent les sanctions. Aucune réaction, blague, réponse à une mention ou commande d’anniversaire.

## Protections et limites

Configurer **ALLOWED_BOT_IDS** et **ALLOWED_WEBHOOK_IDS avant de démarrer** : en mode anti-applications, tout nouveau bot non autorisé est banni, et les messages d’applications/webhooks non autorisés sont supprimés. Le bot tente de bannir le compte de l’application lorsqu’il est identifiable, jamais l’ID d’un webhook ni un utilisateur supposé responsable. Les administrateurs et le propriétaire sont protégés.

Une application installée sur le compte d’un utilisateur n’est pas nécessairement membre du serveur : son bannissement ne garantit pas son blocage. Désactiver également la permission Discord **Utiliser des applications externes** pour les rôles concernés. Voir la [documentation Discord](https://support-apps.discord.com/hc/en-us/articles/26501864012951-Moderating-Apps-on-Discord).

Anti-raid : par défaut 8 arrivées en 15 secondes déclenchent le lockdown ; les comptes de moins de 24 heures arrivés dans cette même fenêtre sont bannis. Un compte récent isolé n’est pas banni. Le lockdown ne bloque que l’écriture de `@everyone` dans les salons texte/annonces : des permissions explicites de rôles peuvent la maintenir, et les fils/voix ne sont pas verrouillés. Les anciennes permissions sont restaurées par `/lockdown off`, y compris après redémarrage. Les échecs sont consignés.

Anti-spam : 10 messages en 5 secondes ou 5 messages identiques en 20 secondes entraînent suppression et timeout de 24 heures. Les membres ayant Gérer les messages sont exemptés. `BLOCKED_WORDS` ajoute un filtrage textuel (pas d’analyse visuelle).

## Mises à jour et données

À **chaque changement**, ajouter une entrée avec une version unique et la liste complète des modifications dans `releases.json`, puis modifier `package.json`. Au redémarrage, BloodSnow publie toutes les versions non encore annoncées dans les logs, y compris au premier démarrage. Il ne devine pas les modifications du code : elles doivent être décrites dans ce fichier. Un redémarrage sans changement publie seulement son statut.

Conserver `data/` sur un disque persistant : avertissements, bans temporaires, permissions avant lockdown et versions déjà annoncées. Une seule instance doit écrire dans ce dossier. Si le processus s’arrête entre l’envoi d’une annonce et sa sauvegarde, celle-ci peut être renvoyée au prochain démarrage.

## Vérification

`npm run check`, `npm test`, `npm run build`. Les tests utilisent des données temporaires et des objets Discord simulés, sans connexion ni sanction réelle. Valider ensuite dans un serveur de test les permissions, les MP fermés, la liste des bots autorisés et la restauration du lockdown avant utilisation en production.

### Diagnostic avant mise en service

`npm run check:setup` affiche tous les paramètres manquants sans révéler le token. Le lancement et le déploiement vérifient que le token appartient bien à `CLIENT_ID`. Le déploiement retourne un code d’échec si Discord refuse les commandes.
