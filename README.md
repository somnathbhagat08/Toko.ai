🌐✨ Toko Chat Application
A real-time 💬 chat platform featuring intelligent matchmaking 🤝, seamless WebRTC video calls 🎥, and a global user visualization 🌍.

🚀 Getting Started
✅ Prerequisites
Ensure you have the following installed:

Node.js v18+ 🟢

npm v8+ 📦

⚙️ Setup & Installation
Clone the repository

bash
Copy
Edit
git clone https://github.com/your-username/toko-chat-app.git
cd toko-chat-app
Install dependencies

bash
Copy
Edit
npm install
🧪 Development Mode
The app includes a backend 🧠 and frontend 🎨. You can run them together or separately.

🔁 Option 1: Start Both (Windows Only)
Run the batch file to launch both servers in two terminals:

bash
Copy
Edit
start-dev.bat
✅ This starts:

Backend API: http://localhost:5000

Frontend UI: http://localhost:5173

🛠️ Option 2: Start Services Separately
Start the backend server:

bash
Copy
Edit
npm run dev:server
Start the frontend server:

bash
Copy
Edit
npm run dev:client
🌟 Features
⚡ Real-time chat with WebSocket

🤖 Smart user matchmaking

🌐 3D globe showing online users

📹 WebRTC video & audio calls

🔐 Authentication & account management

👀 Real-time user presence tracking

📁 Environment Variables
Create a .env file and include the following as needed:

Variable	Description
NODE_ENV	development or production
DATABASE_URL	PostgreSQL connection string 🌐
REDIS_URL	Redis connection string 🧠
JWT_SECRET	JWT secret for secure auth 🔐
CORS_ORIGIN	Allowed origins (comma-separated) 🌍

🛢️ Database Setup
🏆 Recommended: PostgreSQL for production

🧪 Development: In-memory fallback when no DATABASE_URL

🔒 Note: In-memory mode requires fresh user registration each time.

👥 Default Users
➡️ No default users are included. You must register manually during first use (especially in-memory).

🧩 Troubleshooting
❌ Login or Registration Not Working?
✅ Check backend logs for errors

✅ Double-check credentials

✅ Make sure backend is running

✅ Inspect browser console (F12 → Network tab)

❌ WebSocket Issues?
✅ Confirm backend is running

✅ Check for WebSocket errors in the console

✅ Verify proxy settings in vite.config.ts

🔧 Common Fixes
🛠️ Transform failed with 1 error
Check for syntax issues in TypeScript files (missing brackets, etc.)

Rename or fix invalid variable references

Restart the server after fixing

🔐 "Authentication failed"
Ensure credentials are correct

Confirm user exists (or register again)

See backend logs for detailed errors

📄 License
This project is licensed under the MIT License 📜
See LICENSE for details.
