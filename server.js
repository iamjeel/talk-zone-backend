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
    origin: '*',
    methods: ['GET', 'POST'],
  },
});


const googleApiKey = process.env.REACT_APP_GOOGLE_API_KEY;

io.on('connection', (socket) => {
  console.log('a user connected');

  const { latitude, longitude } = socket.handshake.query;

  if (latitude && longitude) {
    // Ensure latitude and longitude are numbers
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    // If latitude or longitude is invalid, return
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      console.log('Invalid latitude or longitude');
      return;
    }

    // Use Google Maps API for reverse geocoding
    axios
    .get(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${googleApiKey}`)
    .then((response) => {
      console.log('Google Maps API Response:', response.data); // Log the response for debugging
  
      if (response.data.results && response.data.results.length > 0) {
        const city = response.data.results[0].address_components.find((component) =>
          component.types.includes('locality')
        )?.long_name || 'Unknown City';
  
        const roomName = city.replace(/\s+/g, '-').toLowerCase();
        console.log(`User location: ${city}, Room: ${roomName}`);
        socket.join(roomName);
        socket.emit('joined_room', roomName); 
      } else {
        console.log('Geocoding failed, no results returned');
      }
    })
    .catch((err) => {
      console.error('Google Maps Geocoding API error:', err);
    });
  
    // Listen for incoming messages
    socket.on('send_message', (message) => {
      const roomName = `${lat.toFixed(2)}-${lon.toFixed(2)}`;
      console.log(`Received coordinates: latitude = ${lat}, longitude = ${lon}`);

      io.to(roomName).emit('receive_message', message); // Broadcast to the room
    });
  }

  socket.on('disconnect', () => {
    console.log('a user disconnected');
  });
});

server.listen(3001, () => {
  console.log('Server is running on port 3001');
});
