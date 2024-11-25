// File: server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import axios from 'axios';
import dotenv from 'dotenv';
import winston from 'winston';
import validator from 'validator';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
    new winston.transports.File({ filename: 'app.log' }),
  ],
});

const googleApiKey = process.env.GOOGLE_API_KEY;

io.on('connection', (socket) => {
  logger.info('A user connected');

  const { latitude, longitude } = socket.handshake.query;

  if (latitude && longitude) {
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      logger.error('Invalid latitude or longitude');
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
          logger.info(`User location: ${city}, Room: ${roomName}`);

          socket.join(roomName);
          socket.emit('joined_room', roomName);

          socket.on('send_message', (message) => {
            if (!validator.isLength(message, { min: 1, max: 255 })) {
              logger.warn('Message rejected due to invalid length');
              return;
            }

            const sanitizedMessage = validator.escape(message);
            logger.info(`Broadcasting message: "${sanitizedMessage}"`);
            io.to(roomName).emit('receive_message', sanitizedMessage);
          });
        } else {
          logger.error('Geocoding failed, no results returned');
        }
      })
      .catch((err) => {
        logger.error('Google Maps Geocoding API error:', err);
      });
  }

  socket.on('disconnect', () => {
    logger.info('A user disconnected');
  });
});

server.listen(process.env.PORT || 3001, () => {
  logger.info(`Server is running on port ${process.env.PORT || 3001}`);
});
