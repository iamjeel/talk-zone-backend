import express from 'express';
import http from 'http';
import { Server } from 'socket.io'; // Import Server from socket.io
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();

// Define allowed origins
const allowedOrigins = [
  'http://localhost:3000', // Local development
  'https://unsaid-staging.netlify.app', // Production
];

// Use CORS middleware with a dynamic origin function
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  })
);

const googleApiKey = process.env.GOOGLE_API_KEY;
const roomUserCounts = {};

// Initialize the HTTP server
const server = http.createServer(app);

// Initialize the Socket.io server and attach it to the HTTP server
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'https://unsaid-staging.netlify.app'], // Allow frontend URLs
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  },
});

// Function to clean up rooms if no users are left
const cleanUpRoomIfEmpty = (roomName) => {
  if (roomUserCounts[roomName] <= 0) {
    delete roomUserCounts[roomName];
    io.in(roomName).disconnectSockets();
  }
};

io.on('connection', (socket) => {
  console.log('A user connected');
  const { latitude, longitude } = socket.handshake.query;

  if (latitude && longitude) {
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      console.error('Invalid latitude or longitude');
      socket.emit('error', { message: 'Invalid location coordinates' });
      socket.disconnect();
      return;
    }

    axios
      .get(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${googleApiKey}`)
      .then((response) => {
        if (response.data.results && response.data.results.length > 0) {
          const city = response.data.results[0].address_components.find((component) =>
            component.types.includes('locality')
          )?.long_name || 'unknown-city';

          const roomName = city.replace(/\s+/g, '-').toLowerCase();
          console.log(`User location: ${city}, Room: ${roomName}`);

          socket.join(roomName);
          roomUserCounts[roomName] = (roomUserCounts[roomName] || 0) + 1;

          io.to(roomName).emit('user_count_update', roomUserCounts[roomName]);
          socket.emit('joined_room', roomName); // Emit 'joined_room' instead of 'room_info'

          socket.on('send_message', (message) => {
            const timestamp = new Date().toISOString();
            const messageWithTimestamp = { text: message, timestamp };
            io.to(roomName).emit('receive_message', messageWithTimestamp);
          });

          socket.on('disconnect', () => {
            console.log(`User disconnected from room: ${roomName}`);
            roomUserCounts[roomName] -= 1;
            io.to(roomName).emit('user_count_update', roomUserCounts[roomName]);
            cleanUpRoomIfEmpty(roomName);
          });
        } else {
          console.error('Geocoding failed, no results returned');
          socket.emit('error', { message: 'Unable to determine location' });
          socket.disconnect();
        }
      })
      .catch((err) => {
        console.error('Google Maps Geocoding API error:', err);
        socket.emit('error', { message: 'Location service error' });
        socket.disconnect();
      });
  } else {
    console.error('Latitude and longitude not provided');
    socket.emit('error', { message: 'Location coordinates required' });
    socket.disconnect();
  }
});

// Start the server on the specified port
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
