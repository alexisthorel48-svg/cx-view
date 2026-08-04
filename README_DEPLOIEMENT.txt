CX VIEW — HOTFIX ISOLATION CLIENT 1.1
=====================================

Fonctionnement livré
--------------------
1. Un Admin client ne peut plus créer ni supprimer d'écran.
2. Les listes d'écrans sont filtrées par client côté serveur.
3. Une playlist créée par un Admin client reçoit automatiquement son client_id de session.
4. Un Admin client ne peut voir, modifier, dupliquer ou supprimer que ses playlists.
5. Les médias ajoutés à une playlist doivent appartenir au même client.
6. Les listes de lecture proposées dans la configuration d'un écran sont filtrées par client.
7. Un Admin client ne peut configurer que ses propres écrans.
8. Les campagnes, conflits, groupes, playlists et écrans proposés par le planificateur sont filtrés par client.
9. Création, modification, duplication et suppression d'une campagne sont refusées si un écran ou une playlist appartient à un autre client.
10. Le menu Utilisateurs est accessible aux Admins clients.
11. Un Admin client peut créer/modifier/supprimer des utilisateurs uniquement dans son propre client.
12. Le client_id n'est jamais choisi par l'Admin client : il est imposé par sa session.

Aucune migration SQL n'est nécessaire.
Aucune modification du Player Windows n'est nécessaire.

INSTALLATION
------------
Depuis le dossier /home/ubuntu/cx_view_rebuild :

  mkdir -p backups/tenant_acl_$(date +%Y%m%d_%H%M%S)
  BACKUP=$(ls -dt backups/tenant_acl_* | head -1)
  cp server.js "$BACKUP/"
  cp modules/cx_view_v24.js modules/cx_view_v242.js modules/cx_view_v25.js modules/cx_view_v29.js "$BACKUP/"
  cp public/app.html "$BACKUP/"
  cp public/js/v2-app.js public/js/v2-screens.js public/js/v2-fleet-v29.js public/js/v2-playlists.js "$BACKUP/"

  cp -a /home/ubuntu/CX_VIEW_TENANT_ISOLATION_1.1/. .

  node --check server.js
  node --check modules/cx_view_v24.js
  node --check modules/cx_view_v242.js
  node --check modules/cx_view_v25.js
  node --check modules/cx_view_v29.js
  node --check public/js/v2-app.js
  node --check public/js/v2-screens.js
  node --check public/js/v2-fleet-v29.js
  node --check public/js/v2-playlists.js

  pm2 restart cx-view-rebuild
  pm2 status
  pm2 logs cx-view-rebuild --lines 120

TESTS
-----
A. En Super Admin :
- création d'écran toujours disponible ;
- accès à tous les clients, écrans, playlists et campagnes ;
- attribution d'un écran à un client.

B. En Admin client :
- bouton Nouvel écran absent ;
- seuls ses écrans apparaissent ;
- une nouvelle playlist est automatiquement rattachée à son client ;
- seules ses playlists apparaissent ;
- seuls ses écrans apparaissent dans Campagnes ;
- impossible d'utiliser manuellement un ID d'écran, playlist ou campagne d'un autre client ;
- menu Utilisateurs visible ;
- un nouvel utilisateur est automatiquement rattaché au même client.
