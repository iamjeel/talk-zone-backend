import { Server } from 'socket.io';
import http from 'http';
import axios from 'axios';
import dotenv from 'dotenv';
import winston from 'winston';

dotenv.config();

// Logger setup using winston
const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
    new winston.transports.File({ filename: 'app.log', level: 'warn' }),
  ],
});

// Google API key from environment variables
const googleApiKey = process.env.google_api_key;
if (!googleApiKey) {
  logger.error('Google API Key is missing');
  process.exit(1);
}

// Create an Express-like mock server for socket.io (Vercel serverless function)
const server = http.createServer();
const io = new Server(server);

// Vercel function entry point
export default (req, res) => {
  // Handle socket connection and geocoding logic
  io.on('connection', (socket) => {
    logger.info('A user connected');

    const { latitude, longitude } = req.query;

    if (latitude && longitude) {
      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);

      // Validate coordinates
      if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        logger.error('Invalid latitude or longitude');
        socket.emit('error', 'Invalid coordinates');
        return;
      }

      // Geocode the coordinates
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

  // End the response to avoid timeout issues in Vercel serverless function
  res.status(200).json({ message: 'Socket endpoint initialized' });
};
