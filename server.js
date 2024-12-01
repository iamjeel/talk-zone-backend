import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin:'https://unsaid-staging.netlify.app/',  // Replace with your production frontend URL
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true,  // Enable cookies if needed
  },
});


const googleApiKey = process.env.GOOGLE_API_KEY; // Updated variable name

io.on('connection', (socket) => {
  console.log('A user connected');

  const { latitude, longitude } = socket.handshake.query;

  if (latitude && longitude) {
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      console.log('Invalid latitude or longitude');
      return;
    }

    // Use Google Maps API for reverse geocoding
    axios
      .get(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${googleApiKey}`)
      .then((response) => {
        console.log('Google Maps API Response:', response.data);

        if (response.data.results && response.data.results.length > 0) {
          const city = response.data.results[0].address_components.find((component) =>
            component.types.includes('locality')
          )?.long_name || 'unknown-city';

          const roomName = city.replace(/\s+/g, '-').toLowerCase();
          console.log(`User location: ${city}, Room: ${roomName}`);

          // Join the room based on the city
          socket.join(roomName);
          socket.emit('joined_room', roomName);

          // Listen for incoming messages
          socket.on('send_message', (message) => {
            console.log(`Message from ${roomName}:`, message);
            io.to(roomName).emit('receive_message', message); // Broadcast within the room
          });
        } else {
          console.log('Geocoding failed, no results returned');
        }
      })
      .catch((err) => {
        console.error('Google Maps Geocoding API error:', err);
      });
  }

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

server.listen(3001, () => {
  console.log('Server is running on port 3001');
});
