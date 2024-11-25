import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import axios from 'axios';
import dotenv from 'dotenv';
import winston from 'winston';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';

dotenv.config();

// Create an Express app and an HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGIN || '*', // Use an environment variable to restrict allowed origins in production
    methods: ['GET', 'POST'],
  },
});

// Logger setup using winston
const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
    new winston.transports.File({ filename: 'app.log', level: 'warn' }),
  ],
});

// Security and middleware setup
app.use(helmet()); // Helps secure Express apps by setting various HTTP headers
app.use(cors()); // CORS middleware to handle cross-origin requests
app.use(morgan('combined')); // HTTP request logger for better request insights

// Rate limiting to prevent abuse (100 requests per 15 minutes)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: 'Too many requests, please try again later.',
});
app.use(limiter);

// Google API key from environment variables
const googleApiKey = process.env.google_api_key;
if (!googleApiKey) {
  logger.error('Google API Key is missing');
  process.exit(1);
}

// Handling connections via socket.io
io.on('connection', (socket) => {
  logger.info('A user connected');

  const { latitude, longitude } = socket.handshake.query;

  if (latitude && longitude) {
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    // Validate the coordinates
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      logger.error('Invalid latitude or longitude');
      socket.emit('error', 'Invalid coordinates');
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

          const roomName = city.replace(/\s+/g, '-').toLowerCase();
          logger.info(`User location: ${city}, Room: ${roomName}`);

          socket.join(roomName);
          socket.emit('joined_room', roomName);

          socket.on('send_message', (message) => {
            logger.info(`Received message: "${message}"`);
            io.to(roomName).emit('receive_message', message);
          });
        } else {
          logger.error('Geocoding failed, no results returned');
          socket.emit('error', 'Unable to determine location');
        }
      })
      .catch((err) => {
        logger.error('Google Maps Geocoding API error:', err);
        socket.emit('error', 'Error fetching location data');
      });
  } else {
    logger.error('Latitude or Longitude not provided');
    socket.emit('error', 'Coordinates are required');
  }

  socket.on('disconnect', () => {
    logger.info('A user disconnected');
  });
});

// Server listen on port 3001 or environment specified port
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received. Closing HTTP server.');
  server.close(() => {
    logger.info('HTTP server closed.');
  });
});
