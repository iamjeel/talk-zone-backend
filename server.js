import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import axios from 'axios';
import dotenv from 'dotenv';
import winston from 'winston';

dotenv.config();

// Create an Express app and an HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Logger setup using winston
const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
    new winston.transports.File({ filename: 'app.log' }),
  ],
});

// Google API key from environment variables
const googleApiKey = process.env.GOOGLE_API_KEY;

io.on('connection', (socket) => {
  logger.info('A user connected');

  const { latitude, longitude } = socket.handshake.query;

  if (latitude && longitude) {
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    // Validate the coordinates
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      logger.error('Invalid latitude or longitude');
      return;
    }

    // Geocode the coordinates to get a location (city name)
    axios
      .get(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${googleApiKey}`)
      .then((response) => {
        if (response.data.results && response.data.results.length > 0) {
          const city = response.data.results[0].address_components.find((component) =>
            component.types.includes('locality')
          )?.long_name || 'unknown-city';

          // Generate a room name based on the city
          const roomName = city.replace(/\s+/g, '-').toLowerCase();
          logger.info(`User location: ${city}, Room: ${roomName}`);
          
          // Join the room and emit room name back to the user
          socket.join(roomName);
          socket.emit('joined_room', roomName);

          // Handle incoming messages and broadcast them to the room
          socket.on('send_message', (message) => {
            logger.info(`Received message: "${message}"`);
            io.to(roomName).emit('receive_message', message);
          });
        } else {
          logger.error('Geocoding failed, no results returned');
        }
      })
      .catch((err) => {
        logger.error('Google Maps Geocoding API error:', err);
      });
  }

  // Handle disconnection
  socket.on('disconnect', () => {
    logger.info('A user disconnected');
  });
});

// Server listen on port 3001 or environment specified port
server.listen(process.env.PORT || 3001, () => {
  logger.info(`Server is running on port ${process.env.PORT || 3001}`);
});
