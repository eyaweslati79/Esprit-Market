# EspritMarket

**Plateforme e-commerce intelligente pour la communauté ESPRIT** : achat, vente, services, covoiturage et forum entre étudiants, avec 6 modèles de machine learning intégrés.

🏆 **1er prix du Bal des projets d'ESPRIT (2026)**, projet intégré (PI) de 4e année, réalisé en équipe.

▶️ **[Voir la démo vidéo et les captures sur mon portfolio](https://eyaweslati79.github.io/portfolio/#espritmarket)**

<p align="center">
  <img src="https://eyaweslati79.github.io/portfolio/img/espritmarket-premier-prix.jpg" alt="Remise du 1er prix au Bal des projets d'ESPRIT" width="320">
</p>

---

## Fonctionnalités

- **Marketplace** : produits, services, favoris, panier, commandes et paiement en ligne (Stripe, avec code OTP par SMS).
- **Négociation** : l'acheteur fait une offre au vendeur, avec un modèle qui estime les chances d'acceptation et un export PDF.
- **Covoiturage** : trajets, réservations, profils conducteur et passager, paiement et avis.
- **Livraison** : suivi des commandes et estimation du temps de livraison selon la météo.
- **Fidélité** : points, niveaux, roue de la fortune et coupons.
- **Forum** communautaire, avec des recommandations de publications similaires.
- **Notifications en temps réel** (WebSocket) et **back-office** d'administration (utilisateurs, livraisons, réclamations SAV, statistiques).

## Intelligence artificielle

| Service | Rôle | Port |
|---|---|---|
| `ml-service` | Prédiction de la négociation et de l'acceptation des trajets (XGBoost), recommandations, réentraînement à partir des retours | 8007 |
| `marketplace-ml` | Recommandation de produits personnalisée | 8003 |
| `ai-cart` | Suggestions de promotions et ajustement des prix du panier (Random Forest, XGBoost) | 8002 |
| `ai-delivery-eta` | Estimation du temps de livraison et du risque météo | 8004 |
| `ai-forum-recommendation` | Recommandation de publications similaires dans le forum | 8001 |

Chaque service est une API **FastAPI** appelée par le back-end Spring Boot.

## Architecture

```
Angular 21 (front-end)  ──►  Spring Boot 3 (API REST + WebSocket, JWT/RBAC)  ──►  MongoDB
                                         │
                                         └──►  5 services IA en FastAPI (scikit-learn, XGBoost)
```

## Technologies

| Domaine | Outils |
|---|---|
| Front-end | Angular 21, TypeScript, Tailwind CSS |
| Back-end | Java 17, Spring Boot 3.3, Spring Security (JWT, rôles), WebSocket |
| Données | MongoDB |
| IA | Python, FastAPI, scikit-learn, XGBoost, pandas |
| Paiement et SMS | Stripe, Vonage |
| DevOps | Docker, Docker Compose, Kubernetes, Jenkins |

## Structure du dépôt

```
backend/                   API Spring Boot
frontend/                  Application Angular
ml-service/                Négociation, covoiturage, recommandations
marketplace-ml/            Recommandation de produits
ai-cart/                   Promotions et prix du panier
ai-delivery-eta/           Temps de livraison et météo
ai-forum-recommendation/   Recommandations du forum
infra/                     Docker Compose et manifestes Kubernetes
```

## Lancer le projet en local

**Prérequis** : Java 17, Node.js, Python 3.10+ et MongoDB (ou Docker).

1. **Variables d'environnement** : définir au minimum `MONGODB_URI` et `JWT_SECRET`, et les clés Stripe et Vonage pour le paiement et les SMS.
2. **Back-end** (port 8090) :
   ```bash
   cd backend
   mvn spring-boot:run
   ```
3. **Front-end** (http://localhost:4200) :
   ```bash
   cd frontend
   npm install
   npm start
   ```
4. **Services IA** : sous Windows, `start-ml.bat` lance les 5 services d'un coup. Sinon, dans chaque dossier, installer les dépendances avec `pip install -r requirements.txt` puis lancer le service avec `uvicorn` sur le port du tableau (la commande exacte est dans `start-ml.bat` et dans le README de chaque service).

**Avec Docker** : `docker compose -f infra/docker-compose.yaml up --build`. Les manifestes Kubernetes sont dans `infra/k8s/`.

---

Projet réalisé à [ESPRIT](https://esprit.tn) · Portfolio : [eyaweslati79.github.io/portfolio](https://eyaweslati79.github.io/portfolio/)
