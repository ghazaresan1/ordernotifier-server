require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');

const app = express();
app.use(express.json());

const SECURITY_KEY = 'Asdiw2737y#376';
const CHECK_INTERVAL = 30000; // 30 seconds

// Initialize Firebase Admin with service account
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID
});

// Store active users and their check intervals
const activeUsers = new Map();

// Endpoint to register new users
app.post('/register', async (req, res) => {
  const { username, password, fcmToken } = req.body;
  
  try {
    // Validate credentials with Ghazaresan
    const authResponse = await authenticateUser(username, password);
    if (!authResponse.success) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Store user info
    activeUsers.set(fcmToken, {
      username,
      password,
      lastOrderId: null,
      checkInterval: null
    });
    
    // Start order checking for this user
    startChecking(fcmToken);
    
    res.json({ success: true, message: 'Registration successful' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Authentication function
async function authenticateUser(username, password) {
  try {
    const response = await axios.post('https://app.ghazaresan.com/api/Authorization/Authenticate', {
      username,
      password
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'securitykey': SECURITY_KEY
      }
    });
    
    return { success: true, token: response.data.Token };
  } catch (error) {
    console.error('Authentication error:', error);
    return { success: false };
  }
}

// Order checking function
async function checkOrders(username, password, fcmToken) {
  const user = activeUsers.get(fcmToken);
  if (!user) return;

  try {
    const auth = await authenticateUser(username, password);
    if (!auth.success) return;

    const ordersResponse = await axios.post('https://app.ghazaresan.com/api/Orders/GetOrders', {
      authorizationCode: auth.token,
      securityKey: SECURITY_KEY
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'authorizationcode': auth.token,
        'securitykey': SECURITY_KEY
      }
    });

    const newOrders = ordersResponse.data.filter(order => order.Status === 0);
    
    if (newOrders.length > 0) {
      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: 'New Orders Available',
          body: `You have ${newOrders.length} new order(s) waiting`
        },
        data: {
          orderCount: newOrders.length.toString()
        }
      });
    }
  } catch (error) {
    console.error('Order check error:', error);
  }
}

// Start checking orders for a user
function startChecking(fcmToken) {
  const user = activeUsers.get(fcmToken);
  if (!user) return;

  if (user.checkInterval) {
    clearInterval(user.checkInterval);
  }

  user.checkInterval = setInterval(() => {
    checkOrders(user.username, user.password, fcmToken);
  }, CHECK_INTERVAL);

  activeUsers.set(fcmToken, user);
}

// Cleanup endpoint
app.post('/unregister', (req, res) => {
  const { fcmToken } = req.body;
  const user = activeUsers.get(fcmToken);
  
  if (user && user.checkInterval) {
    clearInterval(user.checkInterval);
  }
  
  activeUsers.delete(fcmToken);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
