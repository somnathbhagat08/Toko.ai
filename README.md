# Toko Chat Application 🚀

Welcome to **Toko** – a modern, real-time chat app with global matchmaking, video calls, and a beautiful UI! This guide will help you set up, run, and understand every part of the project, both frontend and backend. 

---

## 🌐 Project Structure

```
Toko.ai/
│
├── client/         # Frontend (React + Vite)
├── server/         # Backend (Node.js + Fastify)
├── shared/         # Shared code (schemas, types)
├── attached_assets/ # Images & screenshots
├── .env, .gitignore, Dockerfile, etc.
└── ...             # Configs, scripts, docs
```

---

## 🖥️ Frontend (client/)

- **Framework:** React + TypeScript + Vite
- **Styling:** Tailwind CSS
- **Main Features:**
  - Login & Registration (Email/Password + Google OAuth)
  - Real-time chat UI
  - Matchmaking & online users
  - Animated backgrounds & modern design
  - Error boundaries for smooth UX
  - WebRTC video/audio calls

### Key Files & Folders
- `client/src/App.tsx` – Main app logic
- `client/src/components/` – All UI components (Chat, Login, Home, Globe, etc.)
- `client/src/services/` – API, WebSocket, and WebRTC logic
- `client/index.html` – Loads Google Sign-In script
- `client/.env` – **Set your Google OAuth Client ID here!**

### How to Run Frontend
```bash
cd client
npm install
npm run dev
```
- Default: http://localhost:5173
- If port 5173 is busy, use `start-on-port-5173.bat` or change the port in `vite.config.ts`.

---

## 🛠️ Backend (server/)

- **Framework:** Node.js + Fastify
- **Database:** PostgreSQL (or in-memory fallback)
- **Cache:** Redis (optional)
- **Main Features:**
  - REST API for auth, chat, presence, matchmaking
  - Google OAuth token verification (secure)
  - JWT-based authentication
  - Monitoring & logging
  - Modular services (auth, presence, moderation, etc.)
  - Error handling & validation

### Key Files & Folders
- `server/index.ts` – Main server entry
- `server/routes.ts` – API endpoints
- `server/services/` – Auth, presence, matchmaking, moderation, etc.
- `server/utils/` – Logger, error handler, config, security
- `server/db.ts` – Database connection
- `server/monitoring.ts` – Health & metrics
- `.env` – **Set your secrets and DB connection here!**

### How to Run Backend
```bash
cd server
npm install
npm run dev
```
- Default: http://localhost:5001

---

## 🔗 Connecting Frontend & Backend
- The frontend talks to the backend via `/api` and `/socket.io` (see `vite.config.ts` for proxy setup)
- Make sure both servers are running for full functionality!

---

## 🔑 Authentication & Google OAuth
- Email/password and Google Sign-In supported
- **Google OAuth Setup:**
  1. Get a Client ID from Google Cloud Console
  2. Add your dev origins (e.g. `http://localhost:5173`) to the authorized JavaScript origins
  3. Put your Client ID in `client/.env` as `VITE_GOOGLE_CLIENT_ID=...`
  4. Put your Client Secret in `server/.env` as `GOOGLE_CLIENT_SECRET=...`
  5. See `GOOGLE_OAUTH_TROUBLESHOOTING.md` for help

---

## ⚙️ Environment Variables
- **Frontend (`client/.env`):**
  - `VITE_GOOGLE_CLIENT_ID=...`
- **Backend (`.env`):**
  - `DATABASE_URL=...` (Postgres)
  - `REDIS_URL=...` (optional)
  - `JWT_SECRET=...`
  - `GOOGLE_CLIENT_SECRET=...`
  - `CORS_ORIGIN=...`

---

## 🐳 Docker & Deployment
- Dockerfile and `docker-compose.yml` included for easy deployment
- See `PRODUCTION_READY.md` for production tips

---

## 🧪 Testing & Debugging
- Use `diagnose-oauth.bat` to check your OAuth setup
- Use `google-signin-test.html` to test Google login directly
- See `GOOGLE_OAUTH_TROUBLESHOOTING.md` for common issues

---

## 📝 Other Important Files
- `vite.config.ts` – Vite dev server config & proxy
- `tailwind.config.ts` – Tailwind CSS setup
- `tsconfig.json` – TypeScript config
- `nginx.conf`, `k8s-deployment.yml` – For advanced deployment
- `attached_assets/` – Screenshots & images

---

## 💡 Tips
- If you see "unregistered_origin" errors, check your Google Cloud Console origins and see the troubleshooting guide
- If port 5000 is busy, use port 5173 (default for Vite)
- Always restart both servers after changing environment variables
- For best results, use Node.js v18+ and npm v8+

---

## 🙋 Need Help?
- See the troubleshooting guides in this repo
- Check the browser and server console for errors
- If stuck, open an issue or contact the maintainer

---

## 🧑‍💻 Made by Humans using AI 🤖

Enjoy chatting with the world! 🌍✨
