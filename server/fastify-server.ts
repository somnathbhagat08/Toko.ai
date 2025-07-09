import Fastify from 'fastify';
import cors from '@fastify/cors';
import session from '@fastify/session';
import websocket from '@fastify/websocket';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { storage } from './storage.js';
import bcrypt from 'bcrypt';
import { log } from './vite.js';

// Extend session type
declare module 'fastify' {
  interface FastifySessionObject {
    userId?: string;
  }
}

async function createFastifyServer() {
  const fastify = Fastify({
    logger: false
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true,
    credentials: true
  });

  // Register WebSocket support
  await fastify.register(websocket);

  // Session configuration
  await fastify.register(session, {
    secret: process.env.SESSION_SECRET || 'toko-session-secret-key-change-in-production',
    cookie: {
      secure: false, // Set to true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  });

  // Store active users and rooms
  const activeUsers = new Map<string, any>();
  const waitingUsers = new Map<string, any>();
  const chatRooms = new Map<string, any>();

  // Auth routes
  fastify.post('/api/auth/login', async (request: any, reply: any) => {
  const { email, password } = request.body as { email: string; password: string };
  
  if (!email || !password) {
    return reply.code(400).send({ error: 'Email and password are required' });
  }

  try {
    const user = await storage.authenticateUser(email, password);
    if (user) {
      request.session.userId = user.id;
      return reply.send(user);
    } else {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
  } catch (error) {
    log(`Login error: ${error}`, 'auth');
    return reply.code(500).send({ error: 'Internal server error' });
  }
});

fastify.post('/api/auth/register', async (request, reply) => {
  const { email, password, name, avatar, provider } = request.body as {
    email: string;
    password: string;
    name: string;
    avatar?: string;
    provider?: string;
  };

  if (!email || !password || !name) {
    return reply.code(400).send({ error: 'Email, password, and name are required' });
  }

  try {
    // Check if user already exists
    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      return reply.code(409).send({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = await storage.createUser({
      email,
      password: hashedPassword,
      name,
      avatar,
      provider
    });

    request.session.userId = user.id;
    return reply.send(user);
  } catch (error) {
    log(`Registration error: ${error}`, 'auth');
    return reply.code(500).send({ error: 'Internal server error' });
  }
});

fastify.post('/api/auth/logout', async (request, reply) => {
  request.session.destroy();
  return reply.send({ success: true });
});

// Health check endpoint
fastify.get('/api/health', async (request, reply) => {
  return reply.send({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'toko-api'
  });
});

// Socket.IO integration with Fastify
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  log(`New socket connection: ${socket.id}`, 'socket');

  socket.on('join-queue', (userData) => {
    activeUsers.set(socket.id, { ...userData, socketId: socket.id });
    
    // Try to find a match
    const match = findMatch(userData, waitingUsers);
    
    if (match) {
      // Remove matched users from waiting queue
      waitingUsers.delete(match.socketId);
      
      // Create room
      const roomId = `room_${socket.id}_${match.socketId}`;
      chatRooms.set(roomId, {
        users: [socket.id, match.socketId],
        createdAt: new Date()
      });
      
      // Join both users to the room
      socket.join(roomId);
      io.sockets.sockets.get(match.socketId)?.join(roomId);
      
      // Notify both users
      socket.emit('match-found', { roomId, stranger: match, chatMode: userData.chatMode });
      io.to(match.socketId).emit('match-found', { roomId, stranger: userData, chatMode: userData.chatMode });
      
      log(`Match found: ${socket.id} <-> ${match.socketId} in room ${roomId}`, 'matching');
    } else {
      // Add to waiting queue
      waitingUsers.set(socket.id, { ...userData, socketId: socket.id });
      socket.emit('waiting-for-match');
      log(`User ${socket.id} added to waiting queue`, 'matching');
    }
  });

  socket.on('send-message', (data) => {
    const { roomId, message } = data;
    socket.to(roomId).emit('receive-message', {
      message,
      senderId: socket.id,
      timestamp: new Date()
    });
  });

  socket.on('typing', (data) => {
    const { roomId } = data;
    socket.to(roomId).emit('user-typing', true);
  });

  socket.on('stop-typing', (data) => {
    const { roomId } = data;
    socket.to(roomId).emit('user-typing', false);
  });

  socket.on('leave-chat', (data) => {
    const { roomId } = data;
    socket.to(roomId).emit('stranger-disconnected');
    socket.leave(roomId);
    
    // Clean up room
    const room = chatRooms.get(roomId);
    if (room) {
      room.users.forEach((userId: string) => {
        const userSocket = io.sockets.sockets.get(userId);
        if (userSocket) {
          userSocket.leave(roomId);
        }
      });
      chatRooms.delete(roomId);
    }
  });

  socket.on('skip-chat', (data) => {
    const { roomId } = data;
    socket.to(roomId).emit('finding-new-match');
    
    // Remove from current room and rejoin queue
    socket.leave(roomId);
    const userData = activeUsers.get(socket.id);
    if (userData) {
      socket.emit('join-queue', userData);
    }
  });

  // WebRTC signaling
  socket.on('webrtc-offer', (data) => {
    const { roomId, offer } = data;
    socket.to(roomId).emit('webrtc-offer', { offer, senderId: socket.id });
  });

  socket.on('webrtc-answer', (data) => {
    const { roomId, answer } = data;
    socket.to(roomId).emit('webrtc-answer', { answer, senderId: socket.id });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    const { roomId, candidate } = data;
    socket.to(roomId).emit('webrtc-ice-candidate', { candidate, senderId: socket.id });
  });

  socket.on('disconnect', () => {
    log(`Socket disconnected: ${socket.id}`, 'socket');
    
    // Clean up user data
    activeUsers.delete(socket.id);
    waitingUsers.delete(socket.id);
    
    // Find and clean up any rooms this user was in
    for (const [roomId, room] of chatRooms.entries()) {
      if (room.users.includes(socket.id)) {
        // Notify other users in the room
        socket.to(roomId).emit('stranger-disconnected');
        chatRooms.delete(roomId);
        break;
      }
    }
  });
});

function findMatch(userData: any, waitingUsers: Map<string, any>) {
  for (const [socketId, waitingUser] of waitingUsers.entries()) {
    // Don't match with same user
    if (socketId === userData.socketId) continue;
    
    // Check chat mode compatibility
    if (waitingUser.chatMode !== userData.chatMode) continue;
    
    // Check gender preferences
    if (userData.genderPreference && waitingUser.gender && 
        userData.genderPreference !== waitingUser.gender) continue;
    
    if (waitingUser.genderPreference && userData.gender && 
        waitingUser.genderPreference !== userData.gender) continue;
    
    // Check common interests (at least one match)
    const commonInterests = userData.interests?.filter((interest: string) => 
      waitingUser.interests?.includes(interest)
    ) || [];
    
    if (userData.interests?.length > 0 && waitingUser.interests?.length > 0 && 
        commonInterests.length === 0) continue;
    
    return waitingUser;
  }
  return null;
}

  return fastify;
}

export { createFastifyServer };