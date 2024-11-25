import { Server } from 'socket.io';
import http from 'http';
import axios from 'axios';
import dotenv from 'dotenv';
import winston from 'winston';

// Load environment variables from a .env file
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
const googleApiKey = process.env.GOOGLE_API_KEY;
if (!googleApiKey) {
  logger.error('Google API Key is missing');
  process.exit(1);
}

// Create the server for WebSockets using http.createServer
const server = http.createServer();
const io = new Server(server, {
  path: '/api/socket', // Specify the path to handle WebSocket connections
});

// Setup socket.io event listeners
io.on('connection', (socket) => {
  logger.info('A user connected');

  // Get latitude and longitude from query parameters
  socket.on('join_room', (data) => {
    const { latitude, longitude } = data;

    // Validate coordinates
    if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      logger.error('Invalid latitude or longitude');
      socket.emit('error', 'Invalid coordinates');
      return;
    }

    // Geocode the coordinates using Google Maps API
    axios
      .get(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${googleApiKey}`)
      .then((response) => {
        if (response.data.results && response.data.results.length > 0) {
          const city = response.data.results[0].address_components.find((component) =>
            component.types.includes('locality')
          )?.long_name || 'unknown-city';

          const roomName = city.replace(/\s+/g, '-').toLowerCase();
          logger.info(`User location: ${city}, Room: ${roomName}`);

          socket.join(roomName);
          socket.emit('joined_room', roomName);

          // Listen for messages from the user
          socket.on('send_message', (message) => {
            logger.info(`Message received: ${message}`);
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
  });

  // Handle user disconnection
  socket.on('disconnect', () => {
    logger.info('A user disconnected');
  });
});

// Export serverless function for Vercel
export default (req, res) => {
  // Respond to HTTP requests (for testing the endpoint)
  res.status(200).json({ message: 'Socket endpoint initialized' });

  // Start the WebSocket server
  server.listen(3000, () => {
    logger.info('Socket.io server is running');
  });
};
