console.log('=== Server Starting ===');
require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');

const app = express();
app.use(express.json());

const SECURITY_KEY = process.env.SECURITY_KEY;
const CHECK_INTERVAL = 30000; // 30 seconds

const API_CONFIG = {
    baseUrl: 'https://app.ghazaresan.com/api/',
    endpoints: {
        auth: 'Authorization/Authenticate',
        orders: 'Orders/GetOrders'
    }
};

// Initialize Firebase Admin with service account
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS.replace(/\\"/g, '"'));
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID
});

// Store active users and their check intervals
const activeUsers = new Map();

// Endpoint to register new users
app.post('/register', async (req, res) => {
 console.log('=== New Registration Request ===');
    console.log('Request Body:', req.body);
    const { username, password, fcmToken } = req.body;
    console.log('Processing registration for:', username);
    try {
    console.log('Authenticating user:', username);
        const authResponse = await authenticateUser(username, password);
 console.log('Auth response:', authResponse);
        if (!authResponse.success) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        activeUsers.set(fcmToken, {
            username,
            password,
            lastOrderId: null,
            checkInterval: null
        });
        
        startChecking(fcmToken);
        
        res.json({ success: true, message: 'Registration successful' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

async function authenticateUser(username, password) {
console.log('=== Authentication Started ===');
    console.log('Authenticating:', username);
    try {
        const authUrl = `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.auth}`;
        const response = await axios.post(authUrl, {
            username,
            password
        }, {
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'securitykey': SECURITY_KEY,
                'Origin': 'https://portal.ghazaresan.com',
                'Referer': 'https://portal.ghazaresan.com/'
            }
        });
        
        return { success: true, token: response.data.Token };
    } catch (error) {
        console.error('Authentication error:', error);
        return { success: false };
    }
}

async function checkOrders(username, password, fcmToken) {
 console.log('=== Order Check ===');
    console.log('Checking orders for:', username);
    const user = activeUsers.get(fcmToken);
    if (!user) return;

    try {
        const auth = await authenticateUser(username, password);
        if (!auth.success) return;

        const ordersUrl = `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.orders}`;
        const ordersResponse = await axios.post(ordersUrl, {
            authorizationCode: auth.token,
            securityKey: SECURITY_KEY
        }, {
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'authorizationcode': auth.token,
                'securitykey': SECURITY_KEY,
                'Origin': 'https://portal.ghazaresan.com',
                'Referer': 'https://portal.ghazaresan.com/'
            }
        });

        const newOrders = ordersResponse.data.filter(order => order.Status === 0);
        
        if (newOrders.length > 0) {
console.log('New orders found:', newOrders.length);
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
