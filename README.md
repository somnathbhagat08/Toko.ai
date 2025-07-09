# Toko Chat Application

A real-time chat application with matchmaking, WebRTC video calling, and global user visualization.

## Getting Started

### Prerequisites

- Node.js v18 or higher
- npm v8 or higher

### Setup and Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

### Development Mode

The application consists of a backend server and a frontend client. You can run them separately or together.

#### Option 1: Start both client and server (Windows)

For Windows users, a batch file is included to start both servers simultaneously:

```bash
# Simply run the batch file
start-dev.bat
```

This will open two terminal windows, one for the backend server and one for the frontend dev server.

#### Option 2: Start services separately

Start the backend server:

```bash
npm run dev:server
```

In another terminal, start the frontend development server:

```bash
npm run dev:client
```

### Accessing the Application

- Backend API: http://localhost:5000
- Frontend UI: http://localhost:5173

## Features

- Real-time chat with WebSocket communication
- User matchmaking for random connections
- Global user visualization with 3D globe
- WebRTC video and audio calling
- User authentication and account management
- Real-time presence tracking

## Development Notes

### Environment Variables

The application supports the following environment variables:

- `NODE_ENV`: Application environment (`development` or `production`)
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `JWT_SECRET`: Secret for JWT token signing
- `CORS_ORIGIN`: Comma-separated list of allowed origins

### Database

The application can work with:

1. PostgreSQL (recommended for production)
2. In-memory storage (fallback when no DATABASE_URL is provided)

### Default User Accounts

When running with in-memory storage, you need to register a new account.

## Troubleshooting

### Login or Registration Issues

If you encounter login or registration issues:

1. Check the backend console for error logs
2. Verify that you're using the correct credentials
3. Make sure the backend server is running
4. Check browser console for network errors

### WebSocket Connection Issues

If real-time features aren't working:

1. Verify that the backend server is running
2. Check browser console for WebSocket connection errors
3. Ensure that the proxy configuration is correct in vite.config.ts

### Common Error Solutions

#### "Transform failed with 1 error"
If you see an error message related to a transform error or syntax error in TypeScript files:
1. Check the specified file for syntax errors such as missing or extra brackets
2. Fix any referenced variables that might have been renamed (e.g., `monitoring` → `monitoringService`)
3. Restart the server after making changes

#### "Authentication failed" when logging in
1. Make sure you're using the correct credentials
2. Check if the user already exists in the system
3. Look for backend logs that might explain the authentication failure
4. Try registering a new account if login consistently fails

## License

This project is licensed under the MIT License - see the LICENSE file for details.
